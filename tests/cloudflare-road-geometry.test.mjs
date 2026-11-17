import test from 'node:test';import assert from 'node:assert/strict';
import {alignToRoads,roadNameMatch,tilesForRoute}from'../cloudflare/road-geometry.mjs';
const z=13,base={x:10000000,y:14000000},p=(x,y)=>({x:base.x+x,y:base.y+y}),geo=p=>[p.x/(4096*2**z)*360-180,Math.atan(Math.sinh(Math.PI*(1-2*p.y/(4096*2**z))))*180/Math.PI],point=p=>({longitude:geo(p)[0],latitude:geo(p)[1]});
const road=(name,points,oneway=0)=>({name,ref:'',class:'minor',points,z,oneway}),segment=(name,a,b)=>({id:0,street:name,instruction:'Proposed path',risk_score:15,risk_reason:'Modeled weather',evidence:'weather_estimate',geometry:{coordinates:[geo(a),geo(b)]}}),source=roads=>({roads,zoom:z,tile_count:1,dataset:'fixture',provider:'Synthetic test map'});
test('separate map labels name actual road edges without becoming routable geometry',()=>{
 const a=p(0,0),b=p(200,0),c=p(400,0),label={...road('West Faris Road',[p(0,1),p(400,1)]),label_only:true};
 const r={status:'proposal',summary:'Street',limitations:[],segments:[segment('West Faris Road',a,c)]};
 const aligned=alignToRoads(r,{start:point(a),destination:point(c),mode:'driving'},source([road('',[a,b,c]),label]));
 assert.equal(aligned.segments.length,1);assert.equal(aligned.segments[0].street,'West Faris Road');assert.equal(aligned.segments[0].name_provenance,'DERIVED_FROM_MAPPED_LABEL');
 assert.deepEqual(aligned.segments[0].geometry.coordinates,[geo(a),geo(b),geo(c)]);
 assert.throws(()=>alignToRoads(r,{start:point(a),destination:point(c),mode:'driving'},source([label])),/far/);
 assert.throws(()=>alignToRoads(r,{start:point(c),destination:point(a),mode:'driving'},source([road('',[a,b,c],1),label])),/connect/);
});
test('name recovery preserves existing names and rejects ambiguous nearby labels',()=>{
 const a=p(0,0),b=p(100,0),baseResult={status:'proposal',summary:'Street',limitations:[],segments:[segment('Alpha Road',a,b)]};
 const labels=[{...road('Alpha Road',[p(0,1),p(100,1)]),label_only:true},{...road('Beta Road',[p(0,-1),p(100,-1)]),label_only:true}];
 const known=alignToRoads(baseResult,{start:point(a),destination:point(b),mode:'driving'},source([road('Actual Road',[a,b]),...labels]));assert.equal(known.segments[0].street,'Actual Road');
 const unknown=alignToRoads(baseResult,{start:point(a),destination:point(b),mode:'driving'},source([road('',[a,b]),...labels]));assert.match(unknown.segments[0].street,/name unavailable/);
});
test('road trace follows imported bends instead of an LLM diagonal chord',()=>{const coords=[p(0,0),p(100,0),p(100,100),p(200,100),p(200,0),p(300,0)],r={status:'proposal',summary:'A',limitations:[],segments:[segment('Alpha Road',coords[0],coords.at(-1))]};const a=alignToRoads(r,{start:point(coords[0]),destination:point(coords.at(-1)),mode:'driving'},source([road('Alpha Road',coords)]));assert.equal(a.geometry_alignment.status,'matched');assert.ok(a.segments[0].geometry.coordinates.length>=6);assert.equal(a.segments[0].geometry_provenance,'IMPORTED');assert.equal(a.segments[0].risk_score,15);assert.equal(a.geometry_alignment.legal_routing_verified,false);});
test('cartographic T-junction is resolved locally and known one-way is preserved',()=>{const a=p(0,0),b=p(1000,0),c=p(500,0),d=p(500,500),r={status:'proposal',summary:'A',limitations:[],segments:[segment('Alpha Road',a,c),segment('Beta Road',c,d)]};const aligned=alignToRoads(r,{start:point(a),destination:point(d),mode:'driving'},source([road('Alpha Road',[a,b]),road('Beta Road',[c,d])]));assert.equal(aligned.segments.length,2);assert.ok(aligned.geometry_alignment.cartographic_junction_joins>0);assert.throws(()=>alignToRoads({...r,segments:[segment('Alpha Road',b,a)]},{start:point(b),destination:point(a),mode:'driving'},source([road('Alpha Road',[a,b],1)])),/connect/);});
test('road imports are bounded and unrelated corridors do not receive trusted alignment',()=>{assert.throws(()=>tilesForRoute({start:{latitude:0,longitude:0},destination:{latitude:10,longitude:10}}),/90 km/);assert.ok(roadNameMatch({name:'Calhoun Memorial Highway',ref:'123'},{street:'US 123 / Calhoun Memorial Highway'})>.8);const a=p(0,0),b=p(100,0);assert.throws(()=>alignToRoads({status:'proposal',summary:'A',limitations:[],segments:[segment('A',a,b)]},{start:point(p(10000,10000)),destination:point(b),mode:'driving'},source([road('A',[a,b])])),/far/);});
test('a disconnected nearest start feature can use a nearby connected anchor without drawing an access gap',()=>{
 const a=p(0,0),b=p(1000,20),main=[p(-50,20),p(1200,20)],r={status:'proposal',summary:'Mapped candidate',limitations:[],segments:[segment('Main Road',a,b)]};
 const out=alignToRoads(r,{start:point(a),destination:point(b),mode:'driving'},source([road('Isolated spur',[a,p(30,0)]),road('Main Road',main)]));
 assert.equal(out.geometry_alignment.endpoint_matching.used_alternatives,true);assert.equal(out.segments[0].street,'Main Road');assert.ok(out.geometry_alignment.start_offset_m>0&&out.geometry_alignment.start_offset_m<30);
 assert.deepEqual(out.segments[0].geometry.coordinates[0],geo(p(0,20)));assert.notDeepEqual(out.segments[0].geometry.coordinates[0],geo(a));assert.equal(out.geometry_alignment.legal_routing_verified,false);
});
test('a disconnected nearest destination feature uses the connected road approach and discloses its offset',()=>{
 const a=p(0,20),b=p(1000,0),r={status:'proposal',summary:'Mapped candidate',limitations:[],segments:[segment('Main Road',a,b)]};
 const out=alignToRoads(r,{start:point(a),destination:point(b),mode:'driving'},source([road('Main Road',[p(-50,20),p(1200,20)]),road('Isolated destination spur',[b,p(1030,0)])]));
 assert.equal(out.geometry_alignment.endpoint_matching.used_alternatives,true);assert.ok(out.geometry_alignment.destination_offset_m>0&&out.geometry_alignment.destination_offset_m<30);assert.deepEqual(out.segments.at(-1).geometry.coordinates.at(-1),geo(p(1000,20)));
});
test('connected nearest anchors remain preferred and farther alternatives cannot relocate an endpoint to force a route',()=>{
 const a=p(0,0),b=p(1000,0),r={status:'proposal',summary:'Mapped candidate',limitations:[],segments:[segment('Main Road',a,b)]};
 const out=alignToRoads(r,{start:point(a),destination:point(b),mode:'driving'},source([road('Main Road',[a,b]),road('Parallel Road',[p(0,20),p(1000,20)])]));assert.equal(out.geometry_alignment.endpoint_matching.used_alternatives,false);assert.equal(out.geometry_alignment.start_offset_m,0);assert.equal(out.geometry_alignment.destination_offset_m,0);
 assert.throws(()=>alignToRoads(r,{start:point(a),destination:point(p(1000,80)),mode:'driving'},source([road('Isolated spur',[a,p(30,0)]),road('Main Road',[p(-50,80),p(1200,80)])])),/connect/);
});
test('label borrowing does not create alternative projections along one one-way feature to evade its direction',()=>{
 const points=[p(0,0),p(10,0),p(20,0),p(30,0)],label={...road('One-way Road',[points[0],points.at(-1)]),label_only:true},r={status:'proposal',summary:'Mapped candidate',limitations:[],segments:[segment('One-way Road',points.at(-1),points[0])]};
 assert.throws(()=>alignToRoads(r,{start:point(points.at(-1)),destination:point(points[0]),mode:'driving'},source([road('',points,1),label])),/connect/);
});
test('short journeys request detailed road tiles without exceeding source zoom or tile budgets',()=>{
 const request={start:{latitude:34.83,longitude:-82.30},destination:{latitude:34.831,longitude:-82.301}};
 const tiles=tilesForRoute(request,14);assert.equal(tiles[0].z,14);assert.ok(tiles.length<=36);assert.equal(tilesForRoute(request,13)[0].z,13);
 assert.ok(tilesForRoute({start:{latitude:34.8,longitude:-82.5},destination:{latitude:35.1,longitude:-82.1}},14).length<=36);
});
