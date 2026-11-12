import {apiUtilities,requireScope} from './api-contract.mjs';
import {garageRoutes,cleanupGarage} from './garage.mjs';
import {aviationRoutes} from './aviation.mjs';
import {vehicleFor,guidanceScope} from './vehicle-profile.mjs';
import {securityRoutes,isAdmin} from './account-security.mjs';
import {captureRouteImagery} from './route-imagery.mjs';
import {analyzeVisualRoute,validateVisualRequest,coordinate} from './visual-route.mjs';
import {geocode} from './geocode.mjs';
import {verifyBrowserCSRF} from './public-home.mjs';
import {publicHomeCSRF,publicHomePreview} from './public-home.mjs';
import { hmac,sha256,randomToken,passwordHash,sameSecret,readJSON,validateScan,encryptReport,decryptReport } from './security.mjs';
import { assessWithOpenAI } from './openai.mjs';
const now=()=>Math.floor(Date.now()/1000);
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const fail=(message,status)=>{throw Object.assign(new Error(message),{status});};
const query=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const reportPath=(user,id)=>`reports/${user}/${id}.json`;
const homePath=(user,id)=>`reports/${user}/home-${id}.json`;

async function homeAssessment(request,env){
  browserOrigin(request);const p=await principal(request,env);
  if(!p.session_hash)fail('login_required',401);
  if(!env.OPENAI_API_KEY)fail('home_model_not_configured',503);
  const model=env.OPENAI_HOME_MODEL??'gpt-5.5';
  const source=await query(env,"SELECT id,rowid AS report_id,created_at FROM api_requests WHERE user_id=? AND status='completed' AND operation_kind!='image' AND created_at>=? ORDER BY created_at DESC,rowid DESC LIMIT 1",p.user_id,now()-90*86400).first();
  if(!source)fail('home_source_required',409);
  const existing=await query(env,'SELECT id,status,lease_expires_at FROM home_assessments WHERE user_id=? AND source_request_id=? AND model=?',p.user_id,source.id,model).first();
  if(existing?.status==='completed'){
    const object=await env.REPORTS.get(homePath(p.user_id,existing.id));
    if(object)return json({...await decryptReport(env.QRS_REPORT_KEY,p.user_id,'home:'+existing.id,await object.text()),cached:true});
    await query(env,"UPDATE home_assessments SET status='failed',lease_expires_at=0 WHERE id=? AND status='completed'",existing.id).run();
  }
  const id=crypto.randomUUID();
  const claimed=await query(env,`INSERT INTO home_assessments(id,user_id,source_request_id,model,status,lease_expires_at,created_at,updated_at)
    VALUES (?,?,?,?,'reserved',?,?,?)
    ON CONFLICT(user_id,source_request_id,model) DO UPDATE SET status='reserved',lease_expires_at=excluded.lease_expires_at,updated_at=excluded.updated_at
    WHERE home_assessments.status!='completed' AND home_assessments.lease_expires_at<? RETURNING id`,id,p.user_id,source.id,model,now()+120,now(),now(),now()).first();
  if(!claimed){
    const state=await query(env,'SELECT status FROM home_assessments WHERE user_id=? AND source_request_id=? AND model=?',p.user_id,source.id,model).first();
    if(state?.status==='reserved')return json({status:'processing'},202);
    fail('home_model_unavailable',503);
  }
  try{
    const object=await env.REPORTS.get(reportPath(p.user_id,source.id));if(!object)throw new Error('Source report unavailable');
    const report=await decryptReport(env.QRS_REPORT_KEY,p.user_id,source.id,await object.text());
    const context=report.observations?{source:'user_supplied_observations',observations:report.observations}:{source:'stored_model_report_review',report_text:report.result};
    let result=report.provider_assessment?.provider==='openai'&&report.provider_assessment.model_requested===model?report.provider_assessment:null;
    if(!result){
      await limit(env,'home-openai:'+p.user_id,4,3600);
      await limit(env,'home-openai-global',30,3600);
      result=await assessWithOpenAI(env.OPENAI_API_KEY,model,context);
    }
    const payload={...result,source_report_id:source.report_id,source_created_at:source.created_at,source:context.source,created_at:now()};
    await env.REPORTS.put(homePath(p.user_id,claimed.id),await encryptReport(env.QRS_REPORT_KEY,p.user_id,'home:'+claimed.id,payload),{httpMetadata:{contentType:'application/json'}});
    await query(env,"UPDATE home_assessments SET status='completed',updated_at=? WHERE id=? AND status='reserved'",now(),claimed.id).run();
    return json({...payload,cached:false});
  }catch(e){
    await query(env,"UPDATE home_assessments SET status='failed',lease_expires_at=?,updated_at=? WHERE id=? AND status='reserved'",now()+60,now(),claimed.id).run();
    console.error('home_openai_failed',claimed.id,e.status??e.message);
    fail(e.status===429?'rate_limit_exceeded':'home_model_unavailable',e.status===429?429:503);
  }
}

