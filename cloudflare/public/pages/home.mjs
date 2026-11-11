import {RiskWheel,breath,current} from './wheel-base.mjs';
import {api,byId} from './common.mjs';
import './navigation.mjs';
const wheel=new RiskWheel(byId('wheelCanvas'));
wheel.setTarget(0);
let timer=null,latest=null,busy=false,csrf=null,csrfExpires=0;
async function refresh(){
 if(busy)return;busy=true;byId('btnRefresh').disabled=true;
 try{
  if(!csrf||Date.now()>csrfExpires){csrf=(await api('/api/home/csrf')).csrf_token;csrfExpires=Date.now()+1800000;}
  byId('hudNote').textContent='Grok is composing context…';
  try{latest=await api('/api/home/preview',{method:'POST',headers:{'X-CSRF-Token':csrf},body:JSON.stringify({mode:'simulation'})});}catch(e){if(e.status===403)csrf=null;throw e;}
  if(latest.provider!=='grok'||typeof latest.harm_ratio!=='number'||!latest.color||typeof latest.confidence!=='number')throw new Error('The Grok reading is unavailable.');
  current.harm=latest.harm_ratio;current.last=latest;wheel.setTarget(current.harm);breath.setFromRisk(current.harm,{confidence:latest.confidence});
  byId('hudNumber').textContent=Math.round(current.harm*100)+'%';
  byId('hudLabel').textContent=latest.label.toUpperCase();byId('hudNote').textContent=latest.blurb;
  document.documentElement.style.setProperty('--accent',latest.color);
  byId('confidencePill').textContent='Conf: '+Math.round(latest.confidence*100)+'%';
  byId('homeModel').textContent='Grok · '+latest.model_used;
  byId('reasonsList').replaceChildren();
  for(const reason of latest.reasons){const li=document.createElement('li');li.textContent=reason;byId('reasonsList').append(li);}
  if(byId('btnDebug').getAttribute('aria-pressed')==='true')byId('debugBox').textContent=JSON.stringify(latest,null,2);
 }catch(e){latest=null;current.last=null;wheel.setTarget(0);byId('hudNumber').textContent='--%';byId('hudLabel').textContent='UNAVAILABLE';byId('hudNote').textContent=e.message;byId('confidencePill').textContent='Conf: --%';byId('reasonsList').replaceChildren();byId('debugBox').textContent='No current reading.';}
 finally{busy=false;byId('btnRefresh').disabled=false;}
}
byId('btnRefresh').onclick=refresh;
byId('btnAuto').onclick=()=>{
 if(timer){clearInterval(timer);timer=null;byId('btnAuto').textContent='Auto: Off';byId('btnAuto').setAttribute('aria-pressed','false');}
 else{timer=setInterval(refresh,60000);byId('btnAuto').textContent='Auto: On';byId('btnAuto').setAttribute('aria-pressed','true');refresh();}
};
byId('btnDebug').onclick=()=>{
 const show=byId('debugBox').hidden||byId('debugBox').style.display==='none';byId('debugBox').hidden=!show;byId('debugBox').style.display=show?'':'none';byId('btnDebug').setAttribute('aria-pressed',String(show));byId('btnDebug').textContent=show?'Debug: On':'Debug: Off';if(show)byId('debugBox').textContent=latest?JSON.stringify(latest,null,2):'No reading has been loaded.';
};
timer=setInterval(refresh,60000);refresh();
