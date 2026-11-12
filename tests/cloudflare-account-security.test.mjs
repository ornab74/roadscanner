import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/worker.mjs';
import {issuePasskeySession} from '../cloudflare/account-security.mjs';
import {fixture} from './fixtures/account-worker.mjs';
const origin='https://example.test';
test('passkey session issuance rechecks revocation, ownership, public key and counter at its write boundary',async()=>{
 const f=await fixture();try{
  const key={id:'test-passkey',user_id:'owner',public_key:'test-public-key'};
  await f.DB.prepare('INSERT INTO security_keys VALUES (?,?,?,?,?,?,?,?,?)').bind(key.id,'owner','Test key',key.public_key,0,'[]',0,1,null).run();
  await issuePasskeySession(f.env,key,0,'valid-passkey-token');
  for(const invalid of [{...key,user_id:'other'},{...key,public_key:'replaced-key'}])await assert.rejects(issuePasskeySession(f.env,invalid,0,'invalid-token'));
  await assert.rejects(issuePasskeySession(f.env,key,1,'stale-counter-token'));
  await f.DB.prepare('DELETE FROM security_keys WHERE id=?').bind(key.id).run();
  await assert.rejects(issuePasskeySession(f.env,key,0,'revoked-key-token'));
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n,1);
 }finally{f.close();}
});
test('a concurrent credential replacement prevents session issuance, elevation and stale password overwrites',async()=>{
 for(const mode of ['login','reauth','change']){
  const f=await fixture();try{
   const c=await client(f);const originalPrepare=f.DB.prepare.bind(f.DB),originalBatch=f.DB.batch.bind(f.DB);let injected=false;
   const replace=async()=>{injected=true;await originalPrepare("UPDATE user_credentials SET password_hash=?,password_salt=? WHERE user_id='owner'").bind('ab'.repeat(32),'22'.repeat(16)).run();};
   f.DB.prepare=sql=>{
    const s=originalPrepare(sql),originalRun=s.run;
    if((mode==='login'&&sql.startsWith('INSERT INTO sessions('))||(mode==='reauth'&&sql.startsWith('UPDATE sessions SET elevated_until='))){s.run=async function(){if(!injected)await replace();return originalRun.call(this);};}
    return s;
   };
   f.DB.batch=async statements=>{if(mode==='change'&&!injected&&statements.some(s=>s.sql.startsWith('UPDATE user_credentials SET password_hash=')))await replace();return originalBatch(statements);};
   const path=mode==='login'?'/auth/login':mode==='reauth'?'/api/security/reauth':'/auth/password';
   const body=mode==='login'?{email:'owner@example.test',password:'test-password-1234'}:mode==='reauth'?{password:'test-password-1234'}:{current_password:'test-password-1234',new_password:'replacement-password-1234'};
   const r=await c.request(path,'POST',body);assert.equal(injected,true);assert.equal(r.status,401);assert.equal(r.headers.get('Set-Cookie'),null);
   assert.equal((await originalPrepare("SELECT password_hash FROM user_credentials WHERE user_id='owner'").first()).password_hash,'ab'.repeat(32));
   assert.equal((await originalPrepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='owner' AND elevated_until>0").first()).n,0);
  }finally{f.close();}
 }
});
test('legacy login upgrades only a verified password and remains usable for reauthentication and password changes',async()=>{
 const f=await fixture();try{
  const before=await f.DB.prepare("SELECT password_hash FROM user_credentials WHERE user_id='owner'").first();assert.match(before.password_hash,/^[a-f0-9]{64}$/);
  const token=await f.request('/api/home/csrf'),csrf=await token.json();
  const rejected=await f.request('/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf.csrf_token,Cookie:token.headers.get('Set-Cookie').split(';')[0]},body:JSON.stringify({email:'owner@example.test',password:'incorrect-password-1234'})});assert.equal(rejected.status,401);
  assert.equal((await f.DB.prepare("SELECT password_hash FROM user_credentials WHERE user_id='owner'").first()).password_hash,before.password_hash);
  const c=await client(f);const after=await f.DB.prepare("SELECT password_hash FROM user_credentials WHERE user_id='owner'").first();assert.match(after.password_hash,/^qrs-pbkdf2-sha256-hmac-v1\$/);
  await c.elevate();await client(f);
  assert.equal((await c.request('/auth/password','POST',{current_password:'test-password-1234',new_password:'replacement-password-1234'})).status,200);
  assert.equal((await c.request('/api/session')).status,401);
  assert.equal((await c.request('/auth/login','POST',{email:'owner@example.test',password:'replacement-password-1234'})).status,200);
 }finally{f.close();}
});
test('distributed login attempts share a normalized account limit while other accounts remain usable',async()=>{
 const f=await fixture();try{
  const token=await f.request('/api/home/csrf'),csrf=await token.json();
  const headers={Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf.csrf_token,Cookie:token.headers.get('Set-Cookie').split(';')[0]};
  for(let i=0;i<31;i++){
   const r=await f.request('/auth/login',{method:'POST',headers:{...headers,'CF-Connecting-IP':'192.0.2.'+(i+1)},body:JSON.stringify({email:i%2?' OWNER@example.test ':'owner@example.test',password:'wrong-password-1234'})});
   assert.equal(r.status,i<30?401:429);
  }
  const r=await f.request('/auth/login',{method:'POST',headers:{...headers,'CF-Connecting-IP':'192.0.2.100'},body:JSON.stringify({email:'other@example.test',password:'test-password-1234'})});assert.equal(r.status,200);
  const rows=(await f.DB.prepare("SELECT key FROM rate_limits WHERE key LIKE 'auth-account:%'").all()).results;
  assert.ok(rows.length>0);assert.ok(rows.every(r=>!r.key.includes('@')));
 }finally{f.close();}
});
async function client(f,email='owner@example.test'){
 const token=await f.request('/api/home/csrf'),csrf=await token.json();let cookie=token.headers.get('Set-Cookie').split(';')[0];
 const headers={Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf.csrf_token,Cookie:cookie};
 const login=await f.request('/auth/login',{method:'POST',headers,body:JSON.stringify({email,password:'test-password-1234'})});assert.equal(login.status,200);headers.Cookie+='; '+login.headers.get('Set-Cookie').split(';')[0];
 const request=(path,method='GET',body,custom={})=>worker.fetch(new Request(origin+path,{method,headers:{...headers,...custom},...(body!==undefined?{body:JSON.stringify(body)}:{})}),f.env);
 const elevate=async()=>assert.equal((await request('/api/security/reauth','POST',{password:'test-password-1234'})).status,200);
 return {headers,request,elevate};
}
test('every browser mutation rejects missing, forged, foreign and cross-site CSRF before state changes',async()=>{
 const f=await fixture();try{const c=await client(f);for(const path of ['/auth/login','/auth/register','/auth/logout','/auth/password','/auth/passkey/options','/auth/passkey/verify','/api/keys','/api/security/reauth','/api/security/keys/options','/api/security/keys/verify','/api/security/sessions/revoke-others','/api/admin/actions','/api/route/analyze','/api/route/geocode','/api/route/atlas','/api/session/scans','/api/home/assessment','/api/home/preview']){
  for(const bad of [{'X-CSRF-Token':''},{'X-CSRF-Token':'forged'},{Origin:'https://evil.test'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await c.request(path,'POST',{},bad)).status,403,path);
 }assert.equal((await c.request('/api/keys/key','DELETE',undefined,{'X-CSRF-Token':''})).status,403);
 assert.equal((await c.request('/api/session')).status,200);
 }finally{f.close();}
});
test('admin boundaries require an operator role, browser session, CSRF and recent verification',async()=>{
 const f=await fixture();try{const c=await client(f);assert.equal((await c.request('/api/admin/overview')).status,403);assert.equal((await c.request('/admin')).status,403);await c.elevate();assert.equal((await c.request('/api/admin/users')).status,403);await f.DB.prepare("INSERT INTO user_roles VALUES ('owner','admin',1)").run();
 assert.equal((await c.request('/api/admin/overview')).status,200);assert.equal((await c.request('/api/admin/users')).status,200);
 const bearer=await f.request('/api/admin/overview',{headers:{Authorization:'Bearer '+f.key}});assert.equal(bearer.status,401);
 await f.DB.prepare('UPDATE sessions SET elevated_until=0').run();assert.equal((await c.request('/api/admin/users')).status,403);
 const other=await client(f,'other@example.test');assert.equal((await other.request('/api/admin/actions','POST',{action:'grant_credits',user_id:'other',amount:100,reason:'Unauthorized attempt',reference:'not-authorized-12345'})).status,403);
 }finally{f.close();}
});
test('API keys are named, expiring, one-time, owner-scoped and unusable after expiry/revocation',async()=>{
 const f=await fixture();try{const c=await client(f),other=await client(f,'other@example.test');assert.equal((await c.request('/api/keys','POST',{})).status,403);await c.elevate();assert.equal((await c.request('/api/keys','POST',{expires_in_days:366})).status,400);const made=await c.request('/api/keys','POST',{name:'My integration',expires_in_days:30});assert.equal(made.status,201);const key=await made.json(),list=await (await c.request('/api/keys')).json();assert.equal(list[0].name,'My integration');assert.ok(!JSON.stringify(list).includes(key.key));
 await other.elevate();assert.equal((await other.request('/api/keys/'+key.id,'DELETE')).status,404);
 let use=await f.request('/api/v1/account',{headers:{Authorization:'Bearer '+key.key}});assert.equal(use.status,200);
 await f.DB.prepare('UPDATE api_keys SET expires_at=1 WHERE id=?').bind(key.id).run();assert.equal((await f.request('/api/v1/account',{headers:{Authorization:'Bearer '+key.key}})).status,401);
 await f.DB.prepare('UPDATE api_keys SET expires_at=NULL WHERE id=?').bind(key.id).run();assert.equal((await c.request('/api/keys/'+key.id,'DELETE')).status,200);assert.equal((await f.request('/api/v1/account',{headers:{Authorization:'Bearer '+key.key}})).status,401);
 }finally{f.close();}
});
test('admin grants are atomic and idempotent, require reason, and audit alongside session/key revocation',async()=>{
 const f=await fixture();try{const c=await client(f);await f.DB.prepare("INSERT INTO user_roles VALUES ('owner','admin',1)").run();await c.elevate();const payload={action:'grant_credits',user_id:'other',amount:5,reason:'Test support correction',reference:'support-reference-12345'};
 assert.equal((await c.request('/api/admin/actions','POST',{...payload,amount:101})).status,400);assert.equal((await c.request('/api/admin/actions','POST',payload)).status,200);assert.equal((await c.request('/api/admin/actions','POST',payload)).status,200);assert.equal((await f.DB.prepare("SELECT credits FROM accounts WHERE user_id='other'").first()).credits,7);assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM security_audit WHERE action='admin.grant_credits'").first()).n,1);
 assert.equal((await c.request('/api/admin/actions','POST',{...payload,amount:6})).status,409);
 const other=await client(f,'other@example.test');assert.equal((await c.request('/api/admin/actions','POST',{...payload,action:'revoke_sessions'})).status,200);assert.equal((await other.request('/api/session')).status,401);
 }finally{f.close();}
});
test('passkey challenges bind to the browser, expire, and cannot replay or enroll without reauthentication',async()=>{
 const f=await fixture();try{const c=await client(f),other=await client(f,'other@example.test');assert.equal((await c.request('/api/security/keys/options','POST',{name:'Test key'})).status,403);await c.elevate();let r=await c.request('/api/security/keys/options','POST',{name:'Test key'});assert.equal(r.status,200);const options=await r.json();assert.equal(options.options.authenticatorSelection.userVerification,'required');assert.equal(options.options.authenticatorSelection.residentKey,'required');assert.equal(options.options.rp.id,'example.test');await other.elevate();assert.equal((await other.request('/api/security/keys/verify','POST',{challenge_id:options.challenge_id,response:{}})).status,400);
 assert.equal((await c.request('/api/security/keys/verify','POST',{challenge_id:options.challenge_id,response:{}})).status,400);assert.equal((await c.request('/api/security/keys/verify','POST',{challenge_id:options.challenge_id,response:{}})).status,400);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM security_challenges WHERE id=?').bind(options.challenge_id).first()).n,0);
 r=await c.request('/auth/passkey/options','POST',{});const login=await r.json();await f.DB.prepare('UPDATE security_challenges SET expires_at=1 WHERE id=?').bind(login.challenge_id).run();assert.equal((await c.request('/auth/passkey/verify','POST',{challenge_id:login.challenge_id,response:{id:'fake'}})).status,400);
 }finally{f.close();}
});
test('token refresh preserves a valid browser cookie so parallel tabs remain usable',async()=>{const f=await fixture();try{const c=await client(f);const before=await c.request('/api/home/csrf');assert.equal(before.headers.get('Set-Cookie'),null);assert.equal((await before.json()).csrf_token,c.headers['X-CSRF-Token']);}finally{f.close();}});
