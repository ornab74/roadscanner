import {validateScopes} from './api-contract.mjs';
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import {hmac,sha256,passwordHash,verifyPassword,sameSecret,randomToken,readJSON} from './security.mjs';
const now=()=>Math.floor(Date.now()/1000),json=(v,s=200,h={})=>Response.json(v,{status:s,headers:{'Cache-Control':'no-store',...h}});
const fail=(m,s)=>{throw Object.assign(new Error(m),{status:s});};
const q=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const audit=(env,p,action,target,detail={})=>q(env,'INSERT INTO security_audit VALUES (?,?,?,?,?,?)',crypto.randomUUID(),p.user_id,action,target,JSON.stringify(detail),now());
const bytes64=bytes=>btoa(String.fromCharCode(...bytes));
const from64=value=>Uint8Array.from(atob(value),x=>x.charCodeAt(0));
function label(value,fallback){const s=value??fallback;if(typeof s!=='string'||!s.trim()||s.length>60||/[\x00-\x1f\x7f]/.test(s))fail('invalid_name',400);return s.trim();}
export async function isAdmin(env,id){return !!await q(env,"SELECT user_id FROM user_roles WHERE user_id=? AND role='admin'",id).first();}
export async function requireElevated(env,p){if(!p.session_hash)fail('login_required',401);const r=await q(env,'SELECT elevated_until FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',p.session_hash,p.user_id,now()).first();if(!r||r.elevated_until<=now())fail('reauthentication_required',403);}
export async function securityRoutes(request,env,{principal,limit}){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(!path.startsWith('/api/security/')&&!path.startsWith('/api/admin/')&&!path.startsWith('/auth/passkey/')&&path!=='/api/keys'&&!path.startsWith('/api/keys/'))return null;
 const auth=path.startsWith('/auth/passkey/');
 const p=auth?null:await principal(request,env);
 if(!auth&&!p.session_hash)fail('login_required',401);
 const ip=await hmac(env.QRS_API_KEY_PEPPER,request.headers.get('CF-Connecting-IP')??'local');
 if(method!=='GET')await limit(env,'security:'+(p?.user_id??ip),30,300);
 const binding=auth?await sha256(request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-qrs_preview=([^;]+)/)?.[1]??''):p.session_hash;
 const rpID=url.hostname,origin=url.origin;
 async function challenge(purpose){const data=await readJSON(request,32768);if(typeof data.challenge_id!=='string'||!data.response||typeof data.response!=='object')fail('invalid_credential',400);const row=await q(env,'DELETE FROM security_challenges WHERE id=? AND binding=? AND purpose=? AND expires_at>? RETURNING *',data.challenge_id,binding,purpose,now()).first();if(!row||p&&row.user_id!==p.user_id)fail('invalid_challenge',400);return {data,row};}
 async function saveChallenge(options,purpose,name=null){const id=crypto.randomUUID();await q(env,'INSERT INTO security_challenges VALUES (?,?,?,?,?,?,?)',id,p?.user_id??null,binding,purpose,options.challenge,name,now()+120).run();return json({challenge_id:id,options});}
 if(path==='/api/security/reauth'&&method==='POST'){
  await limit(env,'reauth:'+p.user_id,5,300);const data=await readJSON(request,2048),c=await q(env,'SELECT password_hash,password_salt FROM user_credentials WHERE user_id=?',p.user_id).first();let hash;
  if(!env.QRS_PASSWORD_PEPPER)fail('password_service_unavailable',503);
  try{hash=await verifyPassword(data.password,c.password_salt,c.password_hash,env.QRS_PASSWORD_PEPPER);}catch{fail('invalid_credentials',401);}
  if(!hash)fail('invalid_credentials',401);
  const elevated=await q(env,'UPDATE sessions SET elevated_until=? WHERE token_hash=? AND user_id=? AND expires_at>? AND EXISTS (SELECT 1 FROM user_credentials WHERE user_id=? AND password_hash=? AND password_salt=?)',now()+300,p.session_hash,p.user_id,now(),p.user_id,c.password_hash,c.password_salt).run();if(elevated.meta.changes!==1)fail('invalid_credentials',401);
  await audit(env,p,'session.reauthenticated',p.user_id).run();return json({elevated_until:now()+300});
 }
 if(path==='/api/security/keys'&&method==='GET')return json((await q(env,'SELECT id,name,created_at,last_used_at,backed_up FROM security_keys WHERE user_id=? ORDER BY created_at DESC',p.user_id).all()).results);
 if(path==='/api/security/keys/options'&&method==='POST'){
  await requireElevated(env,p);const data=await readJSON(request,1024),keys=(await q(env,'SELECT id,transports FROM security_keys WHERE user_id=?',p.user_id).all()).results;if(keys.length>=10)fail('security_key_limit',409);
  const options=await generateRegistrationOptions({rpName:'QRoadScan',rpID,userID:new TextEncoder().encode(p.user_id),userName:p.email,attestationType:'none',excludeCredentials:keys.map(k=>({id:k.id,transports:JSON.parse(k.transports)})),authenticatorSelection:{residentKey:'required',userVerification:'required'},supportedAlgorithmIDs:[-7,-257],timeout:120000});
  return saveChallenge(options,'register',label(data.name,'Security key'));
 }
 if(path==='/api/security/keys/verify'&&method==='POST'){
  await requireElevated(env,p);const {data,row}=await challenge('register');let result;try{result=await verifyRegistrationResponse({response:data.response,expectedChallenge:row.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true});}catch{fail('credential_verification_failed',400);}
  if(!result.verified||!result.registrationInfo)fail('credential_verification_failed',400);const info=result.registrationInfo,k=info.credential;
  await env.DB.batch([q(env,'INSERT INTO security_keys VALUES (?,?,?,?,?,?,?,?,?)',k.id,p.user_id,row.name,bytes64(k.publicKey),k.counter,JSON.stringify(k.transports??[]),info.credentialBackedUp?1:0,now(),null),audit(env,p,'security_key.enrolled',k.id)]);return json({enrolled:true},201);
 }
 if(path.startsWith('/api/security/keys/')&&method==='DELETE'){
  await requireElevated(env,p);const id=decodeURIComponent(path.slice('/api/security/keys/'.length));if(!await q(env,'SELECT id FROM security_keys WHERE id=? AND user_id=?',id,p.user_id).first())fail('key_not_found',404);
  await env.DB.batch([q(env,'DELETE FROM security_keys WHERE id=? AND user_id=?',id,p.user_id),audit(env,p,'security_key.removed',id)]);return json({removed:true});
 }
 if(path==='/auth/passkey/options'&&method==='POST')return saveChallenge(await generateAuthenticationOptions({rpID,userVerification:'required',timeout:120000}),'authenticate');
 if(path==='/auth/passkey/verify'&&method==='POST'){
  const {data,row}=await challenge('authenticate'),key=await q(env,'SELECT * FROM security_keys WHERE id=?',data.response.id??'').first();if(!key)fail('credential_verification_failed',400);
  let result;try{result=await verifyAuthenticationResponse({response:data.response,expectedChallenge:row.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:key.id,publicKey:from64(key.public_key),counter:key.counter,transports:JSON.parse(key.transports)}});}catch{fail('credential_verification_failed',400);}
  if(!result.verified)fail('credential_verification_failed',400);const token=randomToken(),actor={user_id:key.user_id};
  // Compare-and-swap the signature counter before issuing a session. Synced keys may use zero.
  const updated=await q(env,'UPDATE security_keys SET counter=?,last_used_at=? WHERE id=? AND counter=? RETURNING id',result.authenticationInfo.newCounter,now(),key.id,key.counter).first();if(!updated)fail('credential_verification_failed',400);
  await env.DB.batch([q(env,'INSERT INTO sessions(token_hash,user_id,expires_at,created_at,elevated_until) VALUES (?,?,?,?,?)',await sha256(token),key.user_id,now()+86400,now(),now()+300),audit(env,actor,'security_key.sign_in',key.id)]);
  return json({authenticated:true},200,{'Set-Cookie':`__Host-qrs_session=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`});
 }
 if(path==='/api/security/sessions'&&method==='GET')return json((await q(env,'SELECT token_hash,created_at,expires_at FROM sessions WHERE user_id=? AND expires_at>? ORDER BY expires_at DESC',p.user_id,now()).all()).results.map(s=>({id:s.token_hash,current:s.token_hash===p.session_hash,created_at:s.created_at,expires_at:s.expires_at})));
 if(path==='/api/security/sessions/revoke-others'&&method==='POST'){
  await requireElevated(env,p);await env.DB.batch([q(env,'DELETE FROM sessions WHERE user_id=? AND token_hash!=?',p.user_id,p.session_hash),audit(env,p,'session.revoked_others',p.user_id)]);return json({revoked:true});
 }
 if(path==='/api/security/activity'&&method==='GET')return json((await q(env,'SELECT action,created_at FROM security_audit WHERE actor_id=? ORDER BY created_at DESC LIMIT 30',p.user_id).all()).results);
 if(path==='/api/keys'&&method==='GET')return json((await q(env,"SELECT id,name,scopes,created_at,expires_at,last_used_at,revoked_at FROM api_keys WHERE user_id=? AND id NOT LIKE 'web:%' ORDER BY created_at DESC LIMIT 100",p.user_id).all()).results);
 if(path==='/api/keys'&&method==='POST'){
  await requireElevated(env,p);const data=await readJSON(request,2048),name=label(data.name,'API key'),scopes=validateScopes(data.scopes),days=data.expires_in_days??90;if(!Number.isInteger(days)||days<1||days>365)fail('invalid_expiry',400);
  if((await q(env,"SELECT COUNT(*) AS n FROM api_keys WHERE user_id=? AND id NOT LIKE 'web:%' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)",p.user_id,now()).first()).n>=20)fail('api_key_limit',409);
  const token='qrs_live_'+randomToken().slice(0,10)+'_'+randomToken(),id=crypto.randomUUID();await env.DB.batch([q(env,'INSERT INTO api_keys(id,user_id,key_hash,created_at,name,expires_at,scopes) VALUES (?,?,?,?,?,?,?)',id,p.user_id,await hmac(env.QRS_API_KEY_PEPPER,token),now(),name,now()+days*86400,JSON.stringify(scopes)),audit(env,p,'api_key.created',id,{name,days,scopes})]);return json({id,key:token,scopes,expires_at:now()+days*86400},201);
 }
 if(path.startsWith('/api/keys/')&&method==='DELETE'){
  await requireElevated(env,p);const id=path.slice('/api/keys/'.length);if(!await q(env,"SELECT id FROM api_keys WHERE id=? AND user_id=? AND id NOT LIKE 'web:%'",id,p.user_id).first())fail('key_not_found',404);await env.DB.batch([q(env,'UPDATE api_keys SET revoked_at=? WHERE id=? AND user_id=?',now(),id,p.user_id),audit(env,p,'api_key.revoked',id)]);return json({revoked:true});
 }
 if(path.startsWith('/api/admin/')){
  if(!await isAdmin(env,p.user_id))fail('admin_required',403);
  if(path==='/api/admin/overview'&&method==='GET'){
   const metrics={};for(const [name,sql] of Object.entries({users:'SELECT COUNT(*) AS n FROM users',sessions:'SELECT COUNT(*) AS n FROM sessions WHERE expires_at>'+now(),security_keys:'SELECT COUNT(*) AS n FROM security_keys',completed_scans:"SELECT COUNT(*) AS n FROM api_requests WHERE status='completed' AND operation_kind!='image'",generated_images:"SELECT COUNT(*) AS n FROM api_requests WHERE status='completed' AND operation_kind='image'",active_keys:"SELECT COUNT(*) AS n FROM api_keys WHERE revoked_at IS NULL AND id NOT LIKE 'web:%' AND (expires_at IS NULL OR expires_at>"+now()+')'}))metrics[name]=(await q(env,sql).first()).n;
   return json({metrics,providers:{openai:!!env.OPENAI_API_KEY,grok:!!env.GROK_API_KEY,local:!!env.QRS_LLAMA_API_TOKEN},models:{route:env.ROUTE_MODEL,home:env.GROK_HOME_MODEL},payments_enabled:false,security:{csrf:'Signed cookie + request token + same-origin',csp:'Self-hosted scripts; no inline execution',passkeys:'WebAuthn · user verification required',reports:'AES-GCM encrypted'},admin_elevated:(await q(env,'SELECT elevated_until FROM sessions WHERE token_hash=?',p.session_hash).first()).elevated_until>now()});
  }
  await requireElevated(env,p);
  if(path==='/api/admin/users'&&method==='GET'){
   const search=(url.searchParams.get('q')??'').trim();if(search.length>100)fail('invalid_search',400);const offset=Number(url.searchParams.get('offset')??0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)fail('invalid_page',400);
   const rows=(await q(env,"SELECT u.id,u.email,u.created_at,a.plan,a.credits,(SELECT COUNT(*) FROM security_keys s WHERE s.user_id=u.id) AS security_keys,(SELECT COUNT(*) FROM api_keys k WHERE k.user_id=u.id AND k.revoked_at IS NULL AND k.id NOT LIKE 'web:%' AND (k.expires_at IS NULL OR k.expires_at>?)) AS api_keys FROM users u JOIN accounts a ON a.user_id=u.id WHERE instr(lower(u.email),lower(?))>0 ORDER BY u.created_at DESC,u.id LIMIT 25 OFFSET ?",now(),search,offset).all()).results;
   return json({users:rows,offset,next_offset:rows.length===25?offset+25:null});
  }
  if(path==='/api/admin/audit'&&method==='GET')return json((await q(env,'SELECT id,actor_id,action,target_id,detail,created_at FROM security_audit ORDER BY created_at DESC LIMIT 100').all()).results);
  if(path==='/api/admin/actions'&&method==='POST'){
   const d=await readJSON(request,2048);if(!['revoke_sessions','revoke_api_keys','grant_credits'].includes(d.action)||typeof d.user_id!=='string'||typeof d.reason!=='string'||d.reason.trim().length<5||d.reason.length>200)fail('invalid_admin_action',400);
   if(!await q(env,'SELECT id FROM users WHERE id=?',d.user_id).first())fail('user_not_found',404);
   const statements=[],detail={reason:d.reason.trim()};
   if(d.action==='grant_credits'){
    if(!Number.isInteger(d.amount)||d.amount<1||d.amount>100||typeof d.reference!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(d.reference))fail('invalid_credit_grant',400);
    detail.amount=d.amount;detail.reference=d.reference;const id='admin:'+d.reference;
    const existing=await q(env,'SELECT user_id,delta FROM credit_ledger WHERE external_ref=?',id).first();if(existing){if(existing.user_id!==d.user_id||existing.delta!==d.amount)fail('idempotency_conflict',409);return json({applied:true,replayed:true});}
    statements.push(q(env,"INSERT INTO credit_ledger VALUES (?,?,?,'operator_support_grant',?,?)",id,d.user_id,d.amount,id,now()));
   }else if(d.action==='revoke_sessions')statements.push(q(env,'DELETE FROM sessions WHERE user_id=?',d.user_id));
   else statements.push(q(env,"UPDATE api_keys SET revoked_at=? WHERE user_id=? AND id NOT LIKE 'web:%' AND revoked_at IS NULL",now(),d.user_id));
   statements.push(audit(env,p,'admin.'+d.action,d.user_id,detail));await env.DB.batch(statements);return json({applied:true});
  }
 }
 fail('not_found',404);
}
