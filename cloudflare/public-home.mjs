import {assessWithGrok} from './grok-home.mjs';
import {weatherLocation,currentWeather} from './weather.mjs';
import {hmac,randomToken,sameSecret,readJSON,encryptReport,decryptReport} from './security.mjs';
import {assessWithOpenAI} from './openai.mjs';
const now=()=>Math.floor(Date.now()/1000);
const json=(v,status=200,headers={})=>Response.json(v,{status,headers:{'Cache-Control':'no-store',...headers}});
const fail=(message,status)=>{throw Object.assign(new Error(message),{status});};
const q=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
function sameOrigin(request){
 const u=new URL(request.url);
 if(request.headers.get('Sec-Fetch-Site')==='cross-site')fail('invalid_origin',403);
 if(request.method==='POST'&&request.headers.get('Origin')!==u.origin)fail('invalid_origin',403);
 if(request.headers.has('Origin')&&request.headers.get('Origin')!==u.origin)fail('invalid_origin',403);
}
async function rate(env,request){
 const ip=await hmac(env.QRS_API_KEY_PEPPER,request.headers.get('CF-Connecting-IP')??'local');
 const row=await q(env,`INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`,'public-home:'+ip+':'+Math.floor(now()/60),now()+120).first();
 if(row.count>30)fail('rate_limit_exceeded',429);
}
export async function publicHomeCSRF(request,env){
 sameOrigin(request);await rate(env,request);
 const existing=/\b__Host-qrs_preview=([a-f0-9]{64}\.\d{10}\.[a-f0-9]{64})(?:;|$)/.exec(request.headers.get('Cookie')??'')?.[1];
 if(existing){const [nonce,expires,signature]=existing.split('.');if(Number(expires)>now()+60&&Number(expires)<=now()+3600&&await sameSecret(signature,await hmac(env.QRS_API_KEY_PEPPER,'public-home-cookie:'+nonce+'.'+expires)))return json({csrf_token:await hmac(env.QRS_API_KEY_PEPPER,'public-home-csrf:'+existing)});}
 const value=randomToken()+'.'+(now()+3600);
 const cookie=value+'.'+await hmac(env.QRS_API_KEY_PEPPER,'public-home-cookie:'+value);
 return json({csrf_token:await hmac(env.QRS_API_KEY_PEPPER,'public-home-csrf:'+cookie)},200,{'Set-Cookie':'__Host-qrs_preview='+cookie+'; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600'});
}
export async function verifyBrowserCSRF(request,env){
 sameOrigin(request);
 const cookie=/\b__Host-qrs_preview=([a-f0-9]{64}\.\d{10}\.[a-f0-9]{64})(?:;|$)/.exec(request.headers.get('Cookie')??'')?.[1];
 if(!cookie)fail('invalid_csrf',403);
 const [nonce,expires,signature]=cookie.split('.');
 if(Number(expires)<now()||Number(expires)>now()+3600||!await sameSecret(signature,await hmac(env.QRS_API_KEY_PEPPER,'public-home-cookie:'+nonce+'.'+expires))||!await sameSecret(request.headers.get('X-CSRF-Token'),await hmac(env.QRS_API_KEY_PEPPER,'public-home-csrf:'+cookie)))fail('invalid_csrf',403);
}
export async function publicHomePreview(request,env){
 await verifyBrowserCSRF(request,env);
 await rate(env,request);
 const body=await readJSON(request,512);
 const grok=env.HOME_PROVIDER==='grok';
 const simulated=body?.mode==='simulation'&&Object.keys(body).length===1;
 const location=simulated?null:weatherLocation(body);
 if(!(grok?env.GROK_API_KEY:env.OPENAI_API_KEY))fail('home_model_not_configured',503);
 if(grok&&!simulated)fail('invalid_preview_request',400);
 const model=grok?(env.GROK_HOME_MODEL??'grok-4-1-fast-non-reasoning'):(env.OPENAI_HOME_MODEL??'gpt-5.5');
 const cacheKey=simulated?null:'weather:'+await hmac(env.QRS_API_KEY_PEPPER,model+':'+location.latitude+':'+location.longitude);
 if(!simulated){
 const cached=await q(env,'SELECT payload,expires_at FROM public_home_previews WHERE model=?',cacheKey).first();
 if(cached?.payload&&cached.expires_at>now())return json({...await decryptReport(env.QRS_REPORT_KEY,'public-weather',cacheKey,cached.payload),cached:true});
 const claimed=await q(env,`INSERT INTO public_home_previews(model,lease_expires_at) VALUES (?,?)
 ON CONFLICT(model) DO UPDATE SET lease_expires_at=excluded.lease_expires_at
 WHERE public_home_previews.lease_expires_at<? AND public_home_previews.expires_at<=? RETURNING model`,cacheKey,now()+120,now(),now()).first();
 if(!claimed)return json({status:'processing'},202,{'Retry-After':'3'});
 }
 try{
  const ip=await hmac(env.QRS_API_KEY_PEPPER,request.headers.get('CF-Connecting-IP')??'local');
  const limits=simulated?[['simulation-openai:'+ip,6,60],['simulation-openai-global',120,3600]]:[['weather-openai:'+ip,6,3600],['weather-openai-global',30,3600]];
  for(const [key,max,seconds] of limits){
   const r=await q(env,`INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`,key+':'+Math.floor(now()/seconds),now()+seconds).first();
   if(r.count>max)fail('rate_limit_exceeded',429);
  }
  let weather=null,simulation=null,context;
  if(simulated){
   const pick=values=>values[crypto.getRandomValues(new Uint32Array(1))[0]%values.length];
   simulation={setting:pick(['fictional city center','fictional suburban road','fictional rural road','fictional mountain pass','fictional coastal road']),weather:pick(['dry and clear','light rain','heavy rain','fog','snow showers']),traffic:pick(['light','moderate','busy']),time_of_day:pick(['daylight','dusk','night'])};
   context={source:'simulated_location',simulation,scope:'Build one coherent fictional road scene from these simulated conditions, cross-check terrain, visibility, weather and traffic for consistency, then return its modeled severity. No actual location or sensor input is available.'};
  }else{
   try{weather=await currentWeather(location);}catch{fail('weather_unavailable',503);}
   context={source:'current_weather_estimate',weather,unknowns:['traffic','road surface measurements','obstacles','driver behavior'],scope:'Assess weather-related driving conditions only. No location or personal identifiers supplied to the model.'};
  }
  const result=grok?await assessWithGrok(env.GROK_API_KEY,model):await assessWithOpenAI(env.OPENAI_API_KEY,model,context,fetch,simulated?'simulation':true);
  const ratio=result.harm_ratio;
  const label=ratio<=.2?'Clear':ratio<=.4?'Light Caution':ratio<=.6?'Caution':ratio<=.8?'Elevated':'Critical';
  const payload={...result,label,source:simulated?'simulated_location':'current_weather_estimate',...(simulated?{simulation:grok?{mode:'original_guess_prompt',inputs:'synthetic simulation seed'}:simulation}:{location,weather}),created_at:now(),expires_at:simulated?null:now()+600,assessment_id:crypto.randomUUID()};
  if(!simulated)await q(env,'UPDATE public_home_previews SET payload=?,expires_at=?,lease_expires_at=0 WHERE model=?',await encryptReport(env.QRS_REPORT_KEY,'public-weather',cacheKey,payload),payload.expires_at,cacheKey).run();
  return json({...payload,cached:false});
 }catch(e){
  if(!simulated)await q(env,'UPDATE public_home_previews SET lease_expires_at=? WHERE model=?',now()+60,cacheKey).run();
  console.error('public_home_provider_failed',e.message);fail(e.status===429?'rate_limit_exceeded':e.message==='weather_unavailable'?'weather_unavailable':'home_model_unavailable',e.status===429?429:503);
 }
}
