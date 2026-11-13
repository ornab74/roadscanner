import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/account-worker.mjs';
const scene={latitude:40.7,longitude:-74,vehicle_type:'car',destination:'Example',model:'llama_local',language:'en'};
test('database credit reservation rejects expired, revoked and mismatched keys before debit',async()=>{
 const f=await fixture();try{
  const reserve=(id,user='owner')=>f.DB.prepare("INSERT INTO api_requests(id,api_key_id,user_id,idempotency_key,status,lease_expires_at,created_at,updated_at) VALUES (?,'key',?,?,'reserved',?,?,?)").bind(id,user,id,Math.floor(Date.now()/1000)+900,1,1);
  await f.DB.prepare("UPDATE api_keys SET expires_at=unixepoch()-1 WHERE id='key'").run();await assert.rejects(reserve('expired').run(),/api_key_no_longer_valid/);
  await f.DB.prepare("UPDATE api_keys SET expires_at=unixepoch() WHERE id='key'").run();await assert.rejects(reserve('exact-expiry').run(),/api_key_no_longer_valid/);
  await f.DB.prepare("UPDATE api_keys SET expires_at=NULL,revoked_at=unixepoch() WHERE id='key'").run();await assert.rejects(reserve('revoked').run(),/api_key_no_longer_valid/);
  await f.DB.prepare("UPDATE api_keys SET revoked_at=NULL WHERE id='key'").run();await assert.rejects(reserve('wrong-owner','other').run(),/api_key_no_longer_valid/);
  assert.equal((await f.DB.prepare("SELECT credits FROM accounts WHERE user_id='owner'").first()).credits,2);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM credit_ledger').first()).n,0);
  await f.DB.prepare("UPDATE api_keys SET expires_at=unixepoch()+3600 WHERE id='key'").run();await reserve('valid').run();assert.equal((await f.DB.prepare("SELECT credits FROM accounts WHERE user_id='owner'").first()).credits,1);
 }finally{f.close();}
});
test('key expiry or revocation between authentication and scan reservation returns 401 with no provider work',async()=>{
 for(const mode of ['expiry','revocation']){const f=await fixture();try{
  const original=f.DB.prepare.bind(f.DB);let injected=false;
  f.DB.prepare=sql=>{const s=original(sql);if(sql.startsWith('INSERT INTO api_requests(')){const first=s.first;s.first=async function(){injected=true;await original(mode==='expiry'?"UPDATE api_keys SET expires_at=1 WHERE id='key'":"UPDATE api_keys SET revoked_at=unixepoch() WHERE id='key'").run();return first.call(this);};}return s;};
  const r=await f.request('/api/v1/scans',{method:'POST',headers:{Authorization:'Bearer '+f.key,'Content-Type':'application/json','Idempotency-Key':'credential-boundary-fixture'},body:JSON.stringify(scene)});
  assert.equal(injected,true);assert.equal(r.status,401);assert.equal((await r.json()).code,'invalid_api_key');assert.match(r.headers.get('WWW-Authenticate'),/invalid_token/);assert.equal(f.calls(),0);
  assert.equal((await original("SELECT credits FROM accounts WHERE user_id='owner'").first()).credits,2);assert.equal((await original('SELECT COUNT(*) AS n FROM api_requests').first()).n,0);assert.equal((await original('SELECT COUNT(*) AS n FROM credit_ledger').first()).n,0);
 }finally{f.close();}}
});
test('route and garage image reservations apply the same expired-key guard before calling providers',async()=>{
 const {pngHeader}=await import('./fixtures/image-headers.mjs');
 for(const kind of ['route','image']){const f=await fixture(),savedFetch=globalThis.fetch;let providerCalls=0;try{
  f.env.OPENAI_API_KEY='fixture-not-a-real-key';globalThis.fetch=async()=>{providerCalls++;throw Error('Unexpected provider call');};
  const common={Authorization:'Bearer '+f.key,'Content-Type':'application/json'};
  const created=await f.request('/api/v1/garage/vehicles',{method:'POST',headers:common,body:JSON.stringify({name:'Test',kind:'car'})});assert.equal(created.status,201);const vehicle=await created.json();
  const original=f.DB.prepare.bind(f.DB);let injected=false;
  f.DB.prepare=sql=>{const s=original(sql);if(sql.startsWith('INSERT INTO api_requests('))for(const method of ['first','run']){const execute=s[method];s[method]=async function(){injected=true;await original("UPDATE api_keys SET expires_at=1 WHERE id='key'").run();return execute.call(this);};}return s;};
  const route={start:{latitude:40.7,longitude:-74},destination:{latitude:40.71,longitude:-73.99},mode:'driving',notes:'',context_images:[],map:{image:'data:image/png;base64,'+pngHeader(800,600).toString('base64'),width:800,height:600,bounds:{north:40.8,south:40.6,east:-73.9,west:-74.1}}};
  const path=kind==='route'?'/api/v1/route/analyze':'/api/v1/garage/vehicles/'+vehicle.id+'/image';
  const response=await f.request(path,{method:'POST',headers:{...common,'Idempotency-Key':'credential-boundary-'+kind},body:JSON.stringify(kind==='route'?route:{})});
  assert.equal(injected,true);assert.equal(response.status,401);assert.equal((await response.json()).code,'invalid_api_key');assert.equal(providerCalls,0);assert.equal((await original("SELECT credits FROM accounts WHERE user_id='owner'").first()).credits,2);assert.equal((await original('SELECT COUNT(*) AS n FROM api_requests').first()).n,0);
 }finally{globalThis.fetch=savedFetch;f.close();}}
});
