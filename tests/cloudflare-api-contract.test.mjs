import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './fixtures/account-worker.mjs';
import {API_SCOPES} from '../cloudflare/public/pages/api-scopes.mjs';
import {validateScopes} from '../cloudflare/api-contract.mjs';
import {hmac} from '../cloudflare/security.mjs';
import {markerSVG,markerPalette,vehicleKindHint} from '../cloudflare/public/pages/vehicle-marker.mjs';
import {pngHeader} from './fixtures/image-headers.mjs';
const scene={latitude:40.7,longitude:-74,vehicle_type:'car',destination:'Example',model:'llama_local',language:'en'};
const call=(f,path,method='GET',body,headers={})=>f.request(path,{method,headers:{Authorization:'Bearer '+f.key,'Content-Type':'application/json',...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
test('rotating API keys cannot bypass the account scan limit and stored replays remain available',async()=>{
 const f=await fixture();try{
  const headers={'Idempotency-Key':'account-budget-original-1'};
  const first=await call(f,'/api/v1/scans','POST',scene,headers);assert.equal(first.status,200);
  const now=Math.floor(Date.now()/1000),bucket='scan-user:owner:'+Math.floor(now/60);
  await f.DB.prepare('UPDATE rate_limits SET count=20 WHERE key=?').bind(bucket).run();
  const alternate='qrs_live_9876543210_'+'b'.repeat(48);
  await f.DB.prepare('INSERT INTO api_keys(id,user_id,key_hash,created_at) VALUES (?,?,?,?)').bind('alternate','owner',await hmac(f.env.QRS_API_KEY_PEPPER,alternate),now).run();
  for(const key of [f.key,alternate]){
   const r=await call(f,'/api/v1/scans','POST',scene,{'Authorization':'Bearer '+key,'Idempotency-Key':'account-budget-blocked-1'});assert.equal(r.status,429);assert.ok(Number(r.headers.get('Retry-After'))>0);
  }
  const login=await f.request('/auth/login',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'test-password-1234'})});assert.equal(login.status,200);
  const browser=await f.request('/api/session/scans',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json',Cookie:login.headers.get('Set-Cookie').split(';')[0],'Idempotency-Key':'browser-budget-blocked-1'},body:JSON.stringify(scene)});assert.equal(browser.status,429);
  const replay=await call(f,'/api/v1/scans','POST',scene,headers);assert.equal(replay.status,200);assert.equal(replay.headers.get('Idempotent-Replay'),'true');
  assert.equal(f.calls(),1);assert.equal((await f.DB.prepare("SELECT credits FROM accounts WHERE user_id='owner'").first()).credits,1);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM api_requests').first()).n,1);
 }finally{f.close();}
});
test('an account-only key cannot reach protected feature scopes or browser administration',async()=>{
 const f=await fixture();try{
  await f.DB.prepare('UPDATE api_keys SET scopes=? WHERE id=?').bind(JSON.stringify(['account:read']),'key').run();
  const id='11111111-1111-4111-8111-111111111111';
  for(const [path,method,scope] of [
   ['/api/v1/reports','GET','scans:read'],['/api/v1/scans','POST','scans:write'],
   ['/api/v1/route/analyze','POST','routes:write'],['/api/v1/route/atlas','POST','routes:write'],
   ['/api/v1/garage/vehicles','GET','garage:read'],['/api/v1/garage/vehicles','POST','garage:write'],
   ['/api/v1/garage/vehicles/'+id+'/image','GET','images:read'],['/api/v1/garage/vehicles/'+id+'/image','POST','images:write'],
   ['/api/v1/aviation/snapshot','POST','aviation:read'],['/api/v1/aviation/briefing','POST','aviation:review'],
   ['/api/v1/operations/'+id,'GET','operations:read']]){
   const r=await call(f,path,method,method==='POST'?{}:undefined);assert.equal(r.status,403,path);assert.equal((await r.json()).required_scope,scope,path);
  }
  for(const path of ['/api/admin/overview','/api/security/sessions','/api/keys'])assert.equal((await call(f,path)).status,401,path);
  assert.equal(f.calls(),0);assert.equal((await f.DB.prepare('SELECT credits FROM accounts WHERE user_id=?').bind('owner').first()).credits,2);
 }finally{f.close();}
});
test('scopes are bounded and least-privilege denial returns a correlated problem document',async()=>{assert.deepEqual(validateScopes(undefined),API_SCOPES);assert.throws(()=>validateScopes(['admin:*']));assert.throws(()=>validateScopes(['account:read','account:read']));const f=await fixture();try{await f.DB.prepare('UPDATE api_keys SET scopes=? WHERE id=?').bind(JSON.stringify(['account:read']),'key').run();assert.equal((await call(f,'/api/v1/account')).status,200);assert.equal((await call(f,'/api/session')).status,401);const legacy=await call(f,'/api/reports');assert.equal(legacy.status,403);assert.equal(legacy.headers.get('RateLimit-Limit'),'120');const r=await call(f,'/api/v1/garage/vehicles','POST',{name:'No write',kind:'car'}),problem=await r.json();assert.equal(r.status,403);assert.match(r.headers.get('Content-Type'),/problem\+json/);assert.equal(problem.required_scope,'garage:write');assert.equal(problem.request_id,r.headers.get('X-Request-ID'));assert.match(r.headers.get('WWW-Authenticate'),/insufficient_scope/);const meta=await(await call(f,'/api/v1/key')).json();assert.deepEqual(meta.scopes,['account:read']);assert.ok(!JSON.stringify(meta).includes(f.key));}finally{f.close();}});
test('report cursors paginate stably, reject tampering and bind to the owner',async()=>{const f=await fixture();try{const responses=[];for(let i=0;i<2;i++){const r=await call(f,'/api/v1/scans','POST',scene,{'Idempotency-Key':'cursor-scene-request-'+i});assert.equal(r.status,200);responses.push(await r.json());}const first=await(await call(f,'/api/v1/reports?limit=1')).json();assert.equal(first.data.length,1);assert.equal(first.pagination.has_more,true);const next=await(await call(f,'/api/v1/reports?limit=1&cursor='+encodeURIComponent(first.pagination.next_cursor))).json();assert.equal(next.data.length,1);assert.notEqual(first.data[0].report_id,next.data[0].report_id);assert.equal(next.pagination.next_cursor,null);const bad=first.pagination.next_cursor.slice(0,-1)+(first.pagination.next_cursor.endsWith('0')?'1':'0');assert.equal((await call(f,'/api/v1/reports?cursor='+bad)).status,400);const read=await call(f,first.data[0].url);assert.equal(read.status,200);await f.DB.prepare("UPDATE api_keys SET user_id='other' WHERE id='key'").run();assert.equal((await call(f,'/api/v1/reports?cursor='+encodeURIComponent(first.pagination.next_cursor))).status,400);assert.equal((await call(f,first.data[0].url)).status,404);}finally{f.close();}});
test('operation status is owner-scoped and cannot cross an idempotency operation kind',async()=>{const f=await fixture();try{const idem='operation-type-check-12345',r=await call(f,'/api/v1/scans','POST',scene,{'Idempotency-Key':idem}),scan=await r.json();assert.equal(r.status,200);assert.ok(scan.operation_id);const op=await(await call(f,'/api/v1/operations/'+scan.operation_id)).json();assert.equal(op.status,'completed');assert.equal(op.kind,'scan');assert.equal(op.resource.url,'/api/v1/reports/'+scan.report_id);const vehicle=await(await call(f,'/api/v1/garage/vehicles','POST',{name:'Example',kind:'car'})).json();assert.equal((await call(f,'/api/v1/garage/vehicles/'+vehicle.id+'/image','POST',{}, {'Idempotency-Key':idem})).status,409);assert.equal(f.calls(),1);await f.DB.prepare("UPDATE api_keys SET user_id='other' WHERE id='key'").run();assert.equal((await call(f,'/api/v1/operations/'+scan.operation_id)).status,404);}finally{f.close();}});
test('API baseline rate limits expose bounded counters and retry seconds',async()=>{const f=await fixture();try{const now=Math.floor(Date.now()/1000),bucket='api:key:'+Math.floor(now/60);await f.DB.prepare('INSERT INTO rate_limits VALUES (?,120,?)').bind(bucket,now+60).run();const r=await call(f,'/api/v1/capabilities');assert.equal(r.status,429);assert.equal(r.headers.get('RateLimit-Limit'),'120');assert.equal(r.headers.get('RateLimit-Remaining'),'0');assert.ok(Number(r.headers.get('Retry-After'))>0);assert.ok(Number(r.headers.get('Retry-After'))<=60);}finally{f.close();}});
test('visual route API requires its scope before provider work and rejects incompatible vehicles',async()=>{const f=await fixture();try{await f.DB.prepare('UPDATE api_keys SET scopes=?').bind(JSON.stringify(['garage:read'])).run();assert.equal((await call(f,'/api/v1/route/geocode','POST',{query:'Example town'})).status,403);await f.DB.prepare('UPDATE api_keys SET scopes=?').bind(JSON.stringify(API_SCOPES)).run();f.env.OPENAI_API_KEY='test';const plane=await(await call(f,'/api/v1/garage/vehicles','POST',{name:'Plane',kind:'aircraft'})).json();const body={vehicle_id:plane.id,start:{latitude:40.7,longitude:-74},destination:{latitude:40.71,longitude:-73.99},mode:'driving',notes:'',context_images:[],map:{image:'data:image/png;base64,'+pngHeader(800,600).toString('base64'),width:800,height:600,bounds:{north:40.8,south:40.6,east:-73.9,west:-74.1}}};const r=await call(f,'/api/v1/route/analyze','POST',body,{'Idempotency-Key':'plane-cannot-road-12345'});assert.equal(r.status,400);assert.equal((await r.json()).code,'vehicle_mode_incompatible');}finally{f.close();}});
test('transparent marker output is constrained, type-specific and safe for hostile color/name strings',()=>{for(const kind of ['car','truck','motorcycle','aircraft','train']){const svg=markerSVG({kind,color:'olive camouflage',name:'<script>alert(1)</script>'});assert.ok(svg.startsWith('<svg'));assert.ok(!svg.includes('<script'));assert.ok(!svg.includes('onload'));assert.ok(!svg.includes('href='));assert.ok(!svg.includes('<rect width="80" height="112"'));}assert.equal(markerPalette({color:'red\" onload=evil'}).body,'#df4b56');assert.equal(vehicleKindHint({make:'Kawasaki',model:'z125 pro'}),'motorcycle');assert.equal(vehicleKindHint({make:'Kawasaki',model:'Other'}),null);});
