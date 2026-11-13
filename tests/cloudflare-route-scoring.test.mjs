import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreComponents} from '../cloudflare/route-scoring.mjs';
test('section rubric separates straight benign travel from demanding geometry and weather without route normalization',()=>{
 const benign={geometry:5,maneuver:5,weather:10,vehicle:10,uncertainty:30};
 const demanding={geometry:75,maneuver:70,weather:65,vehicle:80,uncertainty:60};
 assert.equal(scoreComponents(benign),10);
 assert.equal(scoreComponents(demanding),71);
 assert.equal(scoreComponents({...benign,maneuver:85}),30);
 assert.equal(scoreComponents(benign),10);
});
test('scoring rejects missing, extra, noninteger and out-of-range components',()=>{
 for(const c of [null,{}, {geometry:1,maneuver:2,weather:3,vehicle:4,uncertainty:101},{geometry:1,maneuver:2,weather:3,vehicle:4,uncertainty:.5},{geometry:1,maneuver:2,weather:3,vehicle:4,uncertainty:5,random:60}])assert.throws(()=>scoreComponents(c),/Invalid mapped score components/);
});
