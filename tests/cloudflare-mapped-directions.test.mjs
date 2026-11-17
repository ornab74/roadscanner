import test from'node:test';import assert from'node:assert/strict';import{annotateMappedRoute,mappedSectionFacts}from'../cloudflare/mapped-directions.mjs';
const components=n=>({geometry:n,maneuver:n,weather:n,vehicle:n,uncertainty:n});
const segments=[{id:0,street:'First Street',distance_m:100,geometry:{coordinates:[[0,0],[.001,0]]}},{id:1,street:'Second Street',distance_m:100,geometry:{coordinates:[[.001,0],[.001,.001]]}}];
test('approved annotation uses the explicit component calculation instead of the model overall anchor',async()=>{
 const aligned={status:'proposal',summary:'Candidate',segments:[segments[0]],limitations:[]};
 const r=await annotateMappedRoute({OPENAI_API_KEY:'fixture'},aligned,[],'',async(_,options)=>{
  const b=JSON.parse(options.body);assert.ok(b.text.format.schema.properties.segments.items.required.includes('risk_components'));
  return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({status:'proposal',summary:'Reviewed',limitations:[],segments:[{id:0,instruction:'Continue',risk_score:33,risk_components:{geometry:5,maneuver:5,weather:10,vehicle:10,uncertainty:30},score_basis:'map_context',risk_reason:'Straight section with missing current conditions.',evidence:'visible_map'}]})}]}]});
 });
 assert.equal(r.segments[0].risk_score,10);assert.equal(r.risk_scoring.version,'section-components-v2');assert.equal(r.risk_scoring.weights.geometry,.25);assert.strictEqual(r.segments[0].geometry,segments[0].geometry);
});
test('the first model corridor is non-binding and a connected alternative is the review target',async()=>{
 const aligned={status:'proposal',summary:'Use US 123 toward the destination.',segments,limitations:[],geometry_alignment:{status:'matched',length_m:200,start_offset_m:6,destination_offset_m:128}};
 const r=await annotateMappedRoute({OPENAI_API_KEY:'fixture'},aligned,[],'',async(_,options)=>{
  const body=JSON.parse(options.body),input=JSON.parse(body.input);assert.equal(input.review_target,'recovered_mapped_candidate');assert.equal(input.initial_model_hypothesis.binding,false);assert.equal(input.candidate_topology.connected,true);assert.equal(input.candidate_topology.destination_offset_m,128);assert.equal(input.user_notes,'');assert.ok(body.instructions.includes('Do not reject a candidate solely because a road mentioned by the earlier model'));
  return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({status:'proposal',summary:'Connected alternative using the supplied streets.',limitations:['Confirm the final entrance.'],segments:segments.map(s=>({id:s.id,instruction:'Continue on '+s.street,risk_score:25,risk_components:components(25),score_basis:'illustrative_baseline',risk_reason:'Illustrative mapped-corridor review.',evidence:'visible_map'}))})}]}]});
 });assert.equal(r.status,'proposal');assert.equal(r.segments.length,2);assert.strictEqual(r.segments[0].geometry,segments[0].geometry);
});
test('explicit user constraints still reach review and a genuine blocking result is preserved',async()=>{
 const aligned={status:'proposal',summary:'Initial suggestion',segments,limitations:[],geometry_alignment:{status:'matched'}};
 const r=await annotateMappedRoute({OPENAI_API_KEY:'fixture'},aligned,[],'Avoid First Street.',async(_,options)=>{assert.equal(JSON.parse(JSON.parse(options.body).input).user_notes,'Avoid First Street.');return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({status:'needs_context',summary:'The candidate conflicts with the requested avoidance.',limitations:['Choose another corridor.'],segments:[]})}]}]});});assert.equal(r.status,'needs_context');assert.deepEqual(r.segments,[]);
});
test('every approved section gets an explicit illustrative score without requiring weather or a street name',async()=>{
 const aligned={status:'proposal',summary:'Road proposal',segments:[{...segments[0],street:'minor connector (name unavailable)',name_provenance:'UNKNOWN'}],limitations:[],geometry_alignment:{status:'matched'}};
 const fetcher=async(_,options)=>{const body=JSON.parse(options.body),item=body.text.format.schema.properties.segments.items;assert.equal(item.properties.risk_score.type,'integer');assert.ok(item.required.includes('score_basis'));assert.ok(body.instructions.includes('even when weather, traffic or street names are unknown'));return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({status:'proposal',summary:'Illustrative section index.',limitations:['Current conditions unavailable.'],segments:[{id:0,instruction:'Continue on the mapped connector.',risk_score:38,risk_components:components(38),score_basis:'illustrative_baseline',risk_reason:'Illustrative baseline for the supplied connector geometry; no current conditions observed.',evidence:'uncertain'}]})}]}]});};
 const r=await annotateMappedRoute({OPENAI_API_KEY:'fixture'},aligned,[],'',fetcher);assert.equal(r.segments[0].risk_score,38);assert.equal(r.segments[0].score_basis,'illustrative_baseline');assert.equal(r.segments[0].evidence,'uncertain');assert.strictEqual(r.segments[0].geometry,aligned.segments[0].geometry);assert.equal(r.risk_scoring.probability,false);
});
test('null scores are rejected rather than replaced with arbitrary fixed numbers',async()=>{
 const aligned={status:'proposal',summary:'Road',segments,limitations:[]};
 await assert.rejects(annotateMappedRoute({OPENAI_API_KEY:'fixture'},aligned,[],'',async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({status:'proposal',summary:'Invalid',limitations:[],segments:segments.map(s=>({id:s.id,instruction:'Continue',risk_score:null,score_basis:'illustrative_baseline',risk_reason:'Missing',evidence:'uncertain'}))})}]}]})),/annotation/);
});
test('mapped section direction is derived from bearings and LLM cannot replace road geometry',async()=>{assert.equal(mappedSectionFacts(segments)[1].entry_turn_geometry,'left');const aligned={status:'proposal',summary:'Road proposal',segments,limitations:[],geometry_alignment:{status:'matched'}};const r=await annotateMappedRoute({OPENAI_API_KEY:'test'},aligned,[],'',async(url,options)=>{assert.equal(options.redirect,'manual');return Response.json({status:'completed',model:'gpt-6-luna',output:[{content:[{type:'output_text',text:JSON.stringify({status:'proposal',summary:'Mapped route',limitations:['Unverified access'],segments:segments.map(s=>({id:s.id,instruction:'Continue on '+s.street,risk_score:10,risk_components:components(10),risk_reason:'Modeled caution',evidence:'weather_estimate'}))})}]}]});});assert.strictEqual(r.segments[0].geometry,segments[0].geometry);assert.equal(r.segments[1].risk_score,10);});
test('final mapped review receives bounded connector image evidence and spatial manifests',async()=>{
 const {mappedReviewInput}=await import('../cloudflare/mapped-directions.mjs');const image='data:image/jpeg;base64,fixture',frames=Array.from({length:20},(_,i)=>({id:'connector-'+i,role:'mapped junction',bounds:{north:1,south:0,east:1,west:0},image}));
 const input=mappedReviewInput({review_target:'recovered_mapped_candidate'},{frames,warnings:['Coverage may be incomplete.']});assert.equal(input[0].role,'user');assert.equal(input[0].content.filter(x=>x.type==='input_image').length,12);const facts=JSON.parse(input[0].content[0].text);assert.equal(facts.junction_image_manifest.length,12);assert.ok(facts.junction_image_manifest.every(f=>f.bounds&&!Object.hasOwn(f,'image')));
});
test('short snapped-edge jitter cannot invent a right turn when the road continues straight',()=>{
 const previous={id:0,street:'Approach',distance_m:100,geometry:{coordinates:[[0,0],[.001,0]]}},next={id:1,street:'Connector',distance_m:100,geometry:{coordinates:[[.001,0],[.001,-.000002],[.002,0]]}};
 const facts=mappedSectionFacts([previous,next]);assert.equal(facts[1].entry_turn_geometry,'continue');assert.ok(Math.abs(facts[1].heading_delta_degrees)<25);
 const left={id:2,street:'Exit',distance_m:100,geometry:{coordinates:[[.002,0],[.002,.001]]}};assert.equal(mappedSectionFacts([next,left])[1].entry_turn_geometry,'left');
});
test('heading stabilization preserves a genuine short entrance turn rather than smoothing across it',()=>{
 const previous={id:0,geometry:{coordinates:[[0,0],[.001,0]]}},next={id:1,geometry:{coordinates:[[.001,0],[.001,-.00004],[.002,-.00004]]}};
 assert.equal(mappedSectionFacts([previous,next])[1].entry_turn_geometry,'right');
});
