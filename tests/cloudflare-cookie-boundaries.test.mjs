import test from 'node:test';
import assert from 'node:assert/strict';
import {cookieValue} from '../cloudflare/security.mjs';
import {fixture} from './fixtures/account-worker.mjs';
const origin='https://example.test';
test('security cookie parser uses exact names and rejects ambiguous duplicates',()=>{
 const get=header=>cookieValue(new Request(origin,{headers:{Cookie:header}}),'__Host-qrs_session');
 assert.equal(get('other=x; __Host-qrs_session=abc; last=y'),'abc');
 for(const header of ['lookalike-__Host-qrs_session=abc','__Host-qrs_session_extra=abc','__host-qrs_session=abc','__Host-qrs_session=abc; __Host-qrs_session=abc','__Host-qrs_session=; __Host-qrs_session=abc'])assert.equal(get(header),null);
 assert.equal(get('lookalike-__Host-qrs_session=bad; __Host-qrs_session=good'),'good');
});
test('lookalike, suffixed and duplicate session or CSRF cookies cannot authorize requests',async()=>{
 const f=await fixture();try{
  const token=await f.request('/api/home/csrf'),csrf=await token.json(),preview=token.headers.get('Set-Cookie').split(';')[0];
  const headers={Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf.csrf_token,Cookie:preview};
  const login=await f.request('/auth/login',{method:'POST',headers,body:JSON.stringify({email:'owner@example.test',password:'test-password-1234'})});assert.equal(login.status,200);
  const session=login.headers.get('Set-Cookie').split(';')[0];
  for(const bad of ['lookalike-'+session,session+'-suffix',session+'; '+session,session.replace('__Host-qrs_session=','__Host-qrs_session=bad')])assert.equal((await f.request('/api/session',{headers:{Cookie:bad}})).status,401);
  for(const bad of ['lookalike-'+preview,preview+'-suffix',preview+'; '+preview]){
   const r=await f.request('/auth/logout',{method:'POST',headers:{...headers,Cookie:bad+'; '+session},body:'{}'});assert.equal(r.status,403);assert.equal((await r.json()).error,'invalid_csrf');
  }
  assert.equal((await f.request('/api/session',{headers:{Cookie:'lookalike-'+session.replace(/=.+$/,'=invalid')+'; '+session}})).status,200);
  const signed=await f.request('/api/home/csrf',{headers:{Cookie:preview}});assert.equal(signed.headers.get('Set-Cookie'),null);assert.equal((await signed.json()).csrf_token,csrf.csrf_token);
  const renewed=await f.request('/api/home/csrf',{headers:{Cookie:'lookalike-'+preview}});assert.ok(renewed.headers.get('Set-Cookie'));
  const logout=await f.request('/auth/logout',{method:'POST',headers:{...headers,Cookie:preview+'; '+session},body:'{}'});assert.equal(logout.status,200);
 }finally{f.close();}
});
test('responses isolate browsing contexts, resources and legacy framing',async()=>{
 const f=await fixture();try{for(const path of ['/healthz','/api/session']){const r=await f.request(path);assert.equal(r.headers.get('Cross-Origin-Opener-Policy'),'same-origin');assert.equal(r.headers.get('Cross-Origin-Resource-Policy'),'same-origin');assert.equal(r.headers.get('X-Frame-Options'),'DENY');assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);}}finally{f.close();}
});
