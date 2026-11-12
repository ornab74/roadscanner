import { boundedBody } from './internal-auth.mjs';
const enc = new TextEncoder();
export const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2,'0')).join('');
export const unhex = s => {
  if (typeof s !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(s)) throw new Error('invalid hex');
  return Uint8Array.from(s.match(/../g), x => parseInt(x,16));
};
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async value => hex(await crypto.subtle.digest('SHA-256',enc.encode(value)));
export async function hmac(secret,value) {
  if (typeof secret !== 'string' || enc.encode(secret).length < 32) throw new Error('missing secret');
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,enc.encode(value)));
}
export async function passwordHash(password,salt,pepper) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Password must contain 12–256 characters');
  const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
  const derived=hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(salt),iterations:100000},key,256));
  if(pepper===undefined)return derived; // Legacy verifier and fixture compatibility only.
  return 'qrs-pbkdf2-sha256-hmac-v1$100000$'+await hmac(pepper,'qrs-password-v1\0'+salt+'\0'+derived);
}
export async function verifyPassword(password,salt,stored,pepper){
  if(typeof stored!=='string')return false;
  const legacy=/^[a-f0-9]{64}$/.test(stored);
  if(!legacy&&!/^qrs-pbkdf2-sha256-hmac-v1\$100000\$[a-f0-9]{64}$/.test(stored))return false;
  if(!legacy&&pepper===undefined)throw new Error('missing password pepper');
  return sameSecret(await passwordHash(password,salt,legacy?undefined:pepper),stored);
}
export async function sameSecret(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const key=await crypto.subtle.importKey('raw',enc.encode('qrs-constant-time-comparison-key'),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const signature=await crypto.subtle.sign('HMAC',key,enc.encode(a));
  return crypto.subtle.verify('HMAC',key,signature,enc.encode(b));
}

// JSON.parse accepts duplicate fields; reject them before validation or billing.
export function strictJSON(text) {
  let p=0;
  const ws=()=>{while (/\s/.test(text[p] ?? '') && p<text.length) p++;};
  function string() {
    const start=p++;
    while(p<text.length) {
      if(text[p]==='\\') {p+=2;continue;}
      if(text[p++]==='"') return JSON.parse(text.slice(start,p));
    }
    throw new Error('Invalid JSON');
  }
  function value(depth) {
    if(depth>16) throw new Error('JSON nesting exceeds limit');
    ws(); const ch=text[p];
    if(ch==='"') {string();return;}
    if(ch==='{' || ch==='[') {
      p++;ws();const end=ch==='{'?'}':']';const keys=new Set();
      if(text[p]===end){p++;return;}
      while(p<text.length){
        if(ch==='{'){
          ws();if(text[p]!=='"')throw new Error('Invalid JSON');
          const k=string();if(keys.has(k))throw new Error('Duplicate JSON field');keys.add(k);
          ws();if(text[p++]!==':')throw new Error('Invalid JSON');
        }
        value(depth+1);ws();const next=text[p++];if(next===end)return;
        if(next!==',')throw new Error('Invalid JSON');
      }
      throw new Error('Invalid JSON');
    }
    const start=p;while(p<text.length&&!/[\s,}\]]/.test(text[p]))p++;
    const primitive=JSON.parse(text.slice(start,p));
    if(typeof primitive==='number'&&!Number.isFinite(primitive))throw new Error('Non-finite number');
  }
  value(0);ws();if(p!==text.length)throw new Error('Invalid JSON');
  return JSON.parse(text);
}
export async function readJSON(request,maximum=32768) {
  if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json') throw Object.assign(new Error('content_type_must_be_json'),{status:415});
  let bytes;try{bytes=await boundedBody(request.body,maximum);}catch{throw Object.assign(new Error('request_too_large'),{status:413});}
  return strictJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
const limits={vehicle_type:64,destination:256,road_type:96,weather:96,traffic:96,obstacles:512,sensor_notes:1000};
export function validateScan(raw) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Expected JSON object');
  const allowed=new Set([...Object.keys(limits),'latitude','longitude','model','language','model_selection','language_selection']);
  if(Object.keys(raw).some(k=>!allowed.has(k)))throw new Error('Unsupported scan field');
  if(('model' in raw&&'model_selection' in raw)||('language'in raw&&'language_selection'in raw))throw new Error('Conflicting scan fields');
  const scan={};
  for(const [key,max] of Object.entries(limits)) {
    const v=raw[key]??'unknown';
    if(typeof v!=='string'||v.trim().length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))throw new Error('Invalid '+key);
    if(['vehicle_type','destination'].includes(key)&&!(key in raw&&v.trim()))throw new Error(key+' is required');
    scan[key]=v.trim()||'unknown';
  }
  for(const [key,max] of [['latitude',90],['longitude',180]]){
    const n=raw[key];if(typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>max)throw new Error('Invalid '+key);scan[key]=n;
  }
  scan.model=raw.model??raw.model_selection??'llama_local';
  scan.language=raw.language??raw.language_selection??'en';
  if(!['llama_local','openai','grok'].includes(scan.model))throw new Error('Unsupported model');
  if(!['en','zh','hi','es','fr','ar','bn','pt','ru','ur','id','de','ja','sw'].includes(scan.language))throw new Error('Unsupported language');
  return scan;
}
async function reportKey(secret) {
  const bytes=unhex(secret);if(bytes.length!==32)throw new Error('Invalid report encryption key');
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
export async function encryptReport(secret,owner,id,value) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=enc.encode(JSON.stringify(value));
  if(data.length>262144)throw new Error('Report too large');
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(`${owner}\0${id}`)},await reportKey(secret),data);
  return JSON.stringify({v:1,iv:hex(iv),ct:hex(ct)});
}
export async function decryptReport(secret,owner,id,encoded) {
  if(encoded.length>600000)throw new Error('Report too large');
  const e=JSON.parse(encoded);if(e.v!==1)throw new Error('Unknown report version');
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(e.iv),additionalData:enc.encode(`${owner}\0${id}`)},await reportKey(secret),unhex(e.ct));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
