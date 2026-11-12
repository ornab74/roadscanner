import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import worker from '../../cloudflare/worker.mjs';
import {passwordHash,hmac} from '../../cloudflare/security.mjs';
const python=`import json,sys,sqlite3
p=json.load(sys.stdin)
c=sqlite3.connect(p['path']); c.row_factory=sqlite3.Row
with c:
 out=[]
 for item in p['queries']:
  before=c.total_changes
  cursor=c.execute(item['sql'],item.get('args',[]))
  rows=[dict(r) for r in cursor.fetchall()]
  out.append({'results':rows,'meta':{'changes':c.total_changes-before}})
print(json.dumps(out))`;
class Database {
 constructor(path){this.path=path;}
 execute(queries){return JSON.parse(execFileSync(process.env.QRS_TEST_PYTHON||'python3',['-c',python],{input:JSON.stringify({path:this.path,queries}),encoding:'utf8'}));}
 prepare(sql){const db=this;const statement={sql,args:[],bind(...args){return {...this,args};},async first(){return db.execute([this])[0].results[0]??null;},async run(){return db.execute([this])[0];},async all(){return db.execute([this])[0];}};return statement;}
 async batch(statements){return this.execute(statements);}
}
export async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'qrs-worker-test-'));const path=join(directory,'db.sqlite');
 const migrations=new URL('../../cloudflare/migrations/',import.meta.url);
 const schema=readdirSync(migrations).filter(x=>x.endsWith('.sql')).sort().map(x=>readFileSync(new URL(x,migrations),'utf8')).join('\n');
 execFileSync(process.env.QRS_TEST_PYTHON||'python3',['-c','import sqlite3,sys; sqlite3.connect(sys.argv[1]).executescript(sys.stdin.read())',path],{input:schema});
 const DB=new Database(path),objects=new Map();let calls=0,fail=false;
 const env={DB,QRS_API_KEY_PEPPER:'p'.repeat(48),QRS_REPORT_KEY:'ab'.repeat(32),REGISTRATION_ENABLED:'true',
  REPORTS:{async put(k,v){objects.set(k,v);},async get(k){return objects.has(k)?{text:async()=>objects.get(k)}:null;}},
  SCANNER:{idFromName:x=>x,get(){return {async fetch(){calls++;if(fail)throw new Error('test scanner failure');return Response.json({label:'High',schema:'qrs-risk-v1',model:'test-model'});}};}},
 };
 for(const id of ['owner','other']){
  await DB.batch([
   DB.prepare('INSERT INTO users VALUES (?,?,?)').bind(id,id+'@example.test',1),
   DB.prepare('INSERT INTO accounts(user_id,credits,updated_at) VALUES (?,2,1)').bind(id),
   DB.prepare('INSERT INTO user_credentials VALUES (?,?,?)').bind(id,await passwordHash('test-password-1234','11'.repeat(16)),'11'.repeat(16)),
  ]);
 }
 const key='qrs_live_0123456789_'+'a'.repeat(48);
 await DB.prepare('INSERT INTO api_keys(id,user_id,key_hash,created_at) VALUES (?,?,?,1)').bind('key','owner',await hmac(env.QRS_API_KEY_PEPPER,key)).run();
 const request=async(path,options={})=>{
  if(options.headers?.Origin==='https://example.test'&&!options.headers['X-CSRF-Token']&&['/auth/login','/auth/register','/auth/password','/auth/logout','/api/session/scans','/api/home/assessment'].includes(path)){
   const token=await worker.fetch(new Request('https://example.test/api/home/csrf'),env);const data=await token.json();
   options={...options,headers:{...options.headers,Cookie:[options.headers.Cookie,token.headers.get('Set-Cookie').split(';')[0]].filter(Boolean).join('; '),'X-CSRF-Token':data.csrf_token}};
  }
  return worker.fetch(new Request('https://example.test'+path,options),env);
 };
 return {env,DB,key,objects,request,calls:()=>calls,setFailure:value=>{fail=value;},close:()=>rmSync(directory,{recursive:true,force:true})};
}
