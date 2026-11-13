import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationVoice} from '../cloudflare/public/pages/navigation-voice.mjs';

async function fixture(post){
 const saved=Object.fromEntries(['document','window','fetch','Audio','SpeechSynthesisUtterance'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const nodes=new Map(),audio=[],device=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='gpsVoiceMode'?'gpt':'atlas',checked:true,disabled:false,textContent:'',querySelector:()=>({disabled:false})});return nodes.get(id);};
 globalThis.document={hidden:false,getElementById:node};globalThis.window={speechSynthesis:{cancel(){},speak(u){device.push(u.text);}},SpeechSynthesisUtterance:function(){}};
 globalThis.SpeechSynthesisUtterance=function(text){this.text=text;};
 globalThis.Audio=class{constructor(){audio.push(this);}pause(){this.paused=true;}removeAttribute(){}load(){}async play(){this.played=true;}};
 let requests=0;
 globalThis.fetch=async(path,options={})=>{
  if(path==='/api/home/csrf')return Response.json({csrf_token:'fixture'});
  if(options.method==='POST'){requests++;return post();}
  return Response.json({enabled:true});
 };
 const speaker=navigationVoice({isActive:()=>true,isFullscreen:()=>true,onSettingsChange(){}});speaker.setRoute({report_id:12,summary:'Fixture'});
 await new Promise(resolve=>setImmediate(resolve));
 return {speaker,audio,device,node,requests:()=>requests,close(){speaker.stop();for(const [key,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}};
}
const clip=()=>new Response(new Uint8Array([73,68,51]),{headers:{'Content-Type':'audio/mpeg'}});
const cue={cue:'turn',section_index:1,distance_m:100,text:'Proposed left turn.',max_age_ms:1000};
test('late cloud cues are discarded instead of speaking obsolete turn distances',async()=>{
 const now=Date.now;let time=0;Date.now=()=>time;
 const f=await fixture(()=>{time=2000;return clip();});
 try{await f.speaker.speak(cue);assert.equal(f.audio.length,0);assert.match(f.node('gpsVoiceStatus').textContent,/Late voice cue skipped/);}finally{f.close();Date.now=now;}
});
test('stopping while cloud speech is pending prevents delayed playback',async()=>{
 let finish;const f=await fixture(()=>new Promise(resolve=>{finish=resolve;}));
 try{const pending=f.speaker.speak(cue);await new Promise(resolve=>setImmediate(resolve));f.speaker.stop();finish(clip());await pending;assert.equal(f.audio.length,0);}finally{f.close();}
});
test('a provider outage latches device fallback until an explicit settings reset',async()=>{
 const f=await fixture(()=>new Response('',{status:503}));
 try{await f.speaker.speak(cue);await f.speaker.speak({...cue,section_index:2});assert.equal(f.requests(),1);assert.equal(f.device.length,2);f.speaker.reset();await f.speaker.speak(cue);assert.equal(f.requests(),2);}finally{f.close();}
});
