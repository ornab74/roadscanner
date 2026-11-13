import {api} from './common.mjs';

const previewText='Hello. I’m Atlas, your AI-generated route voice. When you’re ready, we’ll look at the journey ahead… one clear step at a time.';
export function navigationVoice({isActive,isFullscreen,onSettingsChange}){
 const el=id=>document.getElementById(id);let route=null,generation=0,controller=null,audio=null,url=null,blocked=false;
 const browserAvailable=()=>!!window.speechSynthesis&&!!window.SpeechSynthesisUtterance;
 function status(text){el('gpsVoiceStatus').textContent=text;}
 function stop(){generation++;controller?.abort();controller=null;if(audio){audio.pause();audio.removeAttribute('src');audio.load();audio=null;}if(url)URL.revokeObjectURL(url);url=null;window.speechSynthesis?.cancel();el('gpsVoiceMute').disabled=true;}
 function device(text){if(!browserAvailable())return false;const utterance=new SpeechSynthesisUtterance(text.slice(0,1200));utterance.rate=el('gpsVoicePreset').value==='atlas'?.94:1;window.speechSynthesis.cancel();window.speechSynthesis.speak(utterance);el('gpsVoiceMute').disabled=false;return true;}
 async function speak(cue,preview=false){
  stop();if(!isFullscreen()||document.hidden||!preview&&!isActive())return;
  const issued=Date.now(),token=generation,valid=()=>token===generation&&isFullscreen()&&!document.hidden&&(preview||isActive());
  const mode=el('gpsVoiceMode').value;
  if(mode==='device'||blocked){status(device(cue.text)?mode==='device'?'Device voice':'Device fallback · Preview to retry GPT':'Speech unavailable on this device.');return;}
  if(cue.cue!=='preview'&&!Number.isSafeInteger(route?.report_id)){status(device(cue.text)?'Device fallback · saved route needed for GPT':'Load a saved route for GPT voice.');return;}
  controller=new AbortController();status('Preparing Atlas audio…');el('gpsVoiceMute').disabled=false;
  try{
   const csrf=await api('/api/home/csrf');if(!valid())return;
   const body={cue:cue.cue,preset:el('gpsVoicePreset').value,...(cue.cue==='preview'?{}:{report_id:route.report_id}),...(cue.cue==='turn'?{section_index:cue.section_index,distance_m:cue.distance_m}:cue.cue==='approach'?{distance_m:cue.distance_m}:{})};
   const response=await fetch('/api/route/voice',{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf.csrf_token},body:JSON.stringify(body)});
   if(!response.ok)throw Error(response.status===429?'quota':'unavailable');
   if(!(response.headers.get('Content-Type')??'').startsWith('audio/'))throw Error('unavailable');
   const blob=await response.blob();if(!valid())return;if(!preview&&Date.now()-issued>(cue.max_age_ms??8000)){stop();status('Late voice cue skipped · follow the live display');return;}
   url=URL.createObjectURL(blob);audio=new Audio(url);audio.onended=()=>{if(token!==generation)return;stop();status('Atlas ready · AI-generated voice');};
   await audio.play();if(!valid()){stop();return;}status('Speaking · AI-generated GPT voice');
  }catch(error){
   if(!valid()||error.name==='AbortError')return;
   // Do not keep spending provider quota on each GPS fix after an outage or
   // autoplay rejection. A user preview/settings change explicitly retries GPT.
   stop();blocked=true;status(device(cue.text)?'Device fallback · Preview to retry GPT':error.message==='quota'?'Voice quota reached. Try later.':'Audio unavailable. Try Preview after enabling sound.');
  }
 }
 function reset(){stop();blocked=false;onSettingsChange();status(el('gpsVoiceMode').value==='device'?'Device voice selected':'Atlas ready · AI-generated voice');}
 el('gpsVoiceMode').onchange=reset;el('gpsVoicePreset').onchange=reset;
 el('gpsVoicePreview').onclick=()=>{blocked=false;speak({cue:'preview',text:previewText},true);};
 el('gpsVoiceSummary').onclick=()=>{blocked=false;speak({cue:'summary',text:('Route overview. '+(route?.summary??'')).slice(0,1200)},true);};
 el('gpsVoiceMute').onclick=()=>{el('gpsVoice').checked=false;el('gpsVoice').dispatchEvent(new Event('change'));stop();status('Voice muted');};
 api('/api/route/voice').then(config=>{if(!config.enabled){el('gpsVoiceMode').value='device';el('gpsVoiceMode').querySelector('option[value=gpt]').disabled=true;status('GPT voice is unavailable · device voice selected');}}).catch(()=>{status('GPT availability unknown · device fallback is available');});
 return {speak,stop,reset,setRoute(value){stop();route=value;el('gpsVoiceSummary').disabled=!Number.isSafeInteger(route?.report_id);}};
}