async function limit(env,key,count=30,seconds=300){
  const window=Math.floor(now()/seconds);
  const row=await query(env,`INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`,`${key}:${window}`,now()+seconds).first();
  const rate={limit:count,remaining:Math.max(0,count-row.count),reset:(window+1)*seconds};if(row.count>count)throw Object.assign(new Error('rate_limit_exceeded'),{status:429,rate,retry_after:Math.max(1,rate.reset-now())});return rate;
}
async function principal(request,env,apiOnly=false){
  const authorization=request.headers.get('Authorization');
  if(authorization){
    const match=/^Bearer (qrs_live_[A-Za-z0-9_-]{10}_[A-Za-z0-9_-]{40,})$/i.exec(authorization);
    if(!match)fail('invalid_api_key',401);
    const row=await query(env,`SELECT k.id AS key_id,k.user_id,k.scopes AS key_scopes,k.expires_at AS key_expires_at,u.email FROM api_keys k JOIN users u ON u.id=k.user_id
      WHERE k.key_hash=? AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>?)`,await hmac(env.QRS_API_KEY_PEPPER,match[1]),now()).first();
    if(!row)fail('invalid_api_key',401);await query(env,'UPDATE api_keys SET last_used_at=? WHERE id=?',now(),row.key_id).run();return row;
  }
  if(apiOnly)fail('invalid_api_key',401);
  const token=/\b__Host-qrs_session=([a-f0-9]{64})\b/.exec(request.headers.get('Cookie')??'')?.[1];
  if(!token)fail('login_required',401);
  const row=await query(env,`SELECT s.user_id,u.email FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`,await sha256(token),now()).first();
  if(!row)fail('login_required',401);
  return {...row,session_hash:await sha256(token)};
}
function browserOrigin(request){
  if(request.headers.get('Origin')!==new URL(request.url).origin)fail('invalid_origin',403);
}
async function account(env,user){
  const a=await query(env,'SELECT plan,credits FROM accounts WHERE user_id=?',user).first();
  return {plan:a.plan,status:'active',api_credits:a.credits};
}
async function replay(env,p,row){
  if(row.status!=='completed')fail('idempotency_conflict',409);
  const obj=await env.REPORTS.get(reportPath(p.user_id,row.id));
  if(!obj)fail('report_unavailable',503);
  const payload=await decryptReport(env.QRS_REPORT_KEY,p.user_id,row.id,await obj.text());
  return json(payload,200,{'Idempotent-Replay':'true'});
}
async function runScan(request,env,p){
  const idem=request.headers.get('Idempotency-Key');
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(idem??''))fail('invalid_idempotency_key',400);
  let scan;try{scan=validateScan(await readJSON(request));}catch(e){fail(e.message,e.status??400);}
  if(!['llama_local','openai'].includes(scan.model)||(scan.model==='openai'&&!env.OPENAI_API_KEY))fail('model_unavailable',503);
  if(scan.language!=='en')fail('language_unavailable',503);
  const keyID=p.key_id;
  await limit(env,'scan:'+keyID,20,60);
  const existing=await query(env,'SELECT id,status,operation_kind FROM api_requests WHERE api_key_id=? AND idempotency_key=?',keyID,idem).first();
  if(existing){if(existing.operation_kind!=='scan')fail('idempotency_conflict',409);return replay(env,p,existing);}
  const id=crypto.randomUUID();let reservation;
  try{
    reservation=await query(env,`INSERT INTO api_requests(id,api_key_id,user_id,idempotency_key,status,lease_expires_at,created_at,updated_at)
      VALUES (?,?,?,?,'reserved',?,?,?) RETURNING rowid`,id,keyID,p.user_id,idem,now()+900,now(),now()).first();
  }catch(e){
    const race=await query(env,'SELECT id,status,operation_kind FROM api_requests WHERE api_key_id=? AND idempotency_key=?',keyID,idem).first();
    if(race){if(race.operation_kind!=='scan')fail('idempotency_conflict',409);return replay(env,p,race);}
    if(String(e).includes('reservation_not_allowed'))fail('insufficient_api_credits',402);
    throw e;
  }
  try{
    const scene={...Object.fromEntries(['vehicle_type','destination','road_type','weather','traffic','obstacles','sensor_notes'].map(k=>[k,scan[k]])),location:`${scan.latitude}, ${scan.longitude}`};
    let classified,assessment;
    if(scan.model==='openai'){
      assessment=await assessWithOpenAI(env.OPENAI_API_KEY,env.OPENAI_SCAN_MODEL??'gpt-5.5',{source:'user_supplied_observations',observations:scan});
      classified={label:assessment.harm_level,schema:'qrs-risk-v1',model:assessment.model_used};
    }else{
      const stub=env.SCANNER.get(env.SCANNER.idFromName('roadscanner-singleton'));
      const response=await stub.fetch('http://scanner/v1/classify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene})});
      if(!response.ok)throw new Error('Scanner unavailable');
      classified=await response.json();
    }
    if(!['Low','Medium','High'].includes(classified.label)||classified.schema!=='qrs-risk-v1')throw new Error('Invalid scanner response');
    const payload={operation_id:id,result:assessment?assessment.summary+'\n\n'+assessment.reasons.map(reason=>'• '+reason).join('\n'):`Modeled road-scene risk: ${classified.label}. Weather: ${scan.weather}. Traffic: ${scan.traffic}. Road type: ${scan.road_type}. Obstacles: ${scan.obstacles}. This classification uses supplied observations; obey physical signals and road conditions.`,
      harm_level:classified.label,language:'en',model_used:scan.model,report_id:reservation.rowid,
      observations:scan,
      ...(assessment?{provider_assessment:assessment}:{}),
      language_audit:{requested:'en',actual:'en'},provenance:{source:'user_supplied_observations',model:classified.model}};
    await env.REPORTS.put(reportPath(p.user_id,id),await encryptReport(env.QRS_REPORT_KEY,p.user_id,id,payload),{httpMetadata:{contentType:'application/json'}});
    const result=await query(env,"UPDATE api_requests SET status='completed',updated_at=? WHERE id=? AND status='reserved'",now(),id).run();
    if(result.meta.changes!==1)throw new Error('Settlement failed');
    return json(payload);
  }catch(e){
    await query(env,"UPDATE api_requests SET status='refunded',updated_at=? WHERE id=? AND status='reserved'",now(),id).run();
    console.error('scan_failed',id,String(e.message));
    fail('scan_unavailable',503);
  }
}
async function runVisualRoute(request,env,p){
  if(!env.OPENAI_API_KEY)fail('route_model_not_configured',503);
  const idem=request.headers.get('Idempotency-Key');if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(idem??''))fail('invalid_idempotency_key',400);
  const input=validateVisualRequest(await readJSON(request,4000000));
  if(input.vehicle_id){input.vehicle=await vehicleFor(env,p.user_id,input.vehicle_id);if(!['car','motorcycle','truck'].includes(input.vehicle.kind))fail('vehicle_mode_incompatible',400);input.vehicle_scope=guidanceScope(input.vehicle);}
  const keyID=p.key_id??'web:'+p.user_id;
  await query(env,'INSERT OR IGNORE INTO api_keys(id,user_id,key_hash,created_at) VALUES (?,?,?,?)',keyID,p.user_id,await hmac(env.QRS_API_KEY_PEPPER,'web-session-v1:'+p.user_id),now()).run();
  const prior=await query(env,'SELECT id,status,operation_kind FROM api_requests WHERE api_key_id=? AND idempotency_key=?',keyID,idem).first();if(prior){if(prior.operation_kind!=='route')fail('idempotency_conflict',409);if(prior.status==='refunded')fail('route_analysis_failed',409);return replay(env,p,prior);}
  await limit(env,'visual-route:'+p.user_id,6,3600);await limit(env,'visual-route-global',60,3600);
  const id=crypto.randomUUID();let reservation;
  try{reservation=await query(env,`INSERT INTO api_requests(id,api_key_id,user_id,idempotency_key,status,lease_expires_at,created_at,updated_at,operation_kind) VALUES (?,?,?,?,'reserved',?,?,?,'route') RETURNING rowid`,id,keyID,p.user_id,idem,now()+900,now(),now()).first();}
  catch(e){const race=await query(env,'SELECT id,status,operation_kind FROM api_requests WHERE api_key_id=? AND idempotency_key=?',keyID,idem).first();if(race){if(race.operation_kind!=='route')fail('idempotency_conflict',409);return replay(env,p,race);}if(String(e).includes('reservation_not_allowed'))fail('insufficient_api_credits',402);throw e;}
  try{
    const assessment=await analyzeVisualRoute(env,input);
    const scores=assessment.segments.map(s=>s.risk_score).filter(Number.isFinite),peak=scores.length?Math.max(...scores):null;
    const payload={...assessment,operation_id:id,report_id:reservation.rowid,result:assessment.summary,harm_level:peak===null?'Unknown':peak<40?'Low':peak<75?'Medium':'High',language:'en',start:input.start,destination:input.destination,mode:input.mode,vehicle:input.vehicle?{id:input.vehicle.id,name:input.vehicle.name,kind:input.vehicle.kind,specs:input.vehicle.specs}:null};
    if(assessment.status==='needs_context'){
      await query(env,"UPDATE api_requests SET status='refunded',updated_at=? WHERE id=? AND status='reserved'",now(),id).run();
      return json({...payload,report_id:null,scan_credit_refunded:true,credits_used:0});
    }
    await env.REPORTS.put(reportPath(p.user_id,id),await encryptReport(env.QRS_REPORT_KEY,p.user_id,id,payload),{httpMetadata:{contentType:'application/json'}});
    const settled=await query(env,"UPDATE api_requests SET status='completed',updated_at=? WHERE id=? AND status='reserved'",now(),id).run();if(settled.meta.changes!==1)throw new Error('Route settlement failed');return json(payload);
  }catch(e){await query(env,"UPDATE api_requests SET status='refunded',updated_at=? WHERE id=? AND status='reserved'",now(),id).run();console.error('visual_route_failed',id,/^Route model failed: HTTP [0-9]{3} \([A-Za-z0-9_.-]+\)$/.test(e.message??'')?e.message:'invalid_or_unavailable_analysis');fail('route_analysis_unavailable',503);}
}
async function routes(request,env,context){
  const url=new URL(request.url), path=url.pathname;
  if(path.startsWith('/billing/'))fail('payments_disabled',503);
  // Every cookie/browser mutation, including sign-in, requires a signed CSRF token.
  // Bearer-only v1 scans do not use ambient browser credentials.
  if(!['GET','HEAD','OPTIONS'].includes(request.method)&&!path.startsWith('/api/v1/'))await verifyBrowserCSRF(request,env);
  if(path==='/admin'&&request.method==='GET'){const p=await principal(request,env);if(!p.session_hash||!await isAdmin(env,p.user_id))fail('admin_required',403);}
  const api=path.startsWith('/api/v1/');let apiPrincipal=null;
  if(api||request.headers.has('Authorization')&&path.startsWith('/api/')){apiPrincipal=await principal(request,env,true);context.rate=await limit(env,'api:'+apiPrincipal.key_id,120,60);if(api){const utility=await apiUtilities(request,env,apiPrincipal,context);if(utility)return utility;}}
  const authenticated=(r,e,apiOnly=false)=>r===request&&apiOnly&&apiPrincipal?Promise.resolve(apiPrincipal):principal(r,e,apiOnly);
  const feature=await garageRoutes(request,env,{principal:authenticated,limit,hmac})??await aviationRoutes(request,env,{principal:authenticated,limit});if(feature)return feature;

  const security=await securityRoutes(request,env,{principal,limit});if(security)return security;

  if(request.method==='GET'&&(path==='/'||path==='/home/'))return Response.redirect(new URL('/home',request.url),301);
  if(request.method==='GET'&&path==='/radar')return Response.redirect(new URL('/dashboard#locationMap',request.url),302);
  if(request.method==='GET'&&path==='/favicon.ico')return Response.redirect(new URL('/favicon.svg',request.url),302);
  const pages={'/home':'home','/login':'login','/register':'register','/dashboard':'dashboard','/settings/user':'settings','/radar':'radar','/blog':'blog','/docs':'docs','/admin':'admin','/aircraft':'aircraft'};
  if(request.method==='GET'&&pages[path]){
    const protectedPage=['/dashboard','/settings/user','/radar','/admin','/aircraft'].includes(path);
    if(protectedPage){
      try{const p=await principal(request,env);if(!p.session_hash)fail('login_required',401);}catch(e){if(e.status===401)return Response.redirect(new URL('/login?next='+encodeURIComponent(path),request.url),302);throw e;}
    }
    const assetURL=new URL('/pages/'+pages[path]+'.html',request.url);
    const response=await env.ASSETS.fetch(new Request(assetURL,request));
    if(!protectedPage)return response;
    const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');
    return new Response(response.body,{status:response.status,headers});
  }
  if(request.method==='GET'&&path==='/healthz'){
    await query(env,'SELECT 1').first();return json({status:'ok'});
  }
  if(request.method==='GET'&&path==='/api/config')return json({payments_enabled:false,registration_enabled:env.REGISTRATION_ENABLED==='true',models:env.OPENAI_API_KEY?['openai','llama_local']:['llama_local'],model_names:{openai:'OpenAI ('+(env.OPENAI_SCAN_MODEL??'gpt-5.5')+')',llama_local:'Local Llama (llama.cpp)'},languages:['en'],home_model:env.HOME_PROVIDER==='grok'?{provider:'grok',model:env.GROK_HOME_MODEL??'grok-4-1-fast-non-reasoning',configured:!!env.GROK_API_KEY}:{provider:'openai',model:env.OPENAI_HOME_MODEL??'gpt-5.5',configured:!!env.OPENAI_API_KEY}});
  if(request.method==='GET'&&path==='/api/home/csrf')return publicHomeCSRF(request,env);
  if(request.method==='POST'&&path==='/api/home/preview')return publicHomePreview(request,env);
  if(request.method==='POST'&&path==='/api/home/assessment')return homeAssessment(request,env);
  if(request.method==='POST'&&['/auth/login','/auth/register'].includes(path)){
    browserOrigin(request);
    await limit(env,'auth:'+await hmac(env.QRS_API_KEY_PEPPER,request.headers.get('CF-Connecting-IP')??'local'),15,300);
    const data=await readJSON(request,4096);
    if(!data||typeof data.email!=='string'||typeof data.password!=='string')fail('invalid_credentials',400);
    const email=data.email.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)fail('invalid_email',400);
    // Bound distributed password guessing without storing email addresses in rate keys.
    if(path==='/auth/login')await limit(env,'auth-account:'+await hmac(env.QRS_API_KEY_PEPPER,email),30,300);
    if(path==='/auth/register'){
      if(env.REGISTRATION_ENABLED!=='true')fail('registration_disabled',403);
      const salt=randomToken().slice(0,32);let hash;
      try{hash=await passwordHash(data.password,salt);}catch(e){fail(e.message,400);}
      const id=crypto.randomUUID();
      try{await env.DB.batch([
        query(env,'INSERT INTO users(id,email,created_at) VALUES (?,?,?)',id,email,now()),
        query(env,'INSERT INTO user_credentials(user_id,password_hash,password_salt) VALUES (?,?,?)',id,hash,salt),
        query(env,'INSERT INTO accounts(user_id,credits,updated_at) VALUES (?,0,?)',id,now()),
      ]);}catch(e){if(String(e).includes('UNIQUE'))fail('account_could_not_be_created',409);throw e;}
      return json({created:true},201);
    }
    const user=await query(env,'SELECT u.id,c.password_hash,c.password_salt FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE u.email=?',email).first();
    let calculated;try{calculated=await passwordHash(data.password,user?.password_salt??'00'.repeat(16));}catch{fail('invalid_credentials',401);}
    if(!user?.password_hash||!await sameSecret(calculated,user.password_hash))fail('invalid_credentials',401);
    const token=randomToken();await query(env,'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)',await sha256(token),user.id,now()+86400,now()).run();
    return json({authenticated:true},200,{'Set-Cookie':`__Host-qrs_session=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`});
  }
  if(path.startsWith('/billing/'))fail('payments_disabled',503);
  if(path==='/api/v1/account'&&request.method==='GET'){requireScope(apiPrincipal,'account:read');return json(await account(env,apiPrincipal.user_id));}
  if(path==='/api/v1/scans'&&request.method==='POST'){requireScope(apiPrincipal,'scans:write');return runScan(request,env,apiPrincipal);}
  if(path==='/api/session/scans'&&request.method==='POST'){
    browserOrigin(request);const p=await principal(request,env);
    if(!p.session_hash)fail('login_required',401);
    const keyID='web:'+p.user_id;
    await query(env,'INSERT OR IGNORE INTO api_keys(id,user_id,key_hash,created_at) VALUES (?,?,?,?)',keyID,p.user_id,await hmac(env.QRS_API_KEY_PEPPER,'web-session-v1:'+p.user_id),now()).run();
    return runScan(request,env,{...p,key_id:keyID});
  }
  if(request.method==='POST'&&['/api/route/geocode','/api/route/analyze','/api/route/atlas','/api/v1/route/geocode','/api/v1/route/analyze','/api/v1/route/atlas'].includes(path)){
    const p=api?apiPrincipal:await principal(request,env);if(api)requireScope(p,'routes:write');else{if(!p.session_hash)fail('login_required',401);await verifyBrowserCSRF(request,env);}
    if(path.endsWith('/route/atlas')){
      await limit(env,'route-atlas:'+p.user_id,6,3600);await limit(env,'route-atlas-global',30,3600);
      const data=await readJSON(request,1024);if(!data||Object.keys(data).sort().join(',')!=='destination,mode,start'||!['driving','walking'].includes(data.mode))fail('invalid_route_request',400);
      const batch=await captureRouteImagery({start:coordinate(data.start),destination:coordinate(data.destination),mode:data.mode});
      return json({imagery_manifest:batch.frames.map(({image,...meta})=>meta),imagery_warnings:batch.warnings});
    }
    if(path.endsWith('/route/geocode')){await limit(env,'route-search:'+p.user_id,15,60);return geocode(request,env,p);}
    return runVisualRoute(request,env,p);
  }
  if(path==='/api/route/models'&&request.method==='GET'){
    const p=await principal(request,env);if(!p.session_hash)fail('login_required',401);
    await limit(env,'route-models:'+p.user_id,4,3600);
    if(!env.OPENAI_API_KEY)fail('route_model_not_configured',503);
    const r=await fetch('https://api.openai.com/v1/models',{redirect:'manual',headers:{Authorization:'Bearer '+env.OPENAI_API_KEY},signal:AbortSignal.timeout(15000)});
    if(!r.ok)fail('route_model_catalog_unavailable',503);
    const data=await r.json(),ids=(data.data??[]).map(m=>m.id).filter(id=>typeof id==='string');
    return json({requested:env.ROUTE_MODEL??'gpt-6-luna',available:ids.includes(env.ROUTE_MODEL??'gpt-6-luna'),models:ids.filter(id=>/^gpt-/.test(id)).sort()});
  }
  if(path==='/api/session'&&request.method==='GET'){
    const p=await principal(request,env);if(!p.session_hash)fail('login_required',401);return json({email:p.email,is_admin:await isAdmin(env,p.user_id),...await account(env,p.user_id)});
  }
  if(path==='/auth/logout'&&request.method==='POST'){
    browserOrigin(request);const p=await principal(request,env);if(!p.session_hash)fail('login_required',401);
    await query(env,'DELETE FROM sessions WHERE token_hash=?',p.session_hash??'').run();
    return json({logged_out:true},200,{'Set-Cookie':'__Host-qrs_session=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
  }
  if(path==='/auth/password'&&request.method==='POST'){
    browserOrigin(request);const p=await principal(request,env);
    if(!p.session_hash)fail('login_required',401);
    await limit(env,'password:'+p.user_id,5,300);
    const data=await readJSON(request,4096);
    const credentials=await query(env,'SELECT password_hash,password_salt FROM user_credentials WHERE user_id=?',p.user_id).first();
    let previous,next;const salt=randomToken().slice(0,32);
    try{previous=await passwordHash(data.current_password,credentials.password_salt);next=await passwordHash(data.new_password,salt);}catch(e){fail(e.message,400);}
    if(!await sameSecret(previous,credentials.password_hash))fail('invalid_credentials',401);
    await env.DB.batch([
      query(env,'UPDATE user_credentials SET password_hash=?,password_salt=? WHERE user_id=?',next,salt,p.user_id),
      query(env,'DELETE FROM sessions WHERE user_id=?',p.user_id),
    ]);
    return json({password_changed:true},200,{'Set-Cookie':'__Host-qrs_session=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
  }
  if(path==='/api/reports'&&request.method==='GET'){
    const p=await principal(request,env);requireScope(p,'scans:read');const rows=await query(env,"SELECT rowid AS report_id,created_at FROM api_requests WHERE user_id=? AND status='completed' AND operation_kind!='image' AND created_at>=? ORDER BY created_at DESC LIMIT 100",p.user_id,now()-90*86400).all();return json(rows.results);
  }
  if(/^\/api\/(?:v1\/)?reports\/\d+$/.test(path)&&request.method==='GET'){
    const p=api?apiPrincipal:await principal(request,env);requireScope(p,'scans:read');if(!Number.isSafeInteger(Number(path.split('/').pop()))||Number(path.split('/').pop())<1)fail('invalid_report_id',400);const row=await query(env,"SELECT id,created_at FROM api_requests WHERE rowid=? AND user_id=? AND status='completed' AND operation_kind!='image'",Number(path.split('/').pop()),p.user_id).first();
    if(!row)fail('report_not_found',404);if(row.created_at<now()-90*86400)fail('report_expired',410);
    const obj=await env.REPORTS.get(reportPath(p.user_id,row.id));if(!obj)fail('report_unavailable',503);
    return json(await decryptReport(env.QRS_REPORT_KEY,p.user_id,row.id,await obj.text()));
  }
  if(request.method==='GET'&&(['/vendor/webauthn.mjs','/vendor/webauthn.LICENSE.txt','/asset-integrity.json','/favicon.svg','/leaflet.js','/leaflet.css','/leaflet.LICENSE.txt','/openapi.yaml','/site.webmanifest'].includes(path)||path.startsWith('/images/')||path.startsWith('/static/')||/^\/pages\/[a-z0-9-]+\.(mjs|css)$/.test(path))){
    return env.ASSETS.fetch(request);
  }
  fail('not_found',404);
}
export default {
  async fetch(request,env){
    const canonicalURL=new URL(request.url);
    if(canonicalURL.protocol==='http:'){canonicalURL.protocol='https:';return Response.redirect(canonicalURL.toString(),308);}
    let response;const context={request_id:crypto.randomUUID(),rate:null};
    try{response=await routes(request,env,context);}catch(e){
      const status=Number.isInteger(e.status)&&e.status>=400&&e.status<=599?e.status:(e.message?.includes('JSON')?400:500);
      if(status===500)console.error('request_failed',e.message);
      const code=status===500?'internal_error':e.message;context.rate=e.rate??context.rate;
      const errorHeaders=status===429?{'Retry-After':String(e.retry_after??300)}:{};
      if(canonicalURL.pathname.startsWith('/api/v1/')){if(status===401)errorHeaders['WWW-Authenticate']='Bearer realm="QRoadScan", error="invalid_token"';if(e.required_scope)errorHeaders['WWW-Authenticate']='Bearer error="insufficient_scope", scope="'+e.required_scope+'"';response=json({type:'about:blank',title:code.replaceAll('_',' '),status,code,error:code,detail:code,request_id:context.request_id,...(e.required_scope?{required_scope:e.required_scope}:{})},status,{...errorHeaders,'Content-Type':'application/problem+json'});}else response=json({error:code},status,errorHeaders);
    }
    const headers=new Headers(response.headers);headers.set('X-Request-ID',context.request_id);if(context.rate){headers.set('RateLimit-Limit',String(context.rate.limit));headers.set('RateLimit-Remaining',String(context.rate.remaining));headers.set('RateLimit-Reset',String(context.rate.reset));}
    headers.set('Strict-Transport-Security','max-age=31536000');
    headers.set('Permissions-Policy','geolocation=(self), camera=(), microphone=()');
    headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');
    headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://tilecache.rainviewer.com https://server.arcgisonline.com; connect-src 'self' https://api.rainviewer.com; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return new Response(response.body,{status:response.status,headers});
  },
  async scheduled(_controller,env){
    await env.DB.batch([
      query(env,"UPDATE api_requests SET status='refunded',updated_at=? WHERE status='reserved' AND lease_expires_at<?",now(),now()),
      query(env,'DELETE FROM sessions WHERE expires_at<?',now()),
      query(env,'DELETE FROM security_challenges WHERE expires_at<?',now()),
      query(env,'DELETE FROM security_audit WHERE created_at<?',now()-180*86400),
      query(env,'DELETE FROM rate_limits WHERE expires_at<?',now()),
      query(env,'DELETE FROM public_home_previews WHERE expires_at<? AND lease_expires_at<?',now()-3600,now()),
      query(env,'DELETE FROM geocode_cache WHERE expires_at<?',now()),
    ]);
    await cleanupGarage(env);
  },
};
