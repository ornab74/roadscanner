import {readJSON} from './security.mjs';
const q=(e,s,...p)=>e.DB.prepare(s).bind(...p);
const fail=(code,status)=>{throw Object.assign(new Error(code),{status});};
const json=v=>Response.json(v,{headers:{'Cache-Control':'no-store'}});
export async function onboardingRoutes(request,env,{principal,limit}){
 if(new URL(request.url).pathname!=='/api/onboarding')return null;
 const p=await principal(request,env);if(!p.session_hash)fail('login_required',401);
 if(request.method==='GET'){
  const row=await q(env,'SELECT state,version FROM user_onboarding WHERE user_id=?',p.user_id).first();
  return json({version:1,state:row?.state??'existing_account',show_automatically:row?.state==='pending'});
 }
 if(request.method==='POST'){
  await limit(env,'onboarding:'+p.user_id,15,300);const d=await readJSON(request,512);
  if(!d||Array.isArray(d)||Object.keys(d).sort().join(',')!=='action,version'||d.version!==1||!['complete','skip'].includes(d.action))fail('invalid_onboarding_request',400);
  const state=d.action==='complete'?'completed':'skipped';
  const result=await q(env,`INSERT INTO user_onboarding(user_id,version,state,updated_at) SELECT ?,1,?,unixepoch() WHERE EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>unixepoch()) ON CONFLICT(user_id) DO UPDATE SET state=CASE WHEN user_onboarding.state='completed' THEN 'completed' ELSE excluded.state END,updated_at=excluded.updated_at RETURNING state`,p.user_id,state,p.session_hash,p.user_id).first();
  if(!result)fail('login_required',401);return json({version:1,state:result.state,show_automatically:false});
 }
 fail('not_found',404);
}
