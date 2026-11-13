import {pngHeader,imageryResponse} from './fixtures/image-headers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import worker from '../cloudflare/worker.mjs';
import {passwordHash,hmac} from '../cloudflare/security.mjs';

// Exercise Worker request handlers with real SQLite statements/triggers. Remote
// D1 and Container behavior is checked separately in staging, not mocked here.
const python=`import json,sys,sqlite3
p=json.load(sys.stdin)
c=sqlite3.connect(p['path']); c.row_factory=sqlite3.Row
with c:
 out=[]
 for item in p['queries']:
  before=c.total_changes
  cursor=c.execute(item['sql'],item.get('args',[]))
  rows=[dict(r) for r in cursor.fetchall()]
  out.append({'results':rows,'meta':{'changes':c.total_changes-before}})
print(json.dumps(out))`;
class Database {
 constructor(path){this.path=path;}
 execute(queries){return JSON.parse(execFileSync(process.env.QRS_TEST_PYTHON||'python3',['-c',python],{input:JSON.stringify({path:this.path,queries}),encoding:'utf8'}));}
 prepare(sql){const db=this;const statement={sql,args:[],bind(...args){return {...this,args};},async first(){return db.execute([this])[0].results[0]??null;},async run(){return db.execute([this])[0];},async all(){return db.execute([this])[0];}};return statement;}
 async batch(statements){return this.execute(statements);}
}
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'qrs-worker-test-'));const path=join(directory,'db.sqlite');
 const migrations=new URL('../cloudflare/migrations/',import.meta.url);
 const schema=readdirSync(migrations).filter(x=>x.endsWith('.sql')).sort().map(x=>readFileSync(new URL(x,migrations),'utf8')).join('\n');
 execFileSync(process.env.QRS_TEST_PYTHON||'python3',['-c','import sqlite3,sys; sqlite3.connect(sys.argv[1]).executescript(sys.stdin.read())',path],{input:schema});
 const DB=new Database(path),objects=new Map();let calls=0,fail=false;
 const env={DB,QRS_PASSWORD_PEPPER:'s'.repeat(48),QRS_API_KEY_PEPPER:'p'.repeat(48),QRS_REPORT_KEY:'ab'.repeat(32),REGISTRATION_ENABLED:'true',
  REPORTS:{async put(k,v){objects.set(k,v);},async get(k){return objects.has(k)?{text:async()=>objects.get(k)}:null;}},
  SCANNER:{idFromName:x=>x,get(){return {async fetch(){calls++;if(fail)throw new Error('test scanner failure');return Response.json({label:'High',schema:'qrs-risk-v1',model:'test-model'});}};}},
 };
 for(const id of ['owner','other']){
  await DB.batch([
   DB.prepare('INSERT INTO users VALUES (?,?,?)').bind(id,id+'@example.test',1),
   DB.prepare('INSERT INTO accounts(user_id,credits,updated_at) VALUES (?,2,1)').bind(id),
   DB.prepare('INSERT INTO user_credentials VALUES (?,?,?)').bind(id,await passwordHash('test-password-1234','11'.repeat(16)),'11'.repeat(16)),
  ]);
 }
 const key='qrs_live_0123456789_'+'a'.repeat(48);
 await DB.prepare('INSERT INTO api_keys(id,user_id,key_hash,created_at) VALUES (?,?,?,1)').bind('key','owner',await hmac(env.QRS_API_KEY_PEPPER,key)).run();
 const request=async(path,options={})=>{
  if(options.headers?.Origin==='https://example.test'&&!options.headers['X-CSRF-Token']&&['/auth/login','/auth/register','/auth/password','/auth/logout','/api/session/scans','/api/home/assessment'].includes(path)){
   const token=await worker.fetch(new Request('https://example.test/api/home/csrf'),env);const data=await token.json();
   options={...options,headers:{...options.headers,Cookie:[options.headers.Cookie,token.headers.get('Set-Cookie').split(';')[0]].filter(Boolean).join('; '),'X-CSRF-Token':data.csrf_token}};
  }
  return worker.fetch(new Request('https://example.test'+path,options),env);
 };
 return {env,DB,key,objects,request,calls:()=>calls,setFailure:value=>{fail=value;},close:()=>rmSync(directory,{recursive:true,force:true})};
}
const scene={latitude:40.7,longitude:-74,vehicle_type:'car',destination:'Home',weather:'rain'};
test('unexpected scanner and database exceptions do not expose private message text in logs or responses',async()=>{
 const f=await fixture(),original=console.error,originalFetch=globalThis.fetch,logs=[];const sensitive='PRIVATE-TEST-LOCATION-AND-CREDENTIAL-SENTINEL';
 console.error=(...args)=>logs.push(args);
 try{
  f.env.SCANNER.get=()=>({fetch:async()=>{throw new Error(sensitive);}});
  let r=await f.request('/api/v1/scans',{method:'POST',headers:{Authorization:'Bearer '+f.key,'Content-Type':'application/json','Idempotency-Key':'private-logging-test-12345'},body:JSON.stringify(scene)});
  assert.equal(r.status,503);assert.ok(!(await r.text()).includes(sensitive));
  f.env.OPENAI_API_KEY='test-only-key';globalThis.fetch=async()=>{throw new Error(sensitive);};
  const csrf=await f.request('/api/home/csrf'),token=(await csrf.json()).csrf_token;
  r=await f.request('/api/home/preview',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json',Cookie:csrf.headers.get('Set-Cookie').split(';')[0],'X-CSRF-Token':token},body:'{"mode":"simulation"}'});assert.equal(r.status,503);assert.ok(!(await r.text()).includes(sensitive));
  f.env.DB.prepare=()=>{throw new Error(sensitive);};r=await f.request('/healthz');assert.equal(r.status,500);assert.equal((await r.json()).error,'internal_error');
  assert.ok(logs.some(args=>args[0]==='scan_failed'));assert.ok(logs.some(args=>args[0]==='request_failed'&&args[1]===r.headers.get('X-Request-ID')));assert.ok(!JSON.stringify(logs).includes(sensitive));
 }finally{console.error=original;globalThis.fetch=originalFetch;f.close();}
});
test('model catalog bounds upstream data, cancels oversized streams and preserves normal discovery',async()=>{
 const f=await fixture(),original=globalThis.fetch;try{
  f.env.OPENAI_API_KEY='private-test-provider-key';f.env.ROUTE_MODEL='gpt-6-luna';
  const login=await f.request('/auth/login',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'test-password-1234'})});assert.equal(login.status,200);
  const headers={Cookie:login.headers.get('Set-Cookie').split(';')[0]};let mode='valid',cancelled=false;
  globalThis.fetch=async(url,options)=>{
   assert.equal(url,'https://api.openai.com/v1/models');assert.equal(options.redirect,'manual');
   if(mode==='oversized')return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1048577));},cancel(){cancelled=true;}}));
   if(mode==='malformed')return Response.json({data:{id:'not-an-array'}});
   return Response.json({data:[{id:'gpt-6-luna'},{id:'other-provider-model'}]});
  };
  let r=await f.request('/api/route/models',{headers});assert.equal(r.status,200);const valid=await r.json();assert.equal(valid.available,true);assert.deepEqual(valid.models,['gpt-6-luna']);
  for(mode of ['oversized','malformed']){r=await f.request('/api/route/models',{headers});assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'route_model_catalog_unavailable'});}
  assert.equal(cancelled,true);
 }finally{globalThis.fetch=original;f.close();}
});
test('registration creates an account that can log in and reports duplicate accounts',async()=>{
 const f=await fixture();try{
  const headers={Origin:'https://example.test','Content-Type':'application/json'};
  const user={email:'new-user@example.test',password:'a-new-test-password-1234'};
  let response=await f.request('/auth/register',{method:'POST',headers,body:JSON.stringify(user)});
  assert.equal(response.status,201);
  response=await f.request('/auth/register',{method:'POST',headers,body:JSON.stringify(user)});
  assert.equal(response.status,409);
  response=await f.request('/auth/login',{method:'POST',headers,body:JSON.stringify(user)});
  assert.equal(response.status,200);
  const cookie=response.headers.get('Set-Cookie').split(';')[0];
  response=await f.request('/api/session',{headers:{Cookie:cookie}});
  assert.equal((await response.json()).api_credits,0);
  response=await f.request('/dashboard');assert.equal(response.status,302);
  assert.match(response.headers.get('Location'),/\/login\?next=/);
 }finally{f.close();}
});
test('Worker origin checks, session authentication, and password changes',async()=>{
 const f=await fixture();try{
  const redirect=await worker.fetch(new Request('http://example.test/auth/login',{method:'POST'}),f.env);
  assert.equal(redirect.status,308);assert.equal(redirect.headers.get('Location'),'https://example.test/auth/login');
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'test-password-1234'})};
  assert.equal((await f.request('/auth/login',options)).status,403);
  options.headers.Origin='https://example.test';
  const login=await f.request('/auth/login',options);assert.equal(login.status,200);
  const cookie=login.headers.get('Set-Cookie').split(';')[0];assert.match(login.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);
  assert.equal((await f.request('/api/session',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await f.request('/api/session')).status,401);
  const webScan={method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','Idempotency-Key':'session-request-0001'},body:JSON.stringify(scene)};
  assert.equal((await f.request('/api/session/scans',webScan)).status,403);
  webScan.headers.Origin='https://example.test';
  assert.equal((await f.request('/api/session/scans',webScan)).status,200);
  const visibleKeys=await (await f.request('/api/keys',{headers:{Cookie:cookie}})).json();
  assert.ok(visibleKeys.every(k=>!k.id.startsWith('web:')));
  const change=await f.request('/auth/password',{method:'POST',headers:{Cookie:cookie,Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({current_password:'test-password-1234',new_password:'updated-password-1234'})});
  assert.equal(change.status,200);
  assert.equal((await f.request('/api/session',{headers:{Cookie:cookie}})).status,401);
 }finally{f.close();}
});
test('Worker scans charge once, replay stored ciphertext, and restrict report ownership',async()=>{
 const f=await fixture();try{
  const options={method:'POST',headers:{Authorization:'Bearer '+f.key,'Content-Type':'application/json','Idempotency-Key':'test-request-00000001'},body:JSON.stringify(scene)};
  const response=await f.request('/api/v1/scans',options);assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.harm_level,'High');assert.equal(f.calls(),1);
  const replay=await f.request('/api/v1/scans',options);assert.equal(replay.headers.get('Idempotent-Replay'),'true');assert.deepEqual(await replay.json(),result);assert.equal(f.calls(),1);
  assert.equal((await f.DB.prepare("SELECT credits FROM accounts WHERE user_id='owner'").first()).credits,1);
  assert.ok(![...f.objects.values()][0].includes('Modeled road-scene risk'));
  const otherKey='qrs_live_9876543210_'+'b'.repeat(48);
  await f.DB.prepare('INSERT INTO api_keys(id,user_id,key_hash,created_at) VALUES (?,?,?,1)').bind('other-key','other',await hmac(f.env.QRS_API_KEY_PEPPER,otherKey)).run();
  assert.equal((await f.request('/api/reports/'+result.report_id,{headers:{Authorization:'Bearer '+otherKey}})).status,404);
  assert.equal((await f.request('/api/reports/'+result.report_id,{headers:{Authorization:'Bearer '+f.key}})).status,200);
 }finally{f.close();}
});
test('Worker failures refund once and reject unavailable models before charging',async()=>{
 const f=await fixture();try{
  const options={method:'POST',headers:{Authorization:'Bearer '+f.key,'Content-Type':'application/json','Idempotency-Key':'failed-request-0001'},body:JSON.stringify({...scene,model:'openai'})};
  assert.equal((await f.request('/api/v1/scans',options)).status,503);assert.equal(f.calls(),0);
  options.headers['Content-Type']='text/plain';
  assert.equal((await f.request('/api/v1/scans',options)).status,415);
  options.headers['Content-Type']='application/json';options.body='x'.repeat(32769);
  assert.equal((await f.request('/api/v1/scans',options)).status,413);
  f.setFailure(true);options.body=JSON.stringify(scene);
  assert.equal((await f.request('/api/v1/scans',options)).status,503);
  assert.equal((await f.request('/api/v1/scans',options)).status,409);
  assert.equal((await f.DB.prepare("SELECT credits FROM accounts WHERE user_id='owner'").first()).credits,2);
  assert.equal((await f.DB.prepare('SELECT count(*) AS n FROM credit_ledger').first()).n,2);
  assert.equal((await f.request('/billing/checkout',{method:'POST'})).status,503);
 }finally{f.close();}
});
test('OpenAI dashboard scans and main-page results keep provider identity and reuse paid output',async()=>{
 const f=await fixture(),originalFetch=globalThis.fetch;let providerCalls=0;
 f.env.OPENAI_API_KEY='test-openai-key-never-returned-to-users';
 globalThis.fetch=async(url)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');providerCalls++;
  return Response.json({status:'completed',model:'gpt-5.5',output:[{content:[{type:'output_text',text:JSON.stringify({harm_level:'Medium',summary:'Rain was supplied as an observation.',reasons:['Wet conditions were reported.']})}]}]});
 };
 try{
  const options={method:'POST',headers:{Authorization:'Bearer '+f.key,'Content-Type':'application/json','Idempotency-Key':'openai-request-0001'},body:JSON.stringify({...scene,model:'openai'})};
  const scan=await f.request('/api/v1/scans',options);assert.equal(scan.status,200);
  const report=await scan.json();assert.equal(report.model_used,'openai');assert.equal(report.observations.weather,'rain');assert.equal(providerCalls,1);assert.equal(f.calls(),0);
  const login=await f.request('/auth/login',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'test-password-1234'})});
  const cookie=login.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await f.request('/api/home/assessment',{method:'POST',headers:{Cookie:cookie}})).status,403);
  const homeOptions={method:'POST',headers:{Cookie:cookie,Origin:'https://example.test','Content-Type':'application/json'},body:'{}'};
  const home=await f.request('/api/home/assessment',homeOptions);assert.equal(home.status,200);assert.equal((await home.json()).provider,'openai');assert.equal(providerCalls,1);
  const cached=await f.request('/api/home/assessment',homeOptions);assert.equal((await cached.json()).cached,true);assert.equal(providerCalls,1);
  const config=await (await f.request('/api/config')).json();assert.deepEqual(config.models,['openai','llama_local']);assert.equal(config.home_model.provider,'openai');assert.ok(!JSON.stringify(config).includes(f.env.OPENAI_API_KEY));
 }finally{globalThis.fetch=originalFetch;f.close();}
});
test('main page uses OpenAI for a Llama scene and caches the independent assessment',async()=>{
 const f=await fixture(),originalFetch=globalThis.fetch;let calls=0;
 f.env.OPENAI_API_KEY='test-only-openai-key';
 globalThis.fetch=async(url,options)=>{
  calls++;const body=JSON.parse(options.body);const context=JSON.parse(body.input);
  assert.equal(context.source,'user_supplied_observations');assert.equal(context.observations.weather,'rain');assert.equal(body.model,'gpt-5.5');
  return Response.json({status:'completed',model:'gpt-5.5',output:[{content:[{type:'output_text',text:JSON.stringify({harm_level:'Medium',summary:'Review of supplied rain observations.',reasons:['Wet road conditions were reported.']})}]}]});
 };
 try{
  const scan=await f.request('/api/v1/scans',{method:'POST',headers:{Authorization:'Bearer '+f.key,'Content-Type':'application/json','Idempotency-Key':'local-scene-00000001'},body:JSON.stringify(scene)});assert.equal(scan.status,200);assert.equal(calls,0);
  const login=await f.request('/auth/login',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'test-password-1234'})});
  const cookie=login.headers.get('Set-Cookie').split(';')[0],options={method:'POST',headers:{Cookie:cookie,Origin:'https://example.test'}};
  const home=await f.request('/api/home/assessment',options);assert.equal(home.status,200);const result=await home.json();assert.equal(result.provider,'openai');assert.equal(result.harm_level,'Medium');assert.equal(calls,1);
  const cached=await f.request('/api/home/assessment',options);assert.equal((await cached.json()).cached,true);assert.equal(calls,1);
 }finally{globalThis.fetch=originalFetch;f.close();}
});

