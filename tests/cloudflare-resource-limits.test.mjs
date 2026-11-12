import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/account-worker.mjs';

test('database insert boundaries enforce per-account resource quotas and release capacity correctly',async()=>{
 const f=await fixture();try{
  const now=Math.floor(Date.now()/1000);
  const vehicle=id=>f.DB.prepare('INSERT INTO garage_vehicles(id,user_id,kind,profile,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(id,'owner','car','fixture-profile',now,now);
  await f.DB.batch(Array.from({length:20},(_,i)=>vehicle('vehicle-'+i)));
  await assert.rejects(vehicle('overflow').run(),/garage_full/);
  await f.DB.prepare('UPDATE garage_vehicles SET deleted_at=? WHERE id=?').bind(now,'vehicle-0').run();await vehicle('replacement').run();
  await f.DB.prepare('INSERT INTO garage_vehicles(id,user_id,kind,profile,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind('other-vehicle','other','car','fixture',now,now).run();
  const key=(id,expiry=null)=>f.DB.prepare('INSERT INTO api_keys(id,user_id,key_hash,created_at,expires_at) VALUES (?,?,?,?,?)').bind(id,'owner','hash-'+id,now,expiry);
  await f.DB.batch(Array.from({length:19},(_,i)=>key('key-'+i)));
  await assert.rejects(key('overflow-key').run(),/api_key_limit/);
  await key('web:fixture').run();await key('expired-key',1).run();
  await f.DB.prepare('UPDATE api_keys SET revoked_at=? WHERE id=?').bind(now,'key-0').run();await key('replacement-key').run();
  const passkey=id=>f.DB.prepare('INSERT INTO security_keys VALUES (?,?,?,?,?,?,?,?,?)').bind(id,'owner','Test','public',0,'[]',0,now,null);
  await f.DB.batch(Array.from({length:10},(_,i)=>passkey('passkey-'+i)));
  await assert.rejects(passkey('overflow-passkey').run(),/security_key_limit/);
  await f.DB.prepare('DELETE FROM security_keys WHERE id=?').bind('passkey-0').run();await passkey('replacement-passkey').run();
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM garage_vehicles WHERE user_id='owner' AND deleted_at IS NULL").first()).n,20);
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM security_keys WHERE user_id='owner'").first()).n,10);
 }finally{f.close();}
});

test('a stale garage count cannot bypass the database cap and returns the public quota error',async()=>{
 const f=await fixture();try{
  const now=Math.floor(Date.now()/1000);
  await f.DB.batch(Array.from({length:20},(_,i)=>f.DB.prepare('INSERT INTO garage_vehicles(id,user_id,kind,profile,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind('vehicle-'+i,'owner','car','fixture',now,now)));
  const original=f.DB.prepare.bind(f.DB);
  f.DB.prepare=sql=>{const s=original(sql);if(sql.startsWith('SELECT COUNT(*) AS n FROM garage_vehicles'))s.first=async()=>({n:19});return s;};
  const r=await f.request('/api/v1/garage/vehicles',{method:'POST',headers:{Authorization:'Bearer '+f.key,'Content-Type':'application/json'},body:JSON.stringify({name:'Overflow attempt',kind:'car'})});
  assert.equal(r.status,409);assert.equal((await r.json()).code,'garage_full');
  assert.equal((await original("SELECT COUNT(*) AS n FROM garage_vehicles WHERE user_id='owner'").first()).n,20);
 }finally{f.close();}
});
