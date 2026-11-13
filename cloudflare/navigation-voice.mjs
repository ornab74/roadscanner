import {readJSON} from './security.mjs';
import {boundedBody} from './internal-auth.mjs';
import {distanceText} from './public/pages/route-progress.mjs';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export const voiceStyles=Object.freeze({
 atlas:'An original adult voice with a warm, resonant baritone character, clear American English, quiet curiosity and thoughtful, reassuring delivery. Do not imitate any real person. Use subtle breath and natural punctuation pauses; avoid theatrical delivery.',
 clear:'An original clear, composed navigation voice. Neutral American English, direct articulation, steady pace, minimal ornament. Do not imitate any real person.',
});
export function voiceText(body,report){
 if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['cue','preset','report_id','section_index','distance_m'].includes(k))||!['preview','summary','turn','arrival','approach'].includes(body.cue)||!Object.hasOwn(voiceStyles,body.preset))fail('invalid_voice_request');
 if(body.cue==='preview'){
  if(Object.keys(body).some(k=>!['cue','preset'].includes(k)))fail('invalid_voice_request');
  return 'Hello. I’m Atlas, your AI-generated route voice. When you’re ready, we’ll look at the journey ahead… one clear step at a time.';
 }
 if(!Number.isSafeInteger(body.report_id)||body.report_id<1)fail('invalid_voice_request');
 if(!report||report.status!=='proposal'||report.geometry_alignment?.status!=='matched'||!Array.isArray(report.segments)||!report.segments.length)fail('voice_route_unavailable',409);
 if(body.cue==='summary')return ('Route overview. '+String(report.summary??'Review the proposed route before travel.')).slice(0,1200);
 if(body.cue==='approach'){if(!Number.isFinite(body.distance_m)||body.distance_m<0||body.distance_m>1000000)fail('invalid_voice_request');return 'In '+distanceText(body.distance_m).replace(' mi',' miles').replace(' ft',' feet')+', approach the proposed destination and confirm its entrance.';}
 if(body.cue==='arrival')return 'You’re near the proposed destination. Please confirm the actual entrance before continuing.';
 if(!Number.isInteger(body.section_index)||body.section_index<0||body.section_index>=report.segments.length||!Number.isFinite(body.distance_m)||body.distance_m<0||body.distance_m>1000000)fail('invalid_voice_request');
 const instruction=report.segments[body.section_index]?.instruction;if(typeof instruction!=='string'||!instruction.trim())fail('voice_route_unavailable',409);
 const distance=distanceText(body.distance_m).replace(' mi',' miles').replace(' ft',' feet');
 return ((body.distance_m<25?'Proposed maneuver now. ':'In '+distance+', ')+instruction).slice(0,600);
}
export async function navigationVoiceRoutes(request,env,helpers,fetcher=fetch){
 if(new URL(request.url).pathname!=='/api/route/voice')return null;
 const p=await helpers.principal(request,env);if(!p.session_hash)fail('login_required',401);
 const enabled=!!env.OPENAI_API_KEY&&env.ROUTE_VOICE_ENABLED!=='false';
 if(request.method==='GET')return Response.json({enabled,model:'gpt-4o-mini-tts',voice:'cedar',presets:Object.keys(voiceStyles),ai_generated:true},{headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')fail('method_not_allowed',405);
 if(!enabled)fail('voice_not_configured',503);
 const body=await readJSON(request,2048);
 // Validate syntax before touching a report. The preview is a fixed server script.
 if(!body||!['preview','summary','turn','arrival','approach'].includes(body.cue)||!Object.hasOwn(voiceStyles,body.preset??''))fail('invalid_voice_request');
 let report=null;
 if(body.cue!=='preview'){
  if(!Number.isSafeInteger(body.report_id)||body.report_id<1)fail('invalid_voice_request');
  report=await helpers.loadRoute(p.user_id,body.report_id);
 }
 const text=voiceText(body,report).replace(/[\u0000-\u001f\u007f]/g,' ');
 await helpers.limit(env,'voice-minute:'+p.user_id,12,60);
 await helpers.limit(env,'voice-hour:'+p.user_id,120,3600);
 await helpers.limit(env,'voice-global-hour',600,3600);
 await helpers.limit(env,'voice-global-day',2000,86400);
 const turn=['turn','arrival','approach'].includes(body.cue);
 const instructions=voiceStyles[body.preset]+(turn?' This is a short proposed navigation cue. Speak promptly and distinctly. Never add fillers, hesitation sounds, commentary, new directions or dramatic pauses. Preserve numbers and road names exactly.':' Use relaxed conversational phrasing, gentle sentence pauses and a slightly reflective cadence. Natural breathing is welcome, but do not add words, factual claims or personal identity. Preserve the supplied meaning.');
 try{
  const response=await fetcher('https://api.openai.com/v1/audio/speech',{method:'POST',redirect:'manual',signal:AbortSignal.any([request.signal,AbortSignal.timeout(25000)]),headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini-tts',voice:'cedar',input:text,instructions,response_format:'mp3',speed:turn?1:body.preset==='atlas'?.94:1})});
  if(!response.ok||!/^audio\/(mpeg|mp3)(?:;|$)/i.test(response.headers.get('Content-Type')??''))fail('voice_unavailable',503);
  const audio=await boundedBody(response.body,2097152);if(!audio.length)fail('voice_unavailable',503);
  return new Response(audio,{headers:{'Content-Type':'audio/mpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-QRS-AI-Generated':'true','X-QRS-Voice-Preset':body.preset}});
 }catch{fail('voice_unavailable',503);}
}
