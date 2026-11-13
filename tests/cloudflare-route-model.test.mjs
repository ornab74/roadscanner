import test from 'node:test';
import assert from 'node:assert/strict';
import {routeModelJSON} from '../cloudflare/route-model.mjs';
const body={model:'gpt-6-luna',store:false,max_output_tokens:100,instructions:'Original endpoint constraints.',input:'Original evidence.'};
const options={maxBytes:4096,incompleteMessage:'Route model did not complete',httpMessage:'Route model failed: HTTP ',validate:r=>{if(!r.valid)throw Error('Invalid visual route schema');return r;}};
const completed=r=>Response.json({status:'completed',model:'fixture',output:[{content:[{type:'output_text',text:JSON.stringify(r)}]}]});

test('truncated output is retried once with the original evidence and a bounded larger budget',async()=>{
 let calls=0;
 const result=await routeModelJSON({OPENAI_API_KEY:'fixture'},body,async(url,init)=>{
  const sent=JSON.parse(init.body);assert.equal(sent.input,body.input);assert.equal(sent.store,false);assert.equal(init.redirect,'manual');
  assert.equal(sent.max_output_tokens,++calls===1?100:200);
  return calls===1?Response.json({status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}):completed({valid:true});
 },options);
 assert.equal(calls,2);assert.equal(result.result.valid,true);
});
test('repair retains validation and stops after its second invalid response',async()=>{
 let calls=0;
 await assert.rejects(routeModelJSON({OPENAI_API_KEY:'fixture'},body,async()=>{calls++;return completed({valid:false});},options),/Invalid visual route schema/);
 assert.equal(calls,2);
});
test('malformed JSON from the provider gets one validated repair',async()=>{
 let calls=0;
 const result=await routeModelJSON({OPENAI_API_KEY:'fixture'},body,async()=>++calls===1?Response.json({status:'completed',output:[{content:[{type:'output_text',text:'{"valid":'}]}]}):completed({valid:true}),options);
 assert.equal(result.result.valid,true);assert.equal(calls,2);
});
test('context requests and provider failures do not cause model retry loops',async()=>{
 let calls=0;
 const result=await routeModelJSON({OPENAI_API_KEY:'fixture'},body,async()=>{calls++;return completed({valid:true,status:'needs_context'});},options);
 assert.equal(result.result.status,'needs_context');assert.equal(calls,1);
 calls=0;
 await assert.rejects(routeModelJSON({OPENAI_API_KEY:'fixture'},body,async()=>{calls++;return new Response('',{status:429});},options),/HTTP 429/);
 assert.equal(calls,1);
});
