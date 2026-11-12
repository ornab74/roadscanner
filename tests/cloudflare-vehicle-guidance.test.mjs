import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVehicle} from '../cloudflare/vehicle-profile.mjs';
import {vehicleNavigationContext} from '../cloudflare/public/pages/vehicle-guidance.mjs';
import {markerSVG} from '../cloudflare/public/pages/vehicle-marker.mjs';
import {aviationAI,fuelWindEstimate} from '../cloudflare/aviation.mjs';
import {analyzeVisualRoute} from '../cloudflare/visual-route.mjs';
import {pngHeader,imageryResponse} from './fixtures/image-headers.mjs';
import {fixture} from './fixtures/account-worker.mjs';

test('changing aircraft category invalidates a portrait from the previous category and guidance API exposes the new profile',async()=>{
 const f=await fixture();try{
  const headers={Authorization:'Bearer '+f.key,'Content-Type':'application/json'};
  const saved=await f.request('/api/v1/garage/vehicles',{method:'POST',headers,body:JSON.stringify({name:'Aircraft',kind:'aircraft',specs:{airframe:'fixed_wing'}})});assert.equal(saved.status,201);const v=await saved.json();
  const now=Math.floor(Date.now()/1000);await f.DB.prepare('INSERT INTO garage_images VALUES (?,?,?,?,?)').bind('portrait','owner',v.id,now,now+3600).run();await f.DB.prepare('UPDATE garage_vehicles SET image_id=? WHERE id=?').bind('portrait',v.id).run();
  const changed=await f.request('/api/v1/garage/vehicles/'+v.id,{method:'PUT',headers,body:JSON.stringify({name:'Aircraft',kind:'aircraft',version:v.version,specs:{airframe:'helicopter',rotor_diameter_m:10}})});assert.equal(changed.status,200);assert.equal((await changed.json()).image_url,null);
  const response=await f.request('/api/v1/garage/vehicles/'+v.id+'/guidance',{method:'POST',headers,body:'{}'});assert.equal(response.status,200);assert.equal((await response.json()).navigation_profile.label,'Helicopter');
 }finally{f.close();}
});

test('vehicle variants validate explicit specs without silently assuming missing equipment or dimensions',()=>{
 const truck=validateVehicle({name:'Combination',kind:'truck',specs:{configuration:'articulated',height_m:4,width_m:2.5,length_m:22,trailer_length_m:16,mass_kg:35000,axles:5,hazmat:false}});
 assert.equal(vehicleNavigationContext(truck).label,'Articulated truck / 18-wheeler');assert.deepEqual(vehicleNavigationContext(truck).missing_profile_fields,[]);
 assert.ok(vehicleNavigationContext({kind:'truck',specs:{configuration:'articulated'}}).missing_profile_fields.includes('trailer_length_m'));
 assert.ok(vehicleNavigationContext({kind:'aircraft',specs:{}}).missing_profile_fields.includes('airframe'));
 assert.equal(validateVehicle({name:'Bike',kind:'motorcycle',specs:{abs:false}}).specs.abs,false);
 assert.deepEqual(validateVehicle({name:'Old plane',kind:'aircraft'}).specs,{});
 for(const specs of [{configuration:'helicopter'},{axles:4.5},{trailer_length_m:1000},{hazmat:'no'}])assert.throws(()=>validateVehicle({name:'Bad',kind:'truck',specs}));
 assert.throws(()=>validateVehicle({name:'Bad plane',kind:'aircraft',specs:{airframe:'jetpack'}}));
 assert.throws(()=>validateVehicle({name:'Car',kind:'car',specs:{rotor_diameter_m:10}}));
});

test('helicopter context, map marker and fuel limitations differ from fixed-wing profiles',()=>{
 const helicopter=validateVehicle({name:'Rotorcraft',kind:'aircraft',specs:{airframe:'helicopter',rotor_diameter_m:10,true_airspeed_kt:100,fuel_burn_per_hour:15,fuel_capacity:60,fuel_unit:'gal',reserve_minutes:30}});
 const context=vehicleNavigationContext(helicopter);assert.equal(context.label,'Helicopter');assert.ok(context.focus.some(x=>x.includes('IGE/OGE')));assert.deepEqual(context.missing_profile_fields,[]);
 assert.notEqual(markerSVG(helicopter),markerSVG({...helicopter,specs:{airframe:'fixed_wing'}}));
 const request={start:{latitude:0,longitude:0},destination:{latitude:0,longitude:1},usable_fuel:40};
 const winds=Array.from({length:3},()=>({status:'available',wind_kt:0,wind_from_deg:0}));
 const estimate=fuelWindEstimate(helicopter,request,winds);assert.ok(estimate.assumptions.some(x=>x.includes('Helicopter cruise-only')));assert.ok(estimate.hours>0);
});

test('road model receives structured truck focus and explicit dimensions',async()=>{
 const vehicle=validateVehicle({name:'Trailer',kind:'truck',specs:{configuration:'articulated',trailer_length_m:16}});
 const request={vehicle,mode:'driving',start:{latitude:40.75,longitude:-74},destination:{latitude:40.76,longitude:-73.99},notes:'Deliver to loading entrance.',context_images:[],map:{image:'data:image/png;base64,'+pngHeader().toString('base64'),width:800,height:600,bounds:{north:40.77,south:40.74,east:-73.98,west:-74.01}}};
 let captured;
 const fetcher=async(url,options)=>{
  const imagery=imageryResponse(url);if(imagery)return imagery;
  if(String(url).startsWith('https://api.met.no/'))return new Response('',{status:503});
  captured=JSON.parse(options.body);return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({status:'needs_context',summary:'Need loading-site context.',endpoint_guidance:[],limitations:[],segments:[]})}]}]});
 };
 await analyzeVisualRoute({OPENAI_API_KEY:'fixture'},request,fetcher);
 const facts=JSON.parse(captured.input[0].content[0].text);assert.equal(facts.vehicle_navigation.specifications.trailer_length_m,16);assert.ok(facts.vehicle_navigation.missing_profile_fields.includes('height_m'));assert.ok(captured.instructions.includes('not assumed from the term 18-wheeler'));
});

test('aviation prompt receives helicopter profile and preserves advisory output boundary',async()=>{
 const vehicle={kind:'aircraft',specs:{airframe:'helicopter',rotor_diameter_m:10}};let body;
 await aviationAI({OPENAI_API_KEY:'fixture'},{created_at:1},vehicle,async(_,options)=>{body=JSON.parse(options.body);return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({summary:'Review supplied evidence.',weather_review:[],traffic_review:[],fuel_review:[],verify_before_flight:[]})}]}]});});
 assert.equal(JSON.parse(body.input).navigation_profile.label,'Helicopter');assert.ok(body.instructions.includes('IGE/OGE'));assert.ok(body.instructions.includes('Never issue clearances'));
});
