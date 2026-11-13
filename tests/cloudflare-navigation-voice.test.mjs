import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationVoiceRoutes,voiceText} from '../cloudflare/navigation-voice.mjs';
const report={status:'proposal',geometry_alignment:{status:'matched'},summary:'A connected proposed corridor.',segments:[{instruction:'Turn left onto First Street.'}]};
const request=body=>new Request('https://example.test/api/route/voice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const helpers={principal:async()=>({user_id:'owner',session_hash:'session'}),limit:async()=>{},loadRoute:async(user,id)=>{assert.equal(user,'owner');assert.equal(id,12);return report;}};
test('voice speaks only fixed text or the owner-scoped saved route, with bounded natural style instructions',async()=>{
 let sent;
 const r=await navigationVoiceRoutes(request({cue:'turn',preset:'atlas',report_id:12,section_index:0,distance_m:100}),{OPENAI_API_KEY:'PRIVATE_TEST_KEY'},helpers,async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/audio/speech');assert.equal(options.redirect,'manual');sent=JSON.parse(options.body);return new Response(new Uint8Array([73,68,51]),{headers:{'Content-Type':'audio/mpeg'}});});
 assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('X-QRS-AI-Generated'),'true');assert.equal(sent.model,'gpt-4o-mini-tts');assert.equal(sent.voice,'cedar');assert.ok(sent.input.includes('Turn left onto First Street.'));assert.ok(sent.instructions.includes('Never add fillers'));assert.equal((await r.arrayBuffer()).byteLength,3);
 assert.throws(()=>voiceText({cue:'preview',preset:'atlas',input:'arbitrary speech'},null),/invalid_voice_request/);
 assert.throws(()=>voiceText({cue:'turn',preset:'atlas',report_id:12,section_index:1,distance_m:100},report),/invalid_voice_request/);
 assert.ok(voiceText({cue:'approach',preset:'atlas',report_id:12,distance_m:1609},report).includes('1.0 miles'));
 assert.equal(voiceText({cue:'summary',preset:'atlas',report_id:12},{...report,summary:'x'.repeat(10000)}).length,1200);
});
test('voice authentication, quotas, missing reports and provider failures do not turn into paid unrestricted speech',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('PRIVATE_PROVIDER_SENTINEL');};
 await assert.rejects(navigationVoiceRoutes(request({cue:'preview',preset:'atlas'}),{OPENAI_API_KEY:'key'},{...helpers,principal:async()=>({user_id:'owner'})},fetcher),e=>e.status===401);
 await assert.rejects(navigationVoiceRoutes(request({cue:'preview',preset:'atlas'}),{OPENAI_API_KEY:'key'},{...helpers,limit:async()=>{throw Object.assign(Error('rate_limit_exceeded'),{status:429});}},fetcher),e=>e.status===429);assert.equal(calls,0);
 await assert.rejects(navigationVoiceRoutes(request({cue:'summary',preset:'atlas',report_id:12}),{OPENAI_API_KEY:'key'},{...helpers,loadRoute:async()=>{throw Object.assign(Error('report_not_found'),{status:404});}},fetcher),e=>e.status===404);assert.equal(calls,0);
 await assert.rejects(navigationVoiceRoutes(request({cue:'preview',preset:'atlas'}),{OPENAI_API_KEY:'key'},helpers,fetcher),e=>e.status===503&&e.message==='voice_unavailable');
 const disabled=await navigationVoiceRoutes(new Request('https://example.test/api/route/voice'),{},helpers);assert.equal((await disabled.json()).enabled,false);
});
