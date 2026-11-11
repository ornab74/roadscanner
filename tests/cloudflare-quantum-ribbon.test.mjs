import test from 'node:test';
import assert from 'node:assert/strict';
import {ribbonInputs} from '../cloudflare/public/pages/quantum-ribbon.mjs';
test('simulated display inputs preserve risk scores and mapped coordinates',()=>{
 const report={segments:[{risk_score:25,geometry:{coordinates:[[1,2],[3,4]]}}],weather:[{estimate:{precipitation_mm:4}}]};
 const before=JSON.stringify(report);
 assert.deepEqual(ribbonInputs(report,8),{rgb:[.25,.5,.1],provenance:['DERIVED','IMPORTED','MEASURED']});
 assert.notDeepEqual(ribbonInputs(report,8),ribbonInputs(report,60));
 assert.equal(JSON.stringify(report),before);
 assert.equal(ribbonInputs({}).provenance[2],'UNKNOWN');
});