test('public homepage requires signed CSRF, shares cached OpenAI preview, and needs no login',async()=>{
 const f=await fixture();const original=globalThis.fetch;let calls=0,weatherCalls=0;
 f.env.OPENAI_API_KEY='test-openai-secret';
 globalThis.fetch=async(url)=>{if(String(url).startsWith('https://api.met.no/')){weatherCalls++;return Response.json({properties:{meta:{updated_at:new Date().toISOString()},timeseries:[{time:new Date().toISOString(),data:{instant:{details:{air_temperature:8,wind_speed:4}},next_1_hours:{summary:{symbol_code:'rain_day'},details:{precipitation_amount:2}}}}]}});}calls++;return Response.json({status:'completed',model:'gpt-5.5',output:[{content:[{type:'output_text',text:JSON.stringify({harm_level:'Medium',harm_ratio:.43,summary:'Illustrative preview only.',reasons:['Damp pavement in the fictional scenario.']})}]}]});};
 try{
  let r=await f.request('/api/home/csrf');assert.equal(r.status,200);
  const token=(await r.json()).csrf_token,cookie=r.headers.get('Set-Cookie').split(';')[0];
  assert.match(r.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);
  const headers={Origin:'https://example.test',Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':token};
  r=await f.request('/api/home/preview',{method:'POST',headers:{...headers,'X-CSRF-Token':'forged'},body:JSON.stringify({latitude:40.758,longitude:-73.9855})});assert.equal(r.status,403);
  r=await f.request('/api/home/preview',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:JSON.stringify({latitude:40.758,longitude:-73.9855})});assert.equal(r.status,403);
  r=await f.request('/api/home/preview',{method:'POST',headers:{...headers,Cookie:cookie.replace(/.$/,'x')},body:JSON.stringify({latitude:40.758,longitude:-73.9855})});assert.equal(r.status,403);
  r=await f.request('/api/home/preview',{method:'POST',headers,body:'{"prompt":"injected"}'});assert.equal(r.status,400);
  r=await f.request('/api/home/preview',{method:'POST',headers,body:JSON.stringify({latitude:40.758,longitude:-73.9855})});assert.equal(r.status,200);
  let data=await r.json();assert.equal(data.harm_ratio,.43);assert.equal(data.label,'Caution');assert.equal(data.source,'current_weather_estimate');assert.equal(data.weather.temperature_c,8);assert.equal(data.location.latitude,40.75);assert.equal(data.cached,false);
  r=await f.request('/api/home/preview',{method:'POST',headers,body:JSON.stringify({latitude:40.758,longitude:-73.9855})});assert.equal(r.status,200);assert.equal((await r.json()).cached,true);assert.equal(calls,1);assert.equal(weatherCalls,1);
  r=await f.request('/api/home/preview',{method:'POST',headers,body:JSON.stringify({latitude:51.5,longitude:-.1})});assert.equal(r.status,200);assert.equal(calls,2);assert.equal(weatherCalls,2);
  const caches=(await f.DB.prepare('SELECT model,payload FROM public_home_previews').all()).results;assert.equal(caches.length,2);
  for(const row of caches){assert.match(row.model,/^weather:[a-f0-9]{64}$/);assert.deepEqual(Object.keys(JSON.parse(row.payload)).sort(),['ct','iv','v']);assert.ok(!row.payload.includes('temperature_c'));}
  assert.equal((await f.DB.prepare('SELECT credits FROM accounts WHERE user_id=?').bind('owner').first()).credits,2);
 }finally{globalThis.fetch=original;f.close();}
});

