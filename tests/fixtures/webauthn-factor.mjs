import {generateKeyPairSync,randomBytes,createHash,sign} from 'node:crypto';
import assert from 'node:assert/strict';
export function authenticator(){
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'});
 const cose=Buffer.concat([Buffer.from([0xa5,0x01,0x02,0x03,0x26,0x20,0x01,0x21,0x58,0x20]),Buffer.from(jwk.x,'base64url'),Buffer.from([0x22,0x58,0x20]),Buffer.from(jwk.y,'base64url')]);
 return {id:randomBytes(32).toString('base64url'),public_key:cose.toString('base64'),privateKey:pair.privateKey};
}
export async function enrollFixture(f,key,user='owner'){
 await f.DB.prepare('INSERT INTO security_keys VALUES (?,?,?,?,?,?,?,?,?)').bind(key.id,user,'Hardware test key',key.public_key,0,'[]',0,Math.floor(Date.now()/1000),null).run();
}
export function assertion(key,challenge,{origin='https://example.test',rpID='example.test',flags=5,counter=1,user='owner',signatureKey=key.privateKey}={}){
 const clientData=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:challenge.options.challenge,origin,crossOrigin:false})),count=Buffer.alloc(4);count.writeUInt32BE(counter);
 const data=Buffer.concat([createHash('sha256').update(rpID).digest(),Buffer.from([flags]),count]);
 return {id:key.id,rawId:key.id,type:'public-key',response:{authenticatorData:data.toString('base64url'),clientDataJSON:clientData.toString('base64url'),signature:sign('sha256',Buffer.concat([data,createHash('sha256').update(clientData).digest()]),signatureKey).toString('base64url'),userHandle:Buffer.from(user).toString('base64url')},clientExtensionResults:{}};
}
export async function browser(f){
 const cookies=new Map();let csrf;
 function capture(r){for(const cookie of r.headers.getSetCookie()){const first=cookie.split(';')[0],i=first.indexOf('=');cookies.set(first.slice(0,i),first.slice(i+1));if(/Max-Age=0(?:;|$)/.test(cookie))cookies.delete(first.slice(0,i));}}
 const request=async(path,method='GET',body,extra={})=>{
  const headers={Origin:'https://example.test','Content-Type':'application/json',Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(csrf?{'X-CSRF-Token':csrf}:{}),...extra};
  const r=await f.request(path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});capture(r);return r;
 };
 const r=await request('/api/home/csrf');assert.equal(r.status,200);csrf=(await r.json()).csrf_token;
 return {cookies,request,login:()=>request('/auth/login','POST',{email:'owner@example.test',password:'test-password-1234'}),options:async()=>{const r=await request('/auth/passkey/options','POST',{});assert.equal(r.status,200);return r.json();},verify:(key,c,opts)=>request('/auth/passkey/verify','POST',{challenge_id:c.challenge_id,response:assertion(key,c,opts)})};
}
