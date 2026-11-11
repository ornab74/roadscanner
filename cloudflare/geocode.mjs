import {readJSON,hmac,encryptReport,decryptReport} from './security.mjs';
import {boundedBody} from './internal-auth.mjs';
const now=()=>Math.floor(Date.now()/1000);
const q=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function upstream(url){const r=await fetch(url,{redirect:'manual',headers:{'User-Agent':'QRoadScan/1.0 https://ride.qroadscan.com','Accept':'application/json'},signal:AbortSignal.timeout(20000)});if(!r.ok)fail('geocoder_unavailable',503);return JSON.parse(new TextDecoder().decode(await boundedBody(r.body,262144)));}
export function cleanAddress(value){return value.replace(/\b(?:apt|apartment|unit|suite|ste)\.?\s*#?\s*[a-z0-9-]+\b|#\s*[a-z0-9-]+/gi,'').replace(/\s*,\s*,/g,',').replace(/\s+/g,' ').trim().replace(/,\s*$/,'');}
export function osmPlaces(result,unitRemoved=false){return (Array.isArray(result)?result:[]).slice(0,5).filter(x=>Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lon))&&Math.abs(Number(x.lat))<=90&&Math.abs(Number(x.lon))<=180&&typeof x.display_name==='string').map(x=>({latitude:Number(x.lat),longitude:Number(x.lon),label:x.display_name.slice(0,350),source:'OpenStreetMap',house_number:typeof x.address?.house_number==='string'?x.address.house_number.slice(0,32):null,precision:x.address?.house_number?'mapped_address':x.class==='highway'||['road','residential','street'].includes(x.addresstype)?'street':'area',accuracy_label:x.address?.house_number?'Mapped address · confirm entrance':x.class==='highway'||['road','residential','street'].includes(x.addresstype)?'Street match · house position unknown':'Area/place match · confirm position',unit_removed:unitRemoved}));}
export function censusPlaces(result,unitRemoved=false){return (result?.result?.addressMatches??[]).slice(0,5).filter(x=>typeof x.matchedAddress==='string'&&Number.isFinite(x.coordinates?.x)&&Number.isFinite(x.coordinates?.y)&&Math.abs(x.coordinates.x)<=180&&Math.abs(x.coordinates.y)<=90).map(x=>({latitude:x.coordinates.y,longitude:x.coordinates.x,label:x.matchedAddress.slice(0,350),source:'US Census Geocoder',precision:'interpolated_address',accuracy_label:'Approximate address · US Census street interpolation',unit_removed:unitRemoved}));}
async function osmSlot(env){const slot=await q(env,`INSERT INTO geocode_cache(key,payload,expires_at) VALUES ('upstream-slot','',?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at WHERE geocode_cache.expires_at<=? RETURNING key`,now()+2,now()).first();return !!slot;}
function osmURL(query){const url=new URL('https://nominatim.openstreetmap.org/search');url.searchParams.set('q',query);url.searchParams.set('format','jsonv2');url.searchParams.set('limit','5');url.searchParams.set('addressdetails','1');return url.toString();}
export async function geocode(request,env,p){
 const body=await readJSON(request,1024);if(Object.keys(body??{}).join(',')!=='query'||typeof body.query!=='string'||body.query.trim().length<3||body.query.length>200)fail('invalid_place_query');
 const query=cleanAddress(body.query.trim()),unitRemoved=/\b(?:apt|apartment|unit|suite|ste)\.?\s*#?\s*[a-z0-9-]+\b|#\s*[a-z0-9-]+/i.test(body.query);if(query.length<3)fail('invalid_place_query');
 const key=await hmac(env.QRS_API_KEY_PEPPER,'place-v2:'+query.toLowerCase()+':'+unitRemoved);
 const existing=await q(env,'SELECT payload FROM geocode_cache WHERE key=? AND expires_at>?',key,now()).first();if(existing)return json(await decryptReport(env.QRS_REPORT_KEY,'geocode',key,existing.payload));
 if(!await osmSlot(env))fail('geocoder_busy',429);
 let osm=[],census=[],providersWorked=0;
 try{osm=osmPlaces(await upstream(osmURL(query)),unitRemoved);providersWorked++;}catch{/* Try an independent provider; do not log residential queries. */}
 const houseNumber=/^\s*(\d+[a-z]?(?:-\d+)?)\s+/i.exec(query)?.[1]?.toLowerCase();
 const houseRequested=!!houseNumber;
 if(houseRequested)osm=osm.filter(p=>p.precision!=='mapped_address'||p.house_number?.replace(/\s/g,'').toLowerCase()===houseNumber);
 const looksUS=/\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)(?:\s+\d{5}(?:-\d{4})?)?(?:,?\s+USA)?\s*$/i.test(query);
 if(!osm.length||(houseRequested&&(!osm.some(p=>p.precision==='mapped_address')||looksUS))){
  const url=new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');url.searchParams.set('address',query);url.searchParams.set('benchmark','Public_AR_Current');url.searchParams.set('format','json');
  try{census=censusPlaces(await upstream(url.toString()),unitRemoved);providersWorked++;}catch{/* Retain any usable OpenStreetMap result. */}
 }
 let places=[...osm.filter(p=>p.precision==='mapped_address'),...census,...osm.filter(p=>p.precision!=='mapped_address')].slice(0,7);
 if(!places.length&&houseRequested){
  // A last-resort street result is explicitly approximate, never a guessed house.
  await new Promise(resolve=>setTimeout(resolve,2100));
  if(await osmSlot(env)){try{places=osmPlaces(await upstream(osmURL(query.replace(/^\s*\d+[a-z]?(?:-\d+)?\s+/i,''))),unitRemoved).map(p=>({...p,precision:'street',accuracy_label:'Street only · exact house not found'}));providersWorked++;}catch{}}
 }
 if(!providersWorked)fail('geocoder_unavailable',503);
 await q(env,'INSERT INTO geocode_cache(key,payload,expires_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at',key,await encryptReport(env.QRS_REPORT_KEY,'geocode',key,places),now()+(places.length?86400:300)).run();return json(places);
}
