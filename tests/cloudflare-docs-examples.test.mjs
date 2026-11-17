import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
const root=new URL('../cloudflare/frontend/quickstart/',import.meta.url);
const route={status:'proposal',geometry_alignment:{status:'matched'},report_id:7,route_geojson:{type:'FeatureCollection',features:[]},risk_summary:{unit:'modeled_caution_index_0_100',distance_weighted_score:13,probability:false},steps:[{index:1,instruction:'Continue on mapped street',distance_m:642,risk_score:13}],endpoint_inspections:{guidance:[]}};
test('complete JavaScript route example preserves operation identity across reruns, saves GeoJSON and loads its report',()=>{const dir=mkdtempSync(join(tmpdir(),'qrs-doc-node-'));try{let firstState;const script=`import fs from 'node:fs';const calls=[];globalThis.fetch=async(url,options)=>{calls.push({path:new URL(url).pathname,body:options.body,idem:options.headers['Idempotency-Key']});return Response.json(url.endsWith('/account')?{api_credits:3}:${JSON.stringify(route)});};await import(${JSON.stringify(new URL('javascript.mjs',root).href)});fs.writeFileSync('calls.json',JSON.stringify(calls));`;
 for(let i=0;i<2;i++){execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:dir,env:{...process.env,QRS_API_KEY:'example-key-not-a-secret'},stdio:'pipe'});const state=JSON.parse(readFileSync(join(dir,'qrs-operation.json'))),calls=JSON.parse(readFileSync(join(dir,'calls.json')));assert.deepEqual(calls.map(c=>c.path),['/api/v1/account','/api/v1/routes','/api/v1/reports/7']);assert.equal(calls[1].idem,state.idempotency_key);assert.deepEqual(JSON.parse(calls[1].body),state.journey);assert.ok(existsSync(join(dir,'route.geojson')));if(i===0)firstState=state;else assert.deepEqual(state,firstState);}
 }finally{rmSync(dir,{recursive:true,force:true});}});
test('Python httpx and requests examples run a complete route flow with no network and safely reuse persisted requests',()=>{for(const language of ['httpx','requests']){const dir=mkdtempSync(join(tmpdir(),'qrs-doc-python-'));try{const script=`import json,sys,types,runpy,os
calls=[]
route=json.loads(sys.argv[2])
class Response:
 status_code=200
 headers={}
 def __init__(self,path):self.path=path
 def json(self):return {'api_credits':3} if self.path.endswith('/account') else route
class Client:
 def __init__(self,*a,**kw):pass
 def __enter__(self):return self
 def __exit__(self,*a):pass
 def request(self,method,url,**kw):
  calls.append({'path':url.split('https://ride.qroadscan.com')[1],'idem':kw['headers'].get('Idempotency-Key'),'body':kw.get('json')})
  return Response(url)
sys.modules['${language}']=types.SimpleNamespace(Client=Client,Session=Client,Timeout=lambda *a,**k:None)
runpy.run_path(sys.argv[1],run_name='__main__')
first=json.load(open('qrs-operation.json'))
runpy.run_path(sys.argv[1],run_name='__main__')
assert first==json.load(open('qrs-operation.json'))
assert [c['path'] for c in calls]==['/api/v1/account','/api/v1/routes','/api/v1/reports/7']*2
assert calls[1]['idem']==calls[4]['idem']==first['idempotency_key']
assert calls[1]['body']==first['journey']
assert os.path.exists('route.geojson')
`;
 execFileSync(process.env.QRS_TEST_PYTHON||'python3',['-c',script,new URL(language+'.py',root).pathname,JSON.stringify(route)],{cwd:dir,env:{...process.env,QRS_API_KEY:'example-key-not-a-secret'},stdio:'pipe'});
 }finally{rmSync(dir,{recursive:true,force:true});}}});
test('all seven examples document route creation, stable identity, GeoJSON, report retrieval and safe error recovery',()=>{for(const file of ['curl.sh','httpx.py','requests.py','javascript.mjs','go.go','csharp.cs','php.php']){const text=readFileSync(new URL(file,root),'utf8');assert.match(text,/\/api\/v1\/routes/);assert.match(text,/Idempotency-Key/);assert.match(text,/qrs-operation\.json/);assert.match(text,/route\.geojson/);assert.match(text,/\/api\/v1\/reports\//);assert.match(text,/409/);assert.match(text,/QRS_API_KEY/);}});
test('focused quick-start JavaScript makes one route request and displays destination risk',()=>{
 const examples=JSON.parse(readFileSync(new URL('endpoint-examples.json',root),'utf8'));
 const script=`let calls=0;globalThis.fetch=async(url,o)=>{calls++;if(url!=='https://ride.qroadscan.com/api/v1/routes')throw Error('Wrong endpoint');const b=JSON.parse(o.body);if(!b.start||!b.destination||o.headers['Idempotency-Key']!=='same-operation-123456')throw Error('Wrong request');return Response.json({status:'proposal',endpoint_inspections:{destination:{adjacent_section_risk_score:13,access_verified:false}}});};await import('data:text/javascript,'+encodeURIComponent(${JSON.stringify(examples.javascript)}));if(calls!==1)throw Error('Unexpected extra request');`;
 const output=execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,QRS_API_KEY:'example-key-not-a-secret',QRS_REQUEST_ID:'same-operation-123456'},encoding:'utf8'});assert.match(output,/13/);
});
test('focused Python examples each perform just one request and handle a null endpoint score',()=>{
 const examples=JSON.parse(readFileSync(new URL('endpoint-examples.json',root),'utf8'));
 for(const lib of ['httpx','requests']){const script=`import json,sys,types
calls=[]
class Response:
 def raise_for_status(self):pass
 def json(self):return {'status':'needs_context','endpoint_inspections':{'destination':{'adjacent_section_risk_score':None,'access_verified':False}}}
def post(url,**kw):
 assert url=='https://ride.qroadscan.com/api/v1/routes'
 assert kw['headers']['Idempotency-Key']=='same-operation-123456'
 assert 'start' in kw['json'] and 'destination' in kw['json']
 calls.append(url)
 return Response()
sys.modules['${lib}']=types.SimpleNamespace(post=post)
exec(sys.argv[1])
assert len(calls)==1
`;const out=execFileSync(process.env.QRS_TEST_PYTHON||'python3',['-c',script,examples[lib]],{env:{...process.env,QRS_API_KEY:'example-key-not-a-secret',QRS_REQUEST_ID:'same-operation-123456'},encoding:'utf8'});assert.match(out,/needs_context/);assert.match(out,/None/);}
});
