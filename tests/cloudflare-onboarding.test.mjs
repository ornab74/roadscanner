import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/account-worker.mjs';
import {browser} from './fixtures/webauthn-factor.mjs';
import {TERMS_DOCUMENT} from '../cloudflare/legal-version.mjs';
const accept={accept_terms:true,terms_version:TERMS_DOCUMENT.version,terms_sha256:TERMS_DOCUMENT.sha256};
test('new registration creates pending onboarding atomically while existing accounts are not interrupted',async()=>{
 const f=await fixture();try{const c=await browser(f);await c.login();let r=await c.request('/api/onboarding');assert.equal(r.status,200);assert.equal((await r.json()).show_automatically,false);
  const data={email:'new-guide@example.test',password:'registration-password-1234',...accept};r=await c.request('/auth/register','POST',data);assert.equal(r.status,201);
  const row=await f.DB.prepare("SELECT o.* FROM user_onboarding o JOIN users u ON u.id=o.user_id WHERE u.email='new-guide@example.test'").first();assert.equal(row.state,'pending');assert.equal(row.version,1);
  r=await c.request('/auth/register','POST',data);assert.equal(r.status,409);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM user_onboarding').first()).n,1);
  const newly=await browser(f);r=await newly.request('/auth/login','POST',{email:data.email,password:data.password});assert.equal(r.status,200);assert.equal((await(await newly.request('/api/onboarding')).json()).show_automatically,true);
  await newly.request('/api/onboarding','POST',{action:'complete',version:1});assert.equal((await(await newly.request('/api/onboarding')).json()).show_automatically,false);
 }finally{f.close();}
});
test('onboarding state is account-scoped, CSRF-protected, validates input and remains completed after replay/skip',async()=>{
 const f=await fixture();try{const c=await browser(f);await c.login();
  assert.equal((await f.request('/api/onboarding')).status,401);assert.equal((await f.request('/api/onboarding',{headers:{Authorization:'Bearer '+f.key}})).status,401);
  assert.equal((await c.request('/api/onboarding','POST',{action:'complete',version:1},{'X-CSRF-Token':''})).status,403);
  for(const body of [{action:'complete',version:2},{action:'reset',version:1},{action:'complete',version:1,user_id:'other'}])assert.equal((await c.request('/api/onboarding','POST',body)).status,400);
  assert.equal((await c.request('/api/onboarding','POST',{action:'skip',version:1})).status,200);assert.equal((await(await c.request('/api/onboarding')).json()).state,'skipped');
  await c.request('/api/onboarding','POST',{action:'complete',version:1});await c.request('/api/onboarding','POST',{action:'skip',version:1});assert.equal((await(await c.request('/api/onboarding')).json()).state,'completed');
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM user_onboarding WHERE user_id='other'").first()).n,0);
 }finally{f.close();}
});
test('a session revoked at the write boundary cannot update onboarding',async()=>{
 const f=await fixture();try{const c=await browser(f);await c.login();const prepare=f.DB.prepare.bind(f.DB);let revoked=false;f.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT INTO user_onboarding')){const first=statement.first;statement.first=async function(){revoked=true;await prepare("DELETE FROM sessions WHERE user_id='owner'").run();return first.call(this);};}return statement;};
  assert.equal((await c.request('/api/onboarding','POST',{action:'complete',version:1})).status,401);assert.ok(revoked);assert.equal((await prepare('SELECT COUNT(*) AS n FROM user_onboarding').first()).n,0);
 }finally{f.close();}
});
test('disabled registration remains disabled and creates neither accounts nor onboarding',async()=>{
 const f=await fixture();try{f.env.REGISTRATION_ENABLED='false';const c=await browser(f);const r=await c.request('/auth/register','POST',{email:'closed@example.test',password:'registration-password-1234',...accept});assert.equal(r.status,403);assert.equal((await r.json()).error,'registration_disabled');assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM user_onboarding').first()).n,0);
 }finally{f.close();}
});
