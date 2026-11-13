import test from 'node:test';
import assert from 'node:assert/strict';
import {routeMetrics,truckTurnReviews} from '../cloudflare/route-options.mjs';
import {comparisonEntries} from '../cloudflare/public/pages/route-comparison.mjs';
import {validateVehicle} from '../cloudflare/vehicle-profile.mjs';
const sections=[{id:0,street:'First',road_class:'primary',distance_m:1609.344,risk_score:20,geometry:{coordinates:[[0,0],[.01,0]]}},{id:1,street:'Second',road_class:'minor',distance_m:500,risk_score:60,geometry:{coordinates:[[.01,0],[.01,.01]]}}];
test('comparison metrics expose assumptions, weighted caution and optional user-MPG fuel scenarios',()=>{
 const noMPG=routeMetrics(sections);assert.equal(noMPG.maneuvers,1);assert.equal(noMPG.fuel_gallons,null);assert.equal(noMPG.caution_coverage,1);assert.equal(noMPG.modeled_caution,29);assert.equal(noMPG.assumptions.traffic_available,false);
 const supplied=routeMetrics(sections,{specs:{fuel_economy_mpg:20}});assert.ok(supplied.fuel_gallons>0);assert.equal(supplied.input_mpg,20);assert.ok(supplied.effective_mpg>0);
 const unknown=routeMetrics(sections.map(s=>({...s,risk_score:null})));assert.equal(unknown.modeled_caution,null);assert.equal(unknown.caution_coverage,0);
 assert.equal(routeMetrics(sections,null,'walking').fuel_proxy,null);
});
test('duplicate paths are merged and incomplete caution evidence does not win the lowest-caution ranking',()=>{
 const one={report_id:1,status:'proposal',geometry_alignment:{status:'matched'},segments:sections,objective:'fastest',route_metrics:routeMetrics(sections)};
 const two={...one,report_id:2,objective:'fuel'};
 const other={...one,report_id:3,objective:'caution',segments:sections.map(s=>({...s,geometry:{coordinates:s.geometry.coordinates.map(([x,y])=>[x+.1,y])}})),route_metrics:{...one.route_metrics,modeled_caution:null,caution_coverage:0}};
 const entries=comparisonEntries([one,two,other]);assert.equal(entries.length,2);assert.deepEqual(entries[0].objectives,['fastest','fuel']);assert.ok(entries[0].wins.includes('caution'));assert.ok(!entries[1].wins.includes('caution'));
});
test('truck review checks every section, requires explicit geometry specs and never approves a turn',()=>{
 const partial=truckTurnReviews(sections,{kind:'truck',specs:{configuration:'articulated',length_m:22}});assert.equal(partial.sections.length,2);assert.equal(partial.turn_count,1);assert.ok(partial.missing_profile_fields.includes('wheelbase_m'));assert.equal(partial.circular_scenario,null);assert.ok(partial.sections.every(s=>s.clearance_verified===false&&s.curb_radius_m===null));
 const profile=validateVehicle({name:'Test combination',kind:'truck',specs:{configuration:'articulated',height_m:4,width_m:2.5,length_m:22,mass_kg:35000,axles:5,hazmat:false,wheelbase_m:6,turn_radius_m:18,trailer_length_m:16,kingpin_to_axle_m:12,fifth_wheel_offset_m:0,fuel_economy_mpg:7}});
 const full=truckTurnReviews(sections,profile);assert.equal(full.circular_scenario.status,'scenario_only');assert.ok(Math.abs(full.circular_scenario.axle_offtracking_m-6)<1e-9);assert.ok(full.sections.every(s=>s.restriction_status==='UNKNOWN'));
 const tight=truckTurnReviews(sections,{...profile,specs:{...profile.specs,turn_radius_m:5}});assert.equal(tight.circular_scenario.status,'outside_model');
 assert.equal(truckTurnReviews(sections,{kind:'car'}),null);
 for(const specs of [{fuel_economy_mpg:0},{wheelbase_m:-3},{fifth_wheel_offset_m:10}])assert.throws(()=>validateVehicle({name:'Bad',kind:'truck',specs}));
});
