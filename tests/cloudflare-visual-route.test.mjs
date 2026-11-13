import {pngHeader,imageryResponse} from './fixtures/image-headers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVisualRequest,toPixel,fromPixel,validateVisualResult,analyzeVisualRoute} from '../cloudflare/visual-route.mjs';
const image='data:image/png;base64,'+pngHeader().toString('base64');
const input={start:{latitude:40.75,longitude:-74},destination:{latitude:40.76,longitude:-73.99},mode:'walking',notes:'Use visible paths.',map:{image,width:800,height:600,bounds:{north:40.77,south:40.74,east:-73.98,west:-74.01}},context_images:[]};
function result(){return {status:'proposal',summary:'Proposed visible path, subject to verification.',endpoint_guidance:['Confirm the entrance on site.'],limitations:['No verified legal routing or indoor access.'],segments:[{id:0,street:'Visible street',instruction:'Proposed path toward the destination.',risk_score:35,risk_reason:'Weather estimate suggests rain; road wetness is unverified.',evidence:'weather_estimate',points:[toPixel(input.start,input.map.bounds),toPixel(input.destination,input.map.bounds)]}]};}
test('route objectives are optional and strictly allowlisted',()=>{
 assert.equal(validateVisualRequest(input).objective,'balanced');
 for(const objective of ['fastest','simplest','caution','fuel'])assert.equal(validateVisualRequest({...input,objective}).objective,objective);
 for(const objective of ['__proto__','ignore constraints',['fastest'],null,123])assert.throws(()=>validateVisualRequest({...input,objective}),/invalid_route_request/);
});
test('visual input validates image size, bounds and endpoints; Mercator conversion round trips',()=>{
 assert.equal(validateVisualRequest(input).mode,'walking');const p=toPixel(input.start,input.map.bounds),geo=fromPixel(p,input.map.bounds);assert.ok(Math.abs(geo[0]-input.start.longitude)<1e-8);assert.ok(Math.abs(geo[1]-input.start.latitude)<1e-8);
 assert.throws(()=>validateVisualRequest({...input,map:{...input.map,image:'data:image/png;base64,AAAA'}}),/image/);
 assert.throws(()=>validateVisualRequest({...input,start:{latitude:60,longitude:0}}),/outside/);
 assert.throws(()=>validateVisualRequest({...input,context_images:[image,image,image]}),/request/);
});
test('visual route rejects wrong endpoints, disconnected geometry and fabricated evidence confidence',()=>{
 const r=validateVisualResult(result(),input);assert.equal(r.segments[0].geometry.type,'LineString');
 const wrong=result();wrong.segments[0].points[0]={x:0,y:0};assert.throws(()=>validateVisualResult(wrong,input),/endpoints/);
 const unknown=result();unknown.segments[0].evidence='uncertain';assert.equal(validateVisualResult(unknown,input).segments[0].risk_score,null);
 const incomplete=result();incomplete.status='needs_context';assert.throws(()=>validateVisualResult(incomplete,input),/Incomplete/);
});
test('road source outages get one retry, preserve a precise diagnostic and never request mapped directions',async()=>{
 let sourceCalls=0,modelCalls=0;
 const fetcher=async(url)=>{if(imageryResponse(url))return imageryResponse(url);if(url.startsWith('https://api.met.no/'))return new Response('',{status:503});if(url==='https://tiles.openfreemap.org/planet'){sourceCalls++;return new Response('',{status:503});}modelCalls++;return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result())}]}]});};
 const r=await analyzeVisualRoute({OPENAI_API_KEY:'fixture',ROUTE_ROAD_TRACE:'true'},input,fetcher);
 assert.equal(sourceCalls,2);assert.equal(modelCalls,1);assert.equal(r.status,'needs_context');assert.deepEqual(r.segments,[]);assert.equal(r.alignment_failure.code,'source_unavailable');assert.equal(r.geometry_alignment.failure_code,'source_unavailable');assert.ok(!r.summary.includes('Refine the endpoints'));
});
test('GPT-6 Luna receives images and weather, uses no route engine, and rejects incomplete output',async()=>{
 let providerCalls=0;
 const fetcher=async(url,options)=>{if(imageryResponse(url))return imageryResponse(url);if(url.startsWith('https://api.met.no/'))return new Response('',{status:503});providerCalls++;assert.equal(options.redirect,'manual');assert.equal(url,'https://api.openai.com/v1/responses');const b=JSON.parse(options.body);assert.equal(b.model,'gpt-6-luna');assert.equal(b.store,false);assert.ok(b.input[0].content.some(c=>c.type==='input_image'));assert.match(b.instructions,/There is no routing engine/);assert.match(b.instructions,/Map Excellence/);assert.ok(JSON.parse(b.input[0].content[0].text).image_manifest);return Response.json({status:'completed',model:'gpt-6-luna',output:[{content:[{type:'output_text',text:JSON.stringify(result())}]}]});};
 const r=await analyzeVisualRoute({OPENAI_API_KEY:'test'},input,fetcher);assert.equal(r.model_used,'gpt-6-luna');assert.equal(r.provenance.routing_engine,false);assert.equal(r.provenance.raw_images_retained,false);assert.equal(providerCalls,1);
 await assert.rejects(analyzeVisualRoute({OPENAI_API_KEY:'test'},input,async url=>imageryResponse(url)??(url.startsWith('https://api.met.no/')?new Response('',{status:503}):Response.json({status:'incomplete',output:[]}))),/complete/);
});
