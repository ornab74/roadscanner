import test from 'node:test';
import assert from 'node:assert/strict';
import {constrainImage} from '../cloudflare/image-constraints.mjs';
import {pngHeader,jpegHeader} from './fixtures/image-headers.mjs';
test('images enforce declared format and map pixel dimensions before provider calls',()=>{
 assert.deepEqual(constrainImage(pngHeader(),{format:'png',width:800,height:600}),{format:'png',width:800,height:600});assert.equal(constrainImage(jpegHeader()).width,1000);
 assert.throws(()=>constrainImage(pngHeader(),{format:'jpeg'}),/type/);assert.throws(()=>constrainImage(pngHeader(),{width:900,height:600}),/match/);
});
test('oversized or malformed image headers are rejected without decoding pixels',()=>{
 assert.throws(()=>constrainImage(pngHeader(50000,50000)),/limits/);assert.throws(()=>constrainImage(jpegHeader(16000,16000)),/limits/);assert.throws(()=>constrainImage(Buffer.alloc(48)),/header/);
});
