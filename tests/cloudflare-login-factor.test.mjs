import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/account-worker.mjs';
import {authenticator,enrollFixture,browser} from './fixtures/webauthn-factor.mjs';

test('password and account-owned UV security key are both required; key-only login and pending proofs cannot access account APIs',async()=>{
 const f=await fixture();try{const owner=authenticator(),other=authenticator();await enrollFixture(f,owner);await enrollFixture(f,other,'other');const c=await browser(f);
  assert.equal((await c.request('/auth/passkey/options','POST',{})).status,401);
  assert.equal((await c.request('/auth/passkey/verify','POST',{})).status,401);
  assert.equal((await c.request('/auth/login','POST',{email:'owner@example.test',password:'wrong-password-1234'})).status,401);
  const r=await c.login();assert.deepEqual(await r.json(),{authenticated:false,mfa_required:true,expires_in:300});assert.equal(c.cookies.has('__Host-qrs_session'),false);assert.ok(c.cookies.has('__Host-qrs_login_pending'));
  assert.equal((await c.request('/api/session')).status,401);assert.equal((await c.request('/api/keys')).status,401);
  const challenge=await c.options();assert.equal(challenge.options.userVerification,'required');assert.deepEqual(challenge.options.allowCredentials.map(x=>x.id),[owner.id]);
  assert.equal((await c.verify(other,challenge)).status,400);
  const good=await c.options();const verified=await c.verify(owner,good);assert.equal(verified.status,200);assert.equal((await verified.json()).mfa_verified,true);assert.equal(c.cookies.has('__Host-qrs_login_pending'),false);
  assert.equal((await c.request('/api/session')).status,200);assert.equal((await c.verify(owner,good)).status,401);
  const rows=(await f.DB.prepare("SELECT mfa_key_id,mfa_verified_at FROM sessions WHERE user_id='owner'").all()).results;assert.equal(rows.length,1);assert.equal(rows[0].mfa_key_id,owner.id);assert.ok(rows[0].mfa_verified_at>0);
 }finally{f.close();}
});
test('missing user verification, a bad origin, and a forged signature fail; challenges are single-use',async()=>{
 const f=await fixture();try{const key=authenticator(),wrong=authenticator();await enrollFixture(f,key);const c=await browser(f);await c.login();
  for(const options of [{flags:1},{origin:'https://evil.test'},{signatureKey:wrong.privateKey}]){
   const challenge=await c.options();assert.equal((await c.verify(key,challenge,options)).status,400);if(options.flags===1)assert.equal((await c.verify(key,challenge,options)).status,400);
  }
  assert.equal((await c.request('/api/session')).status,401);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n,0);
 }finally{f.close();}
});
test('password proof is browser-bound, expiring, cancelled on demand, and invalidated by a credential or key change',async()=>{
 for(const change of ['expired','password','key','cancel']){
  const f=await fixture();try{const key=authenticator();await enrollFixture(f,key);const a=await browser(f),b=await browser(f);await a.login();const challenge=await a.options();
   b.cookies.set('__Host-qrs_login_pending',a.cookies.get('__Host-qrs_login_pending'));assert.equal((await b.request('/auth/passkey/options','POST',{})).status,401);
   if(change==='expired')await f.DB.prepare('UPDATE password_login_intents SET expires_at=1').run();
   if(change==='password')await f.DB.prepare("UPDATE user_credentials SET password_hash='changed' WHERE user_id='owner'").run();
   if(change==='key')await f.DB.prepare('DELETE FROM security_keys WHERE id=?').bind(key.id).run();
   if(change==='cancel')assert.equal((await a.request('/auth/passkey/cancel','POST',{})).status,200);
   assert.equal((await a.verify(key,challenge)).status,401);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n,0);
  }finally{f.close();}
 }
});
test('challenge expiry, replacement of pending login, and missing CSRF cannot bypass the second factor',async()=>{
 const f=await fixture();try{const key=authenticator();await enrollFixture(f,key);const c=await browser(f);await c.login();let challenge=await c.options();
  await f.DB.prepare('UPDATE security_challenges SET expires_at=1 WHERE id=?').bind(challenge.challenge_id).run();assert.equal((await c.verify(key,challenge)).status,400);
  challenge=await c.options();await c.login();assert.equal((await c.verify(key,challenge)).status,400);
  assert.equal((await c.request('/auth/passkey/options','POST',{}, {'X-CSRF-Token':''})).status,403);
  assert.equal((await c.request('/auth/passkey/cancel','POST',{}, {'X-CSRF-Token':''})).status,403);
  const good=await c.options();assert.equal((await c.verify(key,good)).status,200);
 }finally{f.close();}
});
test('reauthentication requires both factors, rotates the session, and key removal signs every session out',async()=>{
 const f=await fixture();try{const key=authenticator();await enrollFixture(f,key);const c=await browser(f);await c.login();let challenge=await c.options();assert.equal((await c.verify(key,challenge)).status,200);
  const oldCookie=c.cookies.get('__Host-qrs_session');await f.DB.prepare('UPDATE sessions SET elevated_until=0').run();
  assert.equal((await c.request('/api/keys','POST',{name:'Blocked until both factors',expires_in_days:30})).status,403);
  const r=await c.request('/api/security/reauth','POST',{password:'test-password-1234'});assert.equal((await r.json()).mfa_required,true);
  assert.equal((await f.DB.prepare('SELECT elevated_until FROM sessions').first()).elevated_until,0);
  assert.equal((await c.request('/api/keys','POST',{name:'Still blocked',expires_in_days:30})).status,403);
  challenge=await c.options();assert.equal((await c.verify(key,challenge,{counter:2})).status,200);assert.notEqual(c.cookies.get('__Host-qrs_session'),oldCookie);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n,1);
  assert.equal((await c.request('/api/security/keys/'+key.id,'DELETE')).status,200);assert.equal((await c.request('/api/session')).status,401);
  const login=await c.login();assert.equal((await login.json()).authenticated,true);assert.equal((await c.request('/api/session')).status,200);
 }finally{f.close();}
});
test('key policy changes revoke sessions; a forged password-only session is refused even if elevated',async()=>{
 const f=await fixture();try{const c=await browser(f);await c.login();assert.equal((await c.request('/api/session')).status,200);const key=authenticator();await enrollFixture(f,key);assert.equal((await c.request('/api/session')).status,401);
  const raw='ab'.repeat(32),{sha256}=await import('../cloudflare/security.mjs');await f.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at,elevated_until) VALUES (?,'owner',unixepoch()+1000,unixepoch(),unixepoch()+1000)").bind(await sha256(raw)).run();c.cookies.set('__Host-qrs_session',raw);
  assert.equal((await c.request('/api/session')).status,401);assert.equal((await c.request('/api/security/keys/options','POST',{name:'Not allowed'})).status,401);
 }finally{f.close();}
});
test('credential, counter and session revocation races at the final write cannot issue an MFA session',async()=>{
 for(const mode of ['password','counter','intent']){
  const f=await fixture();try{const key=authenticator();await enrollFixture(f,key);const c=await browser(f);await c.login();const challenge=await c.options();const original=f.DB.batch.bind(f.DB);let injected=false;
   f.DB.batch=async statements=>{if(!injected&&statements.some(s=>s.sql.startsWith('INSERT INTO sessions('))){injected=true;if(mode==='password')await f.DB.prepare("UPDATE user_credentials SET password_hash='replaced' WHERE user_id='owner'").run();if(mode==='counter')await f.DB.prepare('UPDATE security_keys SET counter=99 WHERE id=?').bind(key.id).run();if(mode==='intent')await f.DB.prepare('DELETE FROM password_login_intents').run();}return original(statements);};
   const r=await c.verify(key,challenge);assert.equal(injected,true);assert.equal(r.status,400);assert.equal(c.cookies.has('__Host-qrs_session'),false);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n,0);
  }finally{f.close();}
 }
});
test('a key enrolled between password verification and session insertion cannot mint a password-only session',async()=>{
 const f=await fixture();try{const c=await browser(f),key=authenticator(),original=f.DB.prepare.bind(f.DB);let injected=false;
  f.DB.prepare=sql=>{const statement=original(sql),run=statement.run;if(sql.startsWith('INSERT INTO sessions('))statement.run=async function(){if(!injected){injected=true;await enrollFixture(f,key);}return run.call(this);};return statement;};
  const r=await c.login();assert.equal(injected,true);assert.equal(r.status,200);assert.equal((await r.json()).mfa_required,true);assert.equal(c.cookies.has('__Host-qrs_session'),false);assert.equal((await c.request('/api/session')).status,401);
 }finally{f.close();}
});
test('revoking the source session invalidates pending sensitive-action verification',async()=>{
 const f=await fixture();try{const key=authenticator();await enrollFixture(f,key);const c=await browser(f);await c.login();assert.equal((await c.verify(key,await c.options())).status,200);
  const r=await c.request('/api/security/reauth','POST',{password:'test-password-1234'});assert.equal((await r.json()).mfa_required,true);const challenge=await c.options();
  await f.DB.prepare('DELETE FROM sessions').run();assert.equal((await c.verify(key,challenge,{counter:2})).status,401);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n,0);
 }finally{f.close();}
});
test('password replacement succeeds while invalidating another browser pending proof and all sessions',async()=>{
 const f=await fixture();try{const key=authenticator();await enrollFixture(f,key);const a=await browser(f),b=await browser(f);await a.login();assert.equal((await a.verify(key,await a.options())).status,200);
  await b.login();assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM password_login_intents').first()).n,1);
  const r=await a.request('/auth/password','POST',{current_password:'test-password-1234',new_password:'replacement-password-1234'});assert.equal(r.status,200);assert.equal((await r.json()).password_changed,true);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM password_login_intents').first()).n,0);assert.equal((await a.request('/api/session')).status,401);assert.equal((await b.request('/auth/passkey/options','POST',{})).status,401);
 }finally{f.close();}
});
