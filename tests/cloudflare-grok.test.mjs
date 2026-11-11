import test from 'node:test';
import assert from 'node:assert/strict';
import {assessWithGrok} from '../cloudflare/grok-home.mjs';
import {originalGrokPrompt} from '../cloudflare/grok-home-prompt.mjs';
const reading={harm_ratio:.42,label:'Caution',color:'#ffb300',confidence:.68,reasons:['Simulated visibility is reduced.','Leave a larger following gap.'],blurb:'Allow extra space in this simulated road scene.'};
const reply=value=>Response.json({model:'grok-4-1-fast-non-reasoning',choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
test('Grok uses the original prompt and direct xAI settings with a fresh synthetic seed',async()=>{
 const prompts=[];const fetcher=async(url,options)=>{assert.equal(options.redirect,'manual');assert.equal(url,'https://api.x.ai/v1/chat/completions');const body=JSON.parse(options.body);assert.equal(body.model,'grok-4-1-fast-non-reasoning');assert.equal(body.max_tokens,300);assert.equal(body.temperature,.7);assert.deepEqual(body.response_format,{type:'json_object'});assert.match(body.messages[0].content,/fictional simulation/);prompts.push(body.messages[1].content);return reply(reading);};
 const r=await assessWithGrok('test-secret','grok-4-1-fast-non-reasoning',fetcher);await assessWithGrok('test-secret','grok-4-1-fast-non-reasoning',fetcher);
 assert.notEqual(prompts[0],prompts[1]);assert.match(prompts[0],/Hypertime Nanobot RoadRisk Oracle v7/);assert.ok(!prompts[0].includes('{{QUANTUM_STATE}}'));assert.equal(r.provider,'grok');assert.equal(r.color,'#ffb300');assert.equal(r.confidence,.68);assert.ok(originalGrokPrompt.includes('TRIPLE-VALIDATION PROTOCOL'));
});
test('Grok rejects wrong colors, incomplete outputs and provider failures',async()=>{
 await assert.rejects(assessWithGrok('test','grok-4-1-fast-non-reasoning',async()=>reply({...reading,color:'#ffffff'})),/color/);
 await assert.rejects(assessWithGrok('test','grok-4-1-fast-non-reasoning',async()=>Response.json({choices:[{finish_reason:'length'}]})),/complete/);
 await assert.rejects(assessWithGrok('test','grok-4-1-fast-non-reasoning',async()=>new Response('{}',{status:401})),/HTTP 401/);
});
