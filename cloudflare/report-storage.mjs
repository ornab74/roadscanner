// Every application R2 write reserves capacity in a serialized D1 statement.
// Only opaque encrypted payloads pass through here. No object data is logged.
const GUARDED=Symbol('qrs-report-storage-guard');
const MAX_OBJECT_BYTES=8*1024*1024;
const q=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const fail=code=>{throw Object.assign(new Error(code),{status:503});};
export async function reportStorageStatus(env){
 const row=await q(env,'SELECT max_bytes,max_objects,used_bytes,object_count,initialized FROM report_storage_budget WHERE id=1').first();
 if(!row)fail('report_storage_unavailable');
 return {...row,initialized:row.initialized===1,available_bytes:Math.max(0,row.max_bytes-row.used_bytes),scope:'application_report_bucket',cloudflare_invoice_cap:false};
}
export async function ensureReportCapacity(env){
 const s=await reportStorageStatus(env);
 if(!s.initialized)fail('report_storage_unavailable');
 if(s.available_bytes<MAX_OBJECT_BYTES||s.object_count>=s.max_objects)fail('report_storage_full');
}
export function guardedReports(env){
 const bucket=env.REPORTS;if(!bucket||bucket[GUARDED])return bucket;
 return {
  [GUARDED]:true,
  get:(...args)=>bucket.get(...args),
  head:(...args)=>bucket.head(...args),
  async put(key,input,options){
   if(typeof key!=='string'||!key||new TextEncoder().encode(key).length>1024)fail('invalid_storage_key');
   // Streams are deliberately unsupported: the reserved size must be exact.
   let value;
   if(typeof input==='string')value=new TextEncoder().encode(input);
   else if(input instanceof ArrayBuffer)value=new Uint8Array(input.slice(0));
   else if(ArrayBuffer.isView(input))value=new Uint8Array(new Uint8Array(input.buffer,input.byteOffset,input.byteLength));
   else fail('invalid_storage_payload');
   if(value.byteLength>MAX_OBJECT_BYTES)fail('report_object_too_large');
   let allocation;
   try{
    allocation=await q(env,`INSERT INTO report_storage_objects(object_key,byte_length,state,created_at) SELECT ?,?,'reserved',unixepoch() WHERE EXISTS(SELECT 1 FROM report_storage_budget WHERE id=1 AND initialized=1)`,key,value.byteLength).run();
   }catch(e){
    if(String(e).includes('report_storage_full'))fail('report_storage_full');
    if(String(e).includes('UNIQUE'))fail('report_storage_conflict');
    throw e;
   }
   if(allocation.meta.changes<1)fail('report_storage_unavailable');
   // A timeout can occur after R2 accepted the object. Keep its reservation on
   // every failure, rather than release bytes that may already be stored.
   const result=await bucket.put(key,typeof input==='string'?input:value,options);
   if(result===null)fail('report_storage_unavailable');
   await q(env,"UPDATE report_storage_objects SET state='stored' WHERE object_key=? AND state='reserved'",key).run();
   return result;
  },
  async delete(key){
   if(typeof key!=='string')fail('invalid_storage_key');
   const row=await q(env,'SELECT state FROM report_storage_objects WHERE object_key=?',key).first();
   if(!row)fail('untracked_storage_object');
   if(row.state==='reserved')fail('report_storage_write_pending');
   await q(env,"UPDATE report_storage_objects SET state='deleting' WHERE object_key=? AND state='stored'",key).run();
   // Overwrites are forbidden while a key is tracked, so deletion cannot race
   // with a new write to the same key. Retry failed deletes without uncharging.
   await bucket.delete(key);
   await q(env,"DELETE FROM report_storage_objects WHERE object_key=? AND state='deleting'",key).run();
  },
 };
}
