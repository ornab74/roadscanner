import {cookieValue,sha256,hmac,sameSecret,randomToken} from './security.mjs';
const q=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const fail=(message,status=401)=>{throw Object.assign(new Error(message),{status});};
const now=()=>Math.floor(Date.now()/1000);
export const pendingCookie='__Host-qrs_login_pending';
export const clearPendingCookie=pendingCookie+'=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
export const factorPolicySQL=(session='s')=>`(NOT EXISTS(SELECT 1 FROM security_keys fk WHERE fk.user_id=${session}.user_id) OR (${session}.mfa_verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM security_keys fk WHERE fk.user_id=${session}.user_id AND fk.id=${session}.mfa_key_id)))`;
export async function hasSecurityKeys(env,user){return !!await q(env,'SELECT id FROM security_keys WHERE user_id=? LIMIT 1',user).first();}
const fingerprint=(env,c)=>hmac(env.QRS_PASSWORD_PEPPER,'password-factor-v1\0'+c.password_hash+'\0'+c.password_salt);
const binding=request=>sha256(cookieValue(request,'__Host-qrs_preview')??'');
export async function beginPasswordFactor(request,env,user,credentials,sessionHash=null){
 const raw=randomToken(),hash=await sha256(raw),browser=await binding(request),stamp=await fingerprint(env,credentials);
 const priorSession=sessionHash?`AND EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>unixepoch() AND ${factorPolicySQL()})`:'';
 // Only hashes of the random capability and credential snapshot are persisted.
 // Replacing a browser's pending proof cannot affect another browser's proof.
 const result=await q(env,`INSERT INTO password_login_intents(token_hash,user_id,browser_binding,credential_fingerprint,session_hash,created_at,expires_at)
 SELECT ?,?,?,?,?,unixepoch(),unixepoch()+300 WHERE EXISTS(SELECT 1 FROM user_credentials WHERE user_id=? AND password_hash=? AND password_salt=?) AND EXISTS(SELECT 1 FROM security_keys WHERE user_id=?) ${priorSession}
 ON CONFLICT(browser_binding) DO UPDATE SET token_hash=excluded.token_hash,user_id=excluded.user_id,credential_fingerprint=excluded.credential_fingerprint,session_hash=excluded.session_hash,created_at=excluded.created_at,expires_at=excluded.expires_at`,hash,user,browser,stamp,sessionHash,user,credentials.password_hash,credentials.password_salt,user,...(sessionHash?[sessionHash,user]:[])).run();
 if(result.meta.changes<1)fail('invalid_credentials');
 return Response.json({authenticated:false,mfa_required:true,expires_in:300},{headers:{'Cache-Control':'no-store','Set-Cookie':`${pendingCookie}=${raw}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=300`}});
}
export async function passwordFactor(request,env){
 const raw=cookieValue(request,pendingCookie);
 if(!/^[a-f0-9]{64}$/.test(raw??''))fail('password_factor_required');
 const hash=await sha256(raw),browser=await binding(request);
 const row=await q(env,`SELECT i.*,c.password_hash,c.password_salt FROM password_login_intents i JOIN user_credentials c ON c.user_id=i.user_id WHERE i.token_hash=? AND i.browser_binding=? AND i.expires_at>unixepoch() AND EXISTS(SELECT 1 FROM security_keys WHERE user_id=i.user_id) AND (i.session_hash IS NULL OR EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=i.session_hash AND s.user_id=i.user_id AND s.expires_at>unixepoch() AND ${factorPolicySQL()}))`,hash,browser).first();
 if(!row||!await sameSecret(row.credential_fingerprint,await fingerprint(env,row)))fail('password_factor_required');
 return row;
}
export async function cancelPasswordFactor(request,env){
 const raw=cookieValue(request,pendingCookie);if(/^[a-f0-9]{64}$/.test(raw??''))await q(env,'DELETE FROM password_login_intents WHERE token_hash=? AND browser_binding=?',await sha256(raw),await binding(request)).run();
 return Response.json({cancelled:true},{headers:{'Cache-Control':'no-store','Set-Cookie':clearPendingCookie}});
}
export async function issuePasskeySession(env,key,newCounter,token,intent){
 if(!intent||!Number.isSafeInteger(newCounter)||newCounter<key.counter)fail('credential_verification_failed',400);
 const tokenHash=await sha256(token),time=now();
 // Insertion, intent consumption (trigger), counter update, old-session removal
 // and auditing share one D1 transaction. No valid password proof means no login.
 const result=await env.DB.batch([
  q(env,`INSERT INTO sessions(token_hash,user_id,expires_at,created_at,elevated_until,mfa_key_id,mfa_verified_at,login_intent_hash)
 SELECT ?,?,unixepoch()+86400,unixepoch(),unixepoch()+300,?,unixepoch(),i.token_hash FROM password_login_intents i
 WHERE i.token_hash=? AND i.user_id=? AND i.browser_binding=? AND i.credential_fingerprint=? AND i.expires_at>unixepoch()
 AND EXISTS(SELECT 1 FROM user_credentials WHERE user_id=i.user_id AND password_hash=? AND password_salt=?)
 AND EXISTS(SELECT 1 FROM security_keys WHERE id=? AND user_id=i.user_id AND public_key=? AND counter=?)
 AND (i.session_hash IS NULL OR EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=i.session_hash AND s.user_id=i.user_id AND s.expires_at>unixepoch() AND ${factorPolicySQL()})) RETURNING token_hash`,tokenHash,key.user_id,key.id,intent.token_hash,key.user_id,intent.browser_binding,intent.credential_fingerprint,intent.password_hash,intent.password_salt,key.id,key.public_key,key.counter),
  q(env,'UPDATE security_keys SET counter=?,last_used_at=? WHERE id=? AND user_id=? AND public_key=? AND counter=? AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND login_intent_hash=?)',newCounter,time,key.id,key.user_id,key.public_key,key.counter,tokenHash,intent.token_hash),
  q(env,'DELETE FROM sessions WHERE token_hash=? AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND login_intent_hash=?)',intent.session_hash??'',tokenHash,intent.token_hash),
  q(env,"INSERT INTO security_audit SELECT ?,?,'session.two_factor_verified',?,'{}',? WHERE EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND login_intent_hash=?)",crypto.randomUUID(),key.user_id,key.id,time,tokenHash,intent.token_hash),
 ]);
 if(result[0].results.length!==1)fail('credential_verification_failed',400);
}
