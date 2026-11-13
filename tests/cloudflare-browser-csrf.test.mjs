import test from 'node:test';
import assert from 'node:assert/strict';
let version=0;
const load=()=>import('../cloudflare/public/pages/common.mjs?csrf-test='+version++);
test('parallel writes share one in-memory CSRF fetch and keep POST requests uncached',async()=>{
 const saved=globalThis.fetch;let tokens=0,writes=0;
 globalThis.fetch=async(path,options)=>{if(path==='/api/home/csrf'){tokens++;assert.equal(options.cache,'no-store');await new Promise(resolve=>setImmediate(resolve));return Response.json({csrf_token:'a'.repeat(64),expires_at:Math.floor(Date.now()/1000)+3600});}writes++;assert.equal(options.headers.get('X-CSRF-Token'),'a'.repeat(64));return Response.json({ok:true});};
 try{const {api,csrfFetch}=await load();await Promise.all(Array.from({length:8},()=>api('/write',{method:'POST',body:'{}'})));await csrfFetch('/audio',{method:'POST',body:'{}'});assert.equal(tokens,1);assert.equal(writes,9);}finally{globalThis.fetch=saved;}
});
test('an expired CSRF rejection refreshes once; permission errors and other failures are not replayed',async()=>{
 const saved=globalThis.fetch;let tokens=0,writes=0,kind='csrf';
 globalThis.fetch=async(path)=>{if(path==='/api/home/csrf')return Response.json({csrf_token:String(++tokens)});writes++;return kind==='csrf'&&writes===1?Response.json({error:'invalid_csrf'},{status:403}):kind==='permission'?Response.json({error:'admin_required'},{status:403}):Response.json({ok:true});};
 try{let {api}=await load();await api('/write',{method:'POST'});assert.equal(tokens,2);assert.equal(writes,2);tokens=0;writes=0;kind='permission';({api}=await load());await assert.rejects(api('/write',{method:'POST'}));assert.equal(tokens,1);assert.equal(writes,1);}finally{globalThis.fetch=saved;}
});
test('CSRF reuse stops before server expiry and network failures never replay a possible mutation',async()=>{
 const saved=globalThis.fetch,now=Date.now;let clock=1700000000000,tokens=0,writes=0,fail=false;Date.now=()=>clock;
 globalThis.fetch=async(path)=>{if(path==='/api/home/csrf'){tokens++;return Response.json({csrf_token:'token-'+tokens,expires_at:Math.floor(clock/1000)+180});}writes++;if(fail)throw Error('connection lost');return Response.json({ok:true});};
 try{const {api}=await load();await api('/write',{method:'POST'});clock+=121000;await api('/write',{method:'POST'});assert.equal(tokens,2);fail=true;await assert.rejects(api('/write',{method:'POST'}),/connection lost/);assert.equal(writes,3);}finally{globalThis.fetch=saved;Date.now=now;}
});
