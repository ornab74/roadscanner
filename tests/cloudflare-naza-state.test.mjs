import test from 'node:test';
import assert from 'node:assert/strict';
import {nazaState,stateReceipt} from '../cloudflare/public/pages/naza-state.mjs';
test('NAZA circuit preserves normalization and its zero-input baseline',()=>{const q=nazaState([0,0,0]);assert.equal(q.provenance,'SIMULATED');assert.equal(q.analytic.ev0,1);assert.equal(q.analytic.ev1,1);assert.ok(Math.abs(q.analytic.entropic_score-1/(1+Math.exp(-3)))<1e-12);assert.ok(q.analytic.entanglement_bits<1e-10);});
test('entangled circuit has mixed reduced state and deterministic simulated shots',async()=>{const a=nazaState([.5,0,0],{seed:42,shots:256}),b=nazaState([.5,0,0],{seed:42,shots:256});assert.ok(Math.abs(a.analytic.entanglement_bits-1)<1e-10);assert.ok(Math.abs(a.analytic.reduced_purity-.5)<1e-10);assert.deepEqual(a.sampled,b.sampled);assert.equal(a.sampled.counts.reduce((x,y)=>x+y),256);assert.equal(await stateReceipt(a),await stateReceipt(b));});
test('state validation fails closed and simulation does not mutate its inputs',()=>{const v=[.2,.3,.4],copy=[...v];nazaState(v);assert.deepEqual(v,copy);assert.throws(()=>nazaState([NaN,0,0]),/inputs/);assert.throws(()=>nazaState(v,{shots:1000000}),/shot/);});
