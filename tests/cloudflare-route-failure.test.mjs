import test from 'node:test';
import assert from 'node:assert/strict';
import {routeFailure} from '../cloudflare/route-failure.mjs';

test('route diagnostics distinguish truncation, storage and timeout without disclosing provider content',()=>{
 assert.deepEqual(routeFailure(Object.assign(new Error('Mapped directions did not complete'),{route_stage:'mapped_review',incomplete_reason:'max_output_tokens'}),'operation'),{operation_id:'operation',stage:'mapped_review',reason:'output_limit'});
 assert.equal(routeFailure(new Error('Report too large'),'operation').reason,'report_size_limit');
 assert.equal(routeFailure(Object.assign(new Error('private address and provider response'),{name:'TimeoutError',route_stage:'visual_model'}),'operation').reason,'timeout');
 const failure=routeFailure(Object.assign(new Error('PRIVATE_SENTINEL'),{route_stage:'PRIVATE_SENTINEL'}),'operation');
 assert.equal(failure.stage,'report_storage');
 assert.equal(JSON.stringify(failure).includes('PRIVATE_SENTINEL'),false);
});