test('location-free simulation uses a separate prompt, no weather API, and never caches',async()=>{
 const f=await fixture(),original=globalThis.fetch;f.env.OPENAI_API_KEY='test-openai-secret';let calls=0;
 globalThis.fetch=async(url,options)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);assert.match(body.instructions,/fictional road-scene simulator/);
  const context=JSON.parse(body.input);assert.equal(context.source,'simulated_location');assert.match(context.simulation.setting,/fictional/);assert.equal(context.weather,undefined);
  return Response.json({status:'completed',model:'gpt-5.5',output:[{content:[{type:'output_text',text:JSON.stringify({harm_level:'Medium',harm_ratio:.51,summary:'A simulated fictional road scene.',reasons:['Simulated wet road.']})}]}]});
 };
 try{
  const csrf=await f.request('/api/home/csrf'),token=(await csrf.json()).csrf_token;
  const headers={Origin:'https://example.test','Content-Type':'application/json',Cookie:csrf.headers.get('Set-Cookie').split(';')[0],'X-CSRF-Token':token};
  let r=await f.request('/api/home/preview',{method:'POST',headers,body:JSON.stringify({mode:'simulation'})});assert.equal(r.status,200);let data=await r.json();assert.equal(data.source,'simulated_location');assert.equal(data.harm_ratio,.51);assert.equal(data.weather,undefined);assert.equal(data.location,undefined);assert.equal(data.cached,false);
  r=await f.request('/api/home/preview',{method:'POST',headers,body:JSON.stringify({mode:'simulation'})});const next=await r.json();assert.equal(next.cached,false);assert.equal(next.expires_at,null);assert.notEqual(next.assessment_id,data.assessment_id);assert.equal(calls,2);
  assert.equal((await f.DB.prepare('SELECT count(*) AS count FROM public_home_previews').first()).count,0);
  r=await f.request('/api/home/preview',{method:'POST',headers,body:JSON.stringify({mode:'simulation',prompt:'arbitrary'})});assert.equal(r.status,400);assert.equal(calls,2);
 }finally{globalThis.fetch=original;f.close();}
});

