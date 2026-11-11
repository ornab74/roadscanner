import test from 'node:test';
import assert from 'node:assert/strict';
import {assessWithOpenAI} from '../cloudflare/openai.mjs';
const key='test-key-not-a-real-provider-credential';
const result={harm_level:'High',summary:'Supplied observations describe reduced visibility.',reasons:['Heavy rain was reported.']};
test('OpenAI calls the direct Responses API with bounded output and no storage',async()=>{
 let called=false;
 const assessment=await assessWithOpenAI(key,'gpt-5.5',{source:'user_supplied_observations',observations:{weather:'rain'}},async(url,options)=>{
  called=true;assert.equal(options.redirect,'manual');assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer '+key);
  const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.max_output_tokens,768);assert.equal(body.model,'gpt-5.5');assert.equal(body.text.format.type,'json_schema');
  assert.ok(!JSON.stringify(body).includes(key));
  return Response.json({status:'completed',model:'gpt-5.5',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
 });
 assert.equal(called,true);assert.equal(assessment.provider,'openai');assert.equal(assessment.harm_level,'High');
});
test('OpenAI refuses failed, incomplete and invalid model results',async()=>{
 await assert.rejects(assessWithOpenAI(key,'gpt-5.5',{},async()=>new Response('{}',{status:401})),/HTTP 401/);
 await assert.rejects(assessWithOpenAI(key,'gpt-5.5',{},async()=>Response.json({status:'incomplete',output:[]})),/did not complete/);
 await assert.rejects(assessWithOpenAI(key,'gpt-5.5',{},async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...result,harm_level:'Safe'})}]}]})),/schema/);
 await assert.rejects(assessWithOpenAI('', 'gpt-5.5',{}),/not configured/);
 await assert.rejects(assessWithOpenAI(key,'xai/grok-4.7',{}),/Invalid OpenAI model/);
});
test('public preview validates a bounded numeric severity index',async()=>{
 const provider=ratio=>async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...result,harm_ratio:ratio})}]}]});
 assert.equal((await assessWithOpenAI(key,'gpt-5.5',{},provider(.37),true)).harm_ratio,.37);
 await assert.rejects(assessWithOpenAI(key,'gpt-5.5',{},provider(1.1),true),/schema/);
 await assert.rejects(assessWithOpenAI(key,'gpt-5.5',{},provider('0.5'),true),/schema/);
});

test('OpenAI credential requests reject provider redirects',async()=>{let calls=0;await assert.rejects(assessWithOpenAI(key,'gpt-5.5',{},async(url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response('{}',{status:302,headers:{Location:'https://evil.example/'}});}),/HTTP 302/);assert.equal(calls,1);});
