import {meters,tilesForRoute} from './road-geometry.mjs';
import {routeObjectives} from './route-options.mjs';
const fail=code=>{throw Object.assign(new Error(code),{status:400});};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function point(p){if(!object(p)||Object.keys(p).sort().join(',')!=='latitude,longitude'||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||Math.abs(p.latitude)>84.8||Math.abs(p.longitude)>180)fail('invalid_route_coordinates');return {latitude:p.latitude,longitude:p.longitude};}
export function validateEndpointRoute(d){
 if(!object(d)||Object.keys(d).some(k=>!['start','destination','mode','objective','notes','vehicle_id'].includes(k)))fail('invalid_route_request');
 const start=point(d.start),destination=point(d.destination),mode=d.mode===undefined?'driving':d.mode,objective=d.objective===undefined?'balanced':d.objective,notes=d.notes===undefined?'':d.notes;
 if(!['driving','walking'].includes(mode)||typeof objective!=='string'||!Object.hasOwn(routeObjectives,objective)||typeof notes!=='string'||notes.length>1200||d.vehicle_id!==undefined&&(typeof d.vehicle_id!=='string'||!/^[a-f0-9-]{36}$/.test(d.vehicle_id)))fail('invalid_route_request');
 const distance=meters([start.longitude,start.latitude],[destination.longitude,destination.latitude]);if(distance<1)fail('endpoints_too_close');if(distance>90000)fail('route_distance_limit');
 if(Math.abs(start.longitude-destination.longitude)>180)fail('route_area_limit');
 try{tilesForRoute({start,destination,mode});}catch{fail('route_area_limit');}
 return {start,destination,mode,objective,notes,vehicle_id:d.vehicle_id??null,context_images:[],map:null,server_overview:true};
}
export function endpointOverview(r){
 const lat=(r.start.latitude+r.destination.latitude)/2,dy=Math.max(.002,Math.abs(r.start.latitude-r.destination.latitude)*.15),dx=Math.max(.002/Math.max(.1,Math.cos(lat*Math.PI/180)),Math.abs(r.start.longitude-r.destination.longitude)*.15);
 return {id:'server-overview',role:'PRIMARY automatic labeled overview of the selected endpoints; geographic bounds define route pixels',kind:'street',bounds:{south:Math.max(-85,Math.min(r.start.latitude,r.destination.latitude)-dy),north:Math.min(85,Math.max(r.start.latitude,r.destination.latitude)+dy),west:Math.max(-180,Math.min(r.start.longitude,r.destination.longitude)-dx),east:Math.min(180,Math.max(r.start.longitude,r.destination.longitude)+dx)}};
}
export function endpointRouteProducts(result,request){
 const accepted=result.status==='proposal'&&result.geometry_alignment?.status==='matched',segments=accepted?result.segments:[],features=[],steps=[];let total=0,scored=0,weighted=0,peak=null,baseline=0;
 for(const [i,s] of segments.entries()){
  const coords=s.geometry.coordinates;let length=0;for(let j=1;j<coords.length;j++)length+=meters(coords[j-1],coords[j]);total+=length;
  const score=Number.isInteger(s.risk_score)&&s.risk_score>=0&&s.risk_score<=100?s.risk_score:null;if(score!==null){scored+=length;weighted+=score*length;peak=peak===null?score:Math.max(peak,score);}if(s.score_basis==='illustrative_baseline')baseline+=length;
  const props={section_id:s.id,street:s.street,instruction:s.instruction,distance_m:Math.round(length),risk_score:score,score_basis:s.score_basis??'unknown',risk_reason:s.risk_reason,name_provenance:s.name_provenance??'UNKNOWN',geometry_provenance:s.geometry_provenance??'UNKNOWN'};
  features.push({type:'Feature',id:s.id,geometry:s.geometry,properties:props});steps.push({index:i+1,...props});
 }
 const endpoint=(kind,p,section)=>({coordinates:p,mapped_offset_m:result.geometry_alignment?.[kind==='start'?'start_offset_m':'destination_offset_m']??null,adjacent_section_id:section?.id??null,adjacent_section_risk_score:accepted&&Number.isInteger(section?.risk_score)?section.risk_score:null,access_verified:false,imagery_ids:(result.imagery_manifest??[]).filter(f=>f.id?.startsWith(kind+'-')).map(f=>f.id)});
 return {route_geojson:{type:'FeatureCollection',features},steps,risk_summary:{unit:'modeled_caution_index_0_100',probability:false,distance_weighted_score:scored?Math.round(weighted/scored):null,peak_score:peak,scored_distance_fraction:total?Math.round(scored/total*1000)/1000:0,illustrative_baseline_distance_fraction:total?Math.round(baseline/total*1000)/1000:0,section_count:segments.length,unknown_section_count:steps.filter(s=>s.risk_score===null).length,live_traffic_available:false},endpoint_inspections:{start:endpoint('start',request.start,segments[0]),destination:endpoint('destination',request.destination,segments.at(-1)),guidance:result.endpoint_guidance??[]},navigation_verified:false};
}