test('Grok homepage selects xAI only and keeps uncached original reading fields',async()=>{
 const f=await fixture(),original=globalThis.fetch;f.env.HOME_PROVIDER='grok';f.env.GROK_API_KEY='test-grok-secret';let calls=0;
 globalThis.fetch=async(url)=>{calls++;assert.equal(url,'https://api.x.ai/v1/chat/completions');return Response.json({model:'grok-4-1-fast-non-reasoning',choices:[{finish_reason:'stop',message:{content:JSON.stringify({harm_ratio:.31,label:'Light Caution',color:'#b3f442',confidence:.73,reasons:['Simulated cautious scene.','Keep a steady gap.'],blurb:'Leave room for changing conditions.'})}}]});};
 try{
  let r=await f.request('/api/config');assert.equal((await r.json()).home_model.provider,'grok');
  const csrf=await f.request('/api/home/csrf'),token=(await csrf.json()).csrf_token;
  const headers={Origin:'https://example.test','Content-Type':'application/json',Cookie:csrf.headers.get('Set-Cookie').split(';')[0],'X-CSRF-Token':token};
  r=await f.request('/api/home/preview',{method:'POST',headers,body:'{"mode":"simulation"}'});assert.equal(r.status,200);const data=await r.json();assert.equal(data.provider,'grok');assert.equal(data.color,'#b3f442');assert.equal(data.confidence,.73);assert.equal(data.blurb,'Leave room for changing conditions.');assert.equal(data.cached,false);assert.equal(calls,1);
  assert.equal((await f.DB.prepare('SELECT count(*) AS count FROM public_home_previews').first()).count,0);
 }finally{globalThis.fetch=original;f.close();}
});

