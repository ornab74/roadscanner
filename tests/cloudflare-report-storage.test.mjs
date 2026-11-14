import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/account-worker.mjs';
import {guardedReports,reportStorageStatus,ensureReportCapacity} from '../cloudflare/report-storage.mjs';

test('R2 quota counts UTF-8 bytes and encrypted buffers; preserves reads and blocks concurrent over-allocation',async()=>{
 const f=await fixture();try{
  await f.DB.prepare('UPDATE report_storage_budget SET max_bytes=10,max_objects=3 WHERE id=1').run();
  await f.env.REPORTS.put('first','é');assert.equal((await reportStorageStatus(f.env)).used_bytes,2);
  const outcomes=await Promise.allSettled([f.env.REPORTS.put('second',new Uint8Array(7)),f.env.REPORTS.put('third',new Uint8Array(7))]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected'&&x.reason.message==='report_storage_full').length,1);
  const status=await reportStorageStatus(f.env);assert.equal(status.used_bytes,9);assert.equal(status.object_count,2);
  assert.equal(await(await f.env.REPORTS.get('first')).text(),'é');assert.equal(f.objects.size,2);
  await assert.rejects(f.env.REPORTS.put('first','overwrite'),/report_storage_conflict|report_storage_full/);
  await assert.rejects(ensureReportCapacity(f.env),/report_storage_full/);
 }finally{f.close();}
});
test('failed and ambiguous puts keep reserved capacity, and failed deletes never release stored bytes',async()=>{
 const f=await fixture();try{
  let throws=true;const objects=new Map();
  const raw={async put(k,v){objects.set(k,v);if(throws)throw Error('provider timeout');},async delete(k){if(throws)throw Error('provider delete failed');objects.delete(k);}};
  const bucket=guardedReports({...f.env,REPORTS:raw});
  await assert.rejects(bucket.put('ambiguous','data'),/timeout/);assert.equal((await reportStorageStatus(f.env)).used_bytes,4);assert.ok(objects.has('ambiguous'));
  await assert.rejects(bucket.delete('ambiguous'),/write_pending/);assert.equal((await reportStorageStatus(f.env)).used_bytes,4);
  throws=false;await bucket.put('stored','abc');throws=true;
  await assert.rejects(bucket.delete('stored'),/delete failed/);assert.equal((await reportStorageStatus(f.env)).used_bytes,7);
  throws=false;await bucket.delete('stored');assert.equal((await reportStorageStatus(f.env)).used_bytes,4);assert.equal(objects.has('stored'),false);
 }finally{f.close();}
});
test('uninitialized storage, unknown sizes, excessive object size and object-count exhaustion fail closed',async()=>{
 const f=await fixture();try{
  await f.DB.prepare('UPDATE report_storage_budget SET initialized=0 WHERE id=1').run();
  await assert.rejects(f.env.REPORTS.put('blocked','x'),/unavailable/);assert.equal(f.objects.size,0);
  await f.DB.prepare('UPDATE report_storage_budget SET initialized=1,max_objects=1 WHERE id=1').run();
  await assert.rejects(f.env.REPORTS.put('stream',new ReadableStream()),/invalid_storage_payload/);
  await assert.rejects(f.env.REPORTS.put('large',new Uint8Array(8*1024*1024+1)),/too_large/);
  await f.env.REPORTS.put('last','x');await assert.rejects(f.env.REPORTS.put('extra',''),/storage_full/);
  await f.env.REPORTS.delete('last');assert.equal((await reportStorageStatus(f.env)).object_count,0);
  await f.env.REPORTS.put('capacity-restored','x');assert.equal((await reportStorageStatus(f.env)).used_bytes,1);
 }finally{f.close();}
});
test('a full report bucket rejects new inference before provider work or charging, but keeps saved report replay readable',async()=>{
 const f=await fixture();try{
  const payload={vehicle_type:'car',destination:'Example',latitude:0,longitude:0,road_type:'city',weather:'clear',traffic:'light',obstacles:'none',sensor_notes:'',model:'llama_local',language:'en'};
  const headers={Authorization:'Bearer '+f.key,'Content-Type':'application/json','Idempotency-Key':'storage-scan-idempotency-1'};
  let r=await f.request('/api/v1/scans',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(r.status,200);assert.equal(f.calls(),1);
  await f.DB.prepare('UPDATE report_storage_budget SET max_bytes=used_bytes WHERE id=1').run();
  r=await f.request('/api/v1/scans',{method:'POST',headers:{...headers,'Idempotency-Key':'storage-scan-idempotency-2'},body:JSON.stringify(payload)});assert.equal(r.status,503);assert.equal((await r.json()).code,'report_storage_full');assert.equal(f.calls(),1);
  assert.equal((await f.DB.prepare("SELECT credits FROM accounts WHERE user_id='owner'").first()).credits,1);
  r=await f.request('/api/v1/scans',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(r.status,200);assert.equal(r.headers.get('Idempotent-Replay'),'true');assert.equal(f.calls(),1);
 }finally{f.close();}
});
test('storage usage requires an elevated admin browser session; bearer keys cannot inspect it',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('/api/admin/storage')).status,401);
  assert.equal((await f.request('/api/admin/storage',{headers:{Authorization:'Bearer '+f.key}})).status,401);
  const login=await f.request('/auth/login',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'test-password-1234'})});const cookie=login.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await f.request('/api/admin/storage',{headers:{Cookie:cookie}})).status,403);
  await f.DB.prepare("INSERT INTO user_roles VALUES ('owner','admin',1)").run();assert.equal((await f.request('/api/admin/storage',{headers:{Cookie:cookie}})).status,403);
  await f.DB.prepare("UPDATE sessions SET elevated_until=unixepoch()+300 WHERE user_id='owner'").run();
  const r=await f.request('/api/admin/storage',{headers:{Cookie:cookie}});assert.equal(r.status,200);const s=await r.json();assert.equal(s.max_bytes,1073741824);assert.equal(s.cloudflare_invoice_cap,false);
 }finally{f.close();}
});
test('disabling local inference removes it from the catalog and rejects both explicit and default container work without charging',async()=>{
 const f=await fixture();try{
  f.env.LOCAL_SCANNER_ENABLED='false';
  const config=await(await f.request('/api/config')).json();assert.deepEqual(config.models,[]);
  f.env.OPENAI_API_KEY='provider-test-key';assert.deepEqual((await(await f.request('/api/config')).json()).models,['openai']);delete f.env.OPENAI_API_KEY;
  const payload={vehicle_type:'car',destination:'Example',latitude:0,longitude:0,road_type:'city',weather:'clear',traffic:'light',obstacles:'none',sensor_notes:'',language:'en'};
  for(const data of [payload,{...payload,model:'llama_local'}]){
   const r=await f.request('/api/v1/scans',{method:'POST',headers:{Authorization:'Bearer '+f.key,'Content-Type':'application/json','Idempotency-Key':'disabled-local-model-12345'},body:JSON.stringify(data)});assert.equal(r.status,503);assert.equal((await r.json()).code,'model_unavailable');
  }
  assert.equal(f.calls(),0);assert.equal((await f.DB.prepare("SELECT credits FROM accounts WHERE user_id='owner'").first()).credits,2);
 }finally{f.close();}
});
