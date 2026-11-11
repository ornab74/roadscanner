import test from 'node:test';
import assert from 'node:assert/strict';
import {distance,prepareRoute,progress,distanceText,timeText} from '../cloudflare/public/pages/route-progress.mjs';
const segments=[{instruction:'Continue east',street:'A',geometry:{coordinates:[[0,0],[.001,0]]}},{instruction:'Turn left and continue north',street:'B',geometry:{coordinates:[[.001,0],[.001,.001]]}}];
test('GPS progress identifies the current section, next turn and distance along the proposal',()=>{
 const route=prepareRoute(segments),p=progress(route,[.0005,0]);assert.equal(p.index,0);assert.match(p.next,/Turn left/);assert.ok(p.beforeTurn>50&&p.beforeTurn<60);assert.ok(p.remaining>160&&p.remaining<170);
 const after=progress(route,[.001,.0005]);assert.equal(after.index,1);assert.equal(after.last,true);assert.ok(after.remaining>50&&after.remaining<60);
});
test('GPS projection exposes off-route fixes and constrains implausible progress jumps',()=>{
 const route=prepareRoute(segments),p=progress(route,[.02,.02]);assert.ok(p.offRoute>1000);const constrained=progress(route,[.001,.001],0,40);assert.equal(constrained,null);assert.ok(distance([0,0],[.001,0])>110);
 assert.match(distanceText(1609.344),/1.0 mi/);assert.match(distanceText(30),/ft/);assert.equal(timeText(90),'2 min');assert.equal(timeText(NaN),'—');
});