test('visual route analysis requires session and CSRF, charges once, replays and refunds failures',async()=>{
 const f=await fixture(),original=globalThis.fetch;f.env.OPENAI_API_KEY='test-openai';f.env.ROUTE_MODEL='gpt-6-luna';let calls=0,broken=false,contextOnly=false;
 const mapBounds={north:40.8,south:40.7,east:-73.9,west:-74.1};
 const image='data:image/png;base64,'+pngHeader().toString('base64');
 const input={start:{latitude:40.75,longitude:-74},destination:{latitude:40.75,longitude:-74},mode:'walking',notes:'Test',map:{image,width:800,height:600,bounds:mapBounds},context_images:[]};
 globalThis.fetch=async(url,options)=>{if(imageryResponse(url))return imageryResponse(url);if(url.startsWith('https://api.met.no/'))return new Response('',{status:503});calls++;if(broken)throw Error('fixture provider failure');const b=JSON.parse(options.body),facts=JSON.parse(b.input[0].content[0].text);return Response.json({status:'completed',model:'gpt-6-luna',output:[{content:[{type:'output_text',text:JSON.stringify({status:contextOnly?'needs_context':'proposal',summary:'Visual proposal.',endpoint_guidance:[],limitations:['No verified navigation.'],segments:contextOnly?[]:[{id:0,street:'Test',instruction:'Proposed path.',risk_score:null,risk_reason:'Unknown.',evidence:'uncertain',points:[facts.start_pixel,facts.destination_pixel]}]})}]}]});};
 try{
  const origin={'Origin':'https://example.test','Content-Type':'application/json'};
  let r=await f.request('/auth/login',{method:'POST',headers:origin,body:JSON.stringify({email:'owner@example.test',password:'test-password-1234'})});const session=r.headers.get('Set-Cookie').split(';')[0];
  const csrf=await f.request('/api/home/csrf'),token=(await csrf.json()).csrf_token,cookie=session+'; '+csrf.headers.get('Set-Cookie').split(';')[0];
  const headers={...origin,Cookie:cookie,'X-CSRF-Token':token,'Idempotency-Key':'visual-test-request-1234'};
  r=await f.request('/api/route/analyze',{method:'POST',headers:{...headers,'X-CSRF-Token':'bad'},body:JSON.stringify(input)});assert.equal(r.status,403);assert.equal(calls,0);
  r=await f.request('/api/route/analyze',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(r.status,200);const report=await r.json();assert.equal(report.provenance.routing_engine,false);assert.equal((await f.DB.prepare('SELECT credits FROM accounts WHERE user_id=?').bind('owner').first()).credits,1);
  r=await f.request('/api/route/analyze',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(r.status,200);assert.equal(r.headers.get('Idempotent-Replay'),'true');assert.equal(calls,1);assert.ok(![...f.objects.values()].join('').includes(image));
  broken=true;r=await f.request('/api/route/analyze',{method:'POST',headers:{...headers,'Idempotency-Key':'visual-failed-request-1234'},body:JSON.stringify(input)});assert.equal(r.status,503);const failed=await r.json();assert.equal(failed.failure.stage,'visual_model');assert.equal(failed.failure.reason,'unexpected_failure');assert.ok(!JSON.stringify(failed).includes('fixture provider failure'));assert.equal((await f.DB.prepare('SELECT credits FROM accounts WHERE user_id=?').bind('owner').first()).credits,1);
  broken=false;contextOnly=true;
  r=await f.request('/api/route/analyze',{method:'POST',headers:{...headers,'Idempotency-Key':'visual-context-request-1234'},body:JSON.stringify(input)});assert.equal(r.status,200);assert.equal((await r.json()).scan_credit_refunded,true);assert.equal((await f.DB.prepare('SELECT credits FROM accounts WHERE user_id=?').bind('owner').first()).credits,1);assert.equal(f.objects.size,1);
 }finally{globalThis.fetch=original;f.close();}
});

test('support grants settle from the ledger exactly once without purchases',async()=>{
 const f=await fixture();try{
  const sql="INSERT OR IGNORE INTO credit_ledger(id,user_id,delta,reason,external_ref,created_at) VALUES ('support-test','owner',10,'operator_support_grant','support-test',1)";
  await f.DB.prepare(sql).run();await f.DB.prepare(sql).run();assert.equal((await f.DB.prepare("SELECT credits FROM accounts WHERE user_id='owner'").first()).credits,12);
  assert.equal((await f.DB.prepare("SELECT count(*) AS count FROM credit_ledger WHERE external_ref='support-test'").first()).count,1);
 }finally{f.close();}
});

test('Census fallback recovers residential house searches and labels precision',async()=>{
 const f=await fixture(),original=globalThis.fetch;const called=[];
 globalThis.fetch=async url=>{called.push(url);return url.includes('nominatim')?Response.json([{lat:'34.8',lon:'-82.6',display_name:'201 OTHER HOUSE',address:{house_number:'201'}}]):Response.json({result:{addressMatches:[{matchedAddress:'100 EXAMPLE LN, EASLEY, SC',coordinates:{x:-82.6,y:34.8}}]}});};
 try{
  const origin={Origin:'https://example.test','Content-Type':'application/json'};let r=await f.request('/auth/login',{method:'POST',headers:origin,body:JSON.stringify({email:'owner@example.test',password:'test-password-1234'})});const session=r.headers.get('Set-Cookie').split(';')[0];const csrf=await f.request('/api/home/csrf'),token=(await csrf.json()).csrf_token;
  const headers={...origin,Cookie:session+'; '+csrf.headers.get('Set-Cookie').split(';')[0],'X-CSRF-Token':token};
  r=await f.request('/api/route/geocode',{method:'POST',headers,body:JSON.stringify({query:'100 Example Ln Apt 7, Easley SC'})});assert.equal(r.status,200);const places=await r.json();assert.equal(places.length,1);assert.equal(places[0].source,'US Census Geocoder');assert.equal(places[0].precision,'interpolated_address');assert.equal(places[0].unit_removed,true);assert.equal(called.length,2);assert.ok(called.every(url=>!url.includes('Apt')));
 }finally{globalThis.fetch=original;f.close();}
});
