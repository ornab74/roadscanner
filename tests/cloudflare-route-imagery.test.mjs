import {jpegHeader} from './fixtures/image-headers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {imageryViews,fetchImagery,captureRouteImagery} from '../cloudflare/route-imagery.mjs';
const request={start:{latitude:34.83,longitude:-82.6},destination:{latitude:34.85,longitude:-82.3},mode:'driving'};
const href='https://server.arcgisonline.com/arcgis/rest/directories/arcgisoutput/test.jpg';
const meta=()=>({href,width:1000,height:750,extent:{xmin:-9193999,ymin:4136735,xmax:-9188188,ymax:4140802}});
const jpeg=()=>new Response(jpegHeader(),{headers:{'Content-Type':'image/jpeg'}});
test('automatic atlas includes both endpoints in street and aerial views plus overlapping corridor panels',()=>{
 const v=imageryViews(request);assert.equal(v.length,8);for(const id of ['start-streets','start-satellite','destination-streets','destination-satellite'])assert.ok(v.some(f=>f.id===id));assert.ok(v.every(f=>f.bounds.west<f.bounds.east&&f.bounds.south<f.bounds.north));
 const close=imageryViews({...request,destination:{latitude:34.831,longitude:-82.601}});assert.equal(close.length,4);
});
test('imagery uses actual export extents and rejects arbitrary download origins',async()=>{
 const f=await fetchImagery(imageryViews(request)[0],async (url,options)=>{assert.equal(options.redirect,'manual');return url.includes('/export?')?Response.json(meta()):jpeg();});assert.ok(f.image.startsWith('data:image/jpeg;base64,'));assert.ok(f.bounds.north>f.bounds.south);assert.equal(f.imagery_date,'unknown');assert.equal(f.preview_url,href);
 await assert.rejects(fetchImagery(imageryViews(request)[0],async()=>Response.json({...meta(),href:'https://evil.example/image.jpg'})),/origin/);
});
test('automatic capture retains explicit missing-image warnings instead of fabricated frames',async()=>{
 const result=await captureRouteImagery(request,async (url,options)=>{assert.equal(options.redirect,'manual');return url.includes('/export?')?Response.json(meta()):jpeg();});assert.equal(result.frames.length,8);assert.equal(result.warnings.length,0);
 const failed=await captureRouteImagery(request,async()=>new Response('',{status:503}));assert.equal(failed.frames.length,0);assert.equal(failed.warnings.length,8);
});

test('imagery redirects are not followed',async()=>{await assert.rejects(fetchImagery(imageryViews(request)[0],async()=>new Response(null,{status:302,headers:{Location:'https://evil.example/'}})),/HTTP 302/);});
