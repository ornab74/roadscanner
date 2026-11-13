import test from 'node:test';
import assert from 'node:assert/strict';
import {alignmentFailure} from '../cloudflare/alignment-failure.mjs';
import {importRoads} from '../cloudflare/road-geometry.mjs';
test('network exceptions at the road source become retryable fixed codes without leaking request details',async()=>{
 await assert.rejects(importRoads({},async()=>{throw new TypeError('PRIVATE_NETWORK_DETAILS');}),error=>error.message==='Road source unavailable'&&alignmentFailure(error).retryable);
});
test('road errors distinguish unsupported corridor, section limits, endpoint offsets and data outages',()=>{
 assert.equal(alignmentFailure(Error('Too many mapped street sections')).code,'section_limit');
 assert.equal(alignmentFailure(Error('Mapped names do not support the LLM corridor')).code,'corridor_mismatch');
 assert.equal(alignmentFailure(Error('Endpoint is too far from a mapped public road')).code,'endpoint_distance');
 assert.equal(alignmentFailure(Error('Road tile unavailable')).retryable,true);
 assert.equal(alignmentFailure(Error('Mapped roads do not connect this proposal')).retryable,false);
 assert.equal(alignmentFailure(Object.assign(Error('private'),{name:'TimeoutError'})).code,'source_timeout');
});
test('alignment diagnostics never expose unknown exception text or prototype properties',()=>{
 for(const message of ['PRIVATE_ADDRESS_SENTINEL','toString','__proto__','constructor']){
  const failure=alignmentFailure(Error(message));assert.equal(failure.code,'alignment_unavailable');assert.equal(failure.retryable,false);assert.ok(!JSON.stringify(failure).includes(message));
 }
});
