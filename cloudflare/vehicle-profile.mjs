import {decryptReport} from './security.mjs';
import {VEHICLE_FIELDS} from './public/pages/vehicle-guidance.mjs';
export const KINDS=['car','motorcycle','truck','train','aircraft'];
export const THEMES=['none','winter','halloween','autumn','festive','lunar_new_year'];
const fail=m=>{throw Object.assign(new Error(m),{status:400});};
function text(v,max=60){if(typeof v!=='string'||v.length>max||/[\x00-\x1f\x7f]/.test(v))fail('invalid_vehicle_field');return v.trim();}
const ranges={height_m:[.2,12],width_m:[.2,12],length_m:[.5,5000],trailer_length_m:[.5,100],rotor_diameter_m:[1,50],mass_kg:[1,10000000],axles:[1,1000],rail_gauge_mm:[300,2500],engine_cc:[1,10000],true_airspeed_kt:[25,700],fuel_burn_per_hour:[.1,100000],fuel_capacity:[.1,1000000],reserve_minutes:[0,240]};
const fields=Object.fromEntries(Object.entries(VEHICLE_FIELDS).map(([k,list])=>[k,list.map(f=>f[0])]));
export function validateVehicle(v){
 if(!v||Array.isArray(v)||Object.keys(v).some(k=>!['name','kind','make','model','year','color','theme','appearance_notes','specs'].includes(k))||!KINDS.includes(v.kind)||!THEMES.includes(v.theme??'none'))fail('invalid_vehicle');
 const name=text(v.name);if(!name)fail('vehicle_name_required');const year=v.year??null;if(year!==null&&(!Number.isInteger(year)||year<1880||year>new Date().getUTCFullYear()+2))fail('invalid_vehicle_year');
 const specs=v.specs??{};if(!specs||Array.isArray(specs)||typeof specs!=='object'||Object.keys(specs).some(k=>!fields[v.kind].includes(k)))fail('invalid_vehicle_specs');const normalized={};
 for(const [key,value] of Object.entries(specs)){
  if(value===null||value==='')continue;
  if(ranges[key]){const [lo,hi]=ranges[key];if(typeof value!=='number'||!Number.isFinite(value)||value<lo||value>hi||['axles'].includes(key)&&!Number.isInteger(value))fail('invalid_vehicle_'+key);normalized[key]=value;}
  else if(['hazmat','towing','abs'].includes(key)){if(typeof value!=='boolean')fail('invalid_vehicle_'+key);normalized[key]=value;}
  else if(key==='configuration'){if(!['rigid','articulated'].includes(value))fail('invalid_truck_configuration');normalized[key]=value;}
  else if(key==='airframe'){if(!['fixed_wing','helicopter'].includes(value))fail('invalid_aircraft_category');normalized[key]=value;}
  else if(key==='fuel_unit'){if(!['gal','l','kg'].includes(value))fail('invalid_fuel_unit');normalized[key]=value;}
  else if(key==='traction'){if(!['diesel','electric','steam','hybrid'].includes(value))fail('invalid_train_traction');normalized[key]=value;}
  else if(key==='icao24'){if(typeof value!=='string'||!/^[a-f0-9]{6}$/i.test(value))fail('invalid_aircraft_icao24');normalized[key]=value.toLowerCase();}
  else if(key==='type_designator'){if(typeof value!=='string'||!/^[A-Z0-9]{2,4}$/.test(value))fail('invalid_aircraft_type');normalized[key]=value;}
 }
 return {name,kind:v.kind,make:text(v.make??''),model:text(v.model??''),year,color:text(v.color??'',40),theme:v.theme??'none',appearance_notes:text(v.appearance_notes??'',400),specs:normalized};
}
export async function vehicleFor(env,owner,id){
 const row=await env.DB.prepare('SELECT *, (SELECT expires_at FROM garage_images WHERE id=garage_vehicles.image_id) AS image_expires_at FROM garage_vehicles WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(id,owner).first();if(!row)throw Object.assign(new Error('vehicle_not_found'),{status:404});
 const profile=validateVehicle(await decryptReport(env.QRS_REPORT_KEY,owner,'vehicle:'+id,row.profile));return {...profile,id:row.id,version:row.version,image_url:row.image_id&&row.image_expires_at>Math.floor(Date.now()/1000)?'/api/garage/vehicles/'+row.id+'/image?v='+row.version:null,created_at:row.created_at,updated_at:row.updated_at};
}
export function guidanceScope(vehicle){const scopes={car:'Road-scene and weather review; access and legal turns remain unverified.',motorcycle:'Two-wheel exposure: crosswind, precipitation, visibility, temperature and surface uncertainty. Do not assume grip or recommend lean angle/speed.',truck:'Heavy vehicle: compare supplied height/width/length/mass/axles/hazmat with verified posted restrictions. Bridge capacity, clearance, hazmat permissions and turning envelope are UNKNOWN without official data. Never certify truck clearance.',train:'Rail advisory only: dispatch authority, signals, switches, track possession, loading gauge, axle load, electrification and braking rules require official railway data. No road navigation or movement authority.',aircraft:'Aviation briefing only. No ATC clearance, separation service, terrain/airspace approval, go/no-go decision or maneuver command. Official aviation sources and pilot/dispatcher/ATC decisions remain required.'};return scopes[vehicle.kind];}
