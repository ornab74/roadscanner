import test from 'node:test';
import assert from 'node:assert/strict';
import {strictJSON,validateScan,passwordHash,sameSecret,encryptReport,decryptReport} from '../cloudflare/security.mjs';
test('strict JSON rejects nested duplicate keys, malformed tokens and excessive depth',()=>{
 assert.deepEqual(strictJSON('{"x":[true,null,{"a":1}]}'),{x:[true,null,{a:1}]});
 for(const text of ['{"x":1,"x":2}','{"a":{"x":1,"x":2}}','[1,]','{"x":1e999}','[NaN]','{','[] x','['.repeat(20)+']'.repeat(20)])assert.throws(()=>strictJSON(text));
 assert.deepEqual(strictJSON('{"\\u0061":1,"b":"escaped \\\" string"}'),{a:1,b:'escaped " string'});
 assert.throws(()=>strictJSON('{"a":1,"\\u0061":2}'));
});
test('scan validation keeps weather context and rejects invalid coordinates and fields',()=>{
 const input={latitude:40.7,longitude:-74,vehicle_type:'car',destination:'Midtown',weather:'rain',traffic:'heavy'};
 assert.equal(validateScan(input).weather,'rain');
 for(const invalid of [{...input,latitude:91},{...input,longitude:NaN},{...input,latitude:true},{...input,latitude:'40.7'},{...input,weather:'x'.repeat(97)},{...input,unexpected:true},{...input,model:'llama_local',model_selection:'openai'}])assert.throws(()=>validateScan(invalid));
});
test('password hashes are salted and comparisons reject incorrect passwords',async()=>{
 const a=await passwordHash('a-long-test-password','11'.repeat(16));
 assert.notEqual(a,await passwordHash('a-long-test-password','22'.repeat(16)));
 assert.equal(await sameSecret(a,await passwordHash('a-long-test-password','11'.repeat(16))),true);
 assert.equal(await sameSecret(a,await passwordHash('a-wrong-test-password','11'.repeat(16))),false);
 await assert.rejects(passwordHash('short','11'.repeat(16)));
});
test('R2 report encryption binds both owner and report identity and detects tampering',async()=>{
 const key='ab'.repeat(32),data={result:'private report',harm_level:'High'};
 const encoded=await encryptReport(key,'owner','report-1',data);
 assert.ok(!encoded.includes('private report'));
 assert.deepEqual(await decryptReport(key,'owner','report-1',encoded),data);
 await assert.rejects(decryptReport(key,'other-owner','report-1',encoded));
 await assert.rejects(decryptReport(key,'owner','report-2',encoded));
 const value=JSON.parse(encoded);value.ct=(value.ct[0]==='0'?'1':'0')+value.ct.slice(1);
 await assert.rejects(decryptReport(key,'owner','report-1',JSON.stringify(value)));
});
