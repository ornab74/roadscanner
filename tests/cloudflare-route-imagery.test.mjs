import {jpegHeader} from './fixtures/image-headers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {imageryViews,fetchImagery,captureRouteImagery,connectorViews,satelliteTileViews} from '../cloudflare/route-imagery.mjs';
const request={start:{latitude:34.83,longitude:-82.6},destination:{latitude:34.85,longitude:-82.3},mode:'driving'};
const href='https://server.arcgisonline.com/arcgis/rest/directories/arcgisoutput/test.jpg';
const meta=()=>({href,width:1000,height:750,extent:{xmin:-9193999,ymin:4136735,xmax:-9188188,ymax:4140802}});
const jpeg=()=>new Response(jpegHeader(),{headers:{'Content-Type':'image/jpeg'}});
test('automatic atlas includes both endpoints in street and aerial views plus overlapping corridor panels',()=>{
 const v=imageryViews(request);assert.equal(v.length,12);for(const id of ['start-streets','start-satellite','destination-streets','destination-satellite'])assert.ok(v.some(f=>f.id===id));assert.ok(v.every(f=>f.bounds.west<f.bounds.east&&f.bounds.south<f.bounds.north));
 const close=imageryViews({...request,destination:{latitude:34.831,longitude:-82.601}});assert.equal(close.length,8);
});
test('imagery uses actual export extents and rejects arbitrary download origins',async()=>{
 const f=await fetchImagery(imageryViews(request)[0],async (url,options)=>{assert.equal(options.redirect,'manual');return url.includes('/export?')?Response.json(meta()):jpeg();});assert.ok(f.image.startsWith('data:image/jpeg;base64,'));assert.ok(f.bounds.north>f.bounds.south);assert.equal(f.imagery_date,'unknown');assert.equal(f.preview_url,href);
 await assert.rejects(fetchImagery(imageryViews(request)[0],async()=>Response.json({...meta(),href:'https://evil.example/image.jpg'})),/origin/);
});
test('automatic capture retains explicit missing-image warnings instead of fabricated frames',async()=>{
 const result=await captureRouteImagery(request,async (url,options)=>{assert.equal(options.redirect,'manual');return url.includes('/export?')?Response.json(meta()):jpeg();});assert.equal(result.frames.length,12);assert.equal(result.warnings.length,0);
 const failed=await captureRouteImagery(request,async()=>new Response('',{status:503}));assert.equal(failed.frames.length,0);assert.equal(failed.warnings.length,12);
});

test('imagery redirects are not followed',async()=>{await assert.rejects(fetchImagery(imageryViews(request)[0],async()=>new Response(null,{status:302,headers:{Location:'https://evil.example/'}})),/HTTP 302/);});
test('endpoint detail views are substantially tighter while retaining broad connection context',()=>{
 const views=imageryViews(request);for(const endpoint of ['start','destination']){
  const broad=views.find(v=>v.id===endpoint+'-streets'),close=views.find(v=>v.id===endpoint+'-detail-streets'),aerial=views.find(v=>v.id===endpoint+'-detail-satellite');
  assert.ok(close.bounds.north-close.bounds.south<(broad.bounds.north-broad.bounds.south)/5);assert.ok(aerial.bounds.north-aerial.bounds.south<close.bounds.north-close.bounds.south);
 }
});
test('connector review is bounded and prioritizes the first and last endpoint junctions',()=>{
 const segments=Array.from({length:12},(_,i)=>({id:i,road_class:'service',name_provenance:'UNKNOWN',geometry:{coordinates:[[-82.5+i*.01,34.8],[-82.49+i*.01,34.8]]}}));
 const views=connectorViews({segments});assert.equal(views.length,4);assert.deepEqual(views.map(v=>v.section_ids),[[0,1],[0,1],[10,11],[10,11]]);assert.ok(views.every(v=>v.bounds.north-v.bounds.south<.003));
});
test('unsupported zero-size aerial exports fall back to bounded close-up tiles with explicit partial coverage',async()=>{
 const result=await captureRouteImagery({...request,destination:request.start},async(url,options)=>{
  assert.equal(options.redirect,'manual');
  if(url.includes('/MapServer/tile/')){assert.match(url,/^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/19\/\d+\/\d+$/);return new Response(jpegHeader(256,256),{headers:{'Content-Type':'image/jpeg'}});}
  if(url.includes('World_Imagery/'))return Response.json({...meta(),width:0,height:0});
  return url.includes('/export?')?Response.json(meta()):jpeg();
 });
 assert.equal(result.frames.filter(f=>f.zoom===19).length,4);assert.ok(result.frames.filter(f=>f.zoom===19).every(f=>f.width===256&&f.bounds.east>f.bounds.west));assert.ok(result.warnings.some(w=>w.includes('partial coverage')));
});
test('native tile footprints are limited to two neighboring cells around a close-up',()=>{
 const view=imageryViews(request).find(v=>v.id==='start-detail-satellite'),tiles=satelliteTileViews(view);assert.equal(tiles.length,2);assert.ok(tiles.every(t=>t.zoom===19&&t.bounds.north>t.bounds.south));assert.ok(Math.abs(tiles[0].tile.x-tiles[1].tile.x)+Math.abs(tiles[0].tile.y-tiles[1].tile.y)===1);
});
