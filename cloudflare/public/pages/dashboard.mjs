import {attachRadar} from './map-radar.mjs';
import {api,byId,bindLogout,requireSession,status} from './common.mjs';
bindLogout();
let map,marker,currentStep=1,modelsReady=false;
function coordinates(){
 const lat=byId('latitude').value.trim(),lon=byId('longitude').value.trim();
 if(!lat||!lon||!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon))||Math.abs(Number(lat))>90||Math.abs(Number(lon))>180)throw new Error('Enter a valid latitude from −90 to 90 and longitude from −180 to 180.');
 return {latitude:Number(lat),longitude:Number(lon)};
}
function showStep(step){
 currentStep=step;
 for(let n=1;n<=3;n++){
  byId('step'+n).classList.toggle('active',n===step);
  byId('stepper'+n).classList.toggle('active',n===step);
  byId('stepper'+n).setAttribute('aria-selected',String(n===step));
  if(n===step)byId('stepper'+n).setAttribute('aria-current','step');else byId('stepper'+n).removeAttribute('aria-current');
 }
 if(step===1&&map)setTimeout(()=>map.invalidateSize(),0);
}
function advance(step){
 try{
  if(step>1){const point=coordinates();byId('streetName').textContent=point.latitude.toFixed(6)+', '+point.longitude.toFixed(6);}
  status('statusMessage1','');showStep(step);
 }catch(e){showStep(1);status('statusMessage1',e.message,true);}
}
async function refreshAccount(){
 const user=await requireSession();if(!user)return;
 if(!modelsReady){
  const config=await api('/api/config'),select=byId('model_selection');select.replaceChildren();
  for(const model of config.models){const option=document.createElement('option');option.value=model;option.textContent=config.model_names?.[model]??model;select.append(option);}
  modelsReady=true;
 }
 byId('selectedModelName').textContent=byId('model_selection').selectedOptions[0]?.textContent??'';
 byId('accountName').textContent=user.email;byId('creditBalance').textContent=user.api_credits+' credits';
 const reports=await api('/api/reports');
 for(const counter of document.querySelectorAll('.hero-meta .metric-pill strong,.reports-head .metric-pill strong'))counter.textContent=String(reports.length);
 byId('reportRows').replaceChildren();byId('emptyReports').hidden=reports.length>0;byId('reportTable').hidden=!reports.length;
 for(const report of reports){
  const row=document.createElement('tr'),date=document.createElement('td'),actions=document.createElement('td'),button=document.createElement('button');
  date.textContent=new Date(report.created_at*1000).toLocaleString();actions.className='text-right';button.type='button';button.className='btn btn-info btn-sm';button.textContent='View';
  button.dataset.report=String(report.report_id);button.onclick=()=>viewReport(report.report_id);actions.append(button);row.append(date,actions);byId('reportRows').append(row);
 }
}
async function viewReport(id){
 try{
  const report=await api('/api/reports/'+id);const title=document.createElement('h3'),body=document.createElement('p'),meta=document.createElement('p');
  title.textContent=report.harm_level+' modeled risk';body.textContent=report.result;body.style.whiteSpace='pre-wrap';meta.textContent='Report '+report.report_id+' · '+report.model_used;
  byId('reportContent').replaceChildren(title,body,meta);window.jQuery('#reportModal').modal('show');
 }catch(e){status('pageStatus',e.message,true);}
}
async function scan(){
 const button=byId('startScanButton');
 let payload;try{
  const point=coordinates();const destination=byId('destination').value.trim();if(!destination)throw new Error('Enter a destination before starting the scan.');
  const context=byId('streetContext').value.trim(),notes=byId('sensor_notes').value.trim();
  const combined=[context?'Street context: '+context:'',notes].filter(Boolean).join('\n');
  if(combined.length>1000)throw new Error('Shorten the street context or sensor notes to 1,000 characters combined.');
  payload={...point,destination,vehicle_type:byId('vehicle_type').value,model:byId('model_selection').value,language:byId('language_selection').value,sensor_notes:combined};
  for(const field of ['weather','traffic','road_type','obstacles'])payload[field]=byId(field).value.trim()||'unknown';
 }catch(e){status('statusMessage3',e.message,true);return;}
 button.disabled=true;status('statusMessage3','Scanning the supplied observations. The first scan can take a moment while the model starts.');
 try{
  const result=await api('/api/session/scans',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(payload)});
  status('statusMessage3','Scan saved. One credit used.');await refreshAccount();await viewReport(result.report_id);
 }catch(e){status('statusMessage3',e.message,true);}finally{button.disabled=false;}
}
for(const control of document.querySelectorAll('[data-action]')){
 if(control.tagName==='FORM')continue;
 control.addEventListener('click',event=>{
  event.preventDefault();const action=control.dataset.action;
  if(action==='step1')showStep(1);else if(action==='step2')advance(2);else if(action==='step3')advance(currentStep>=2?3:2);
  else if(action==='scan')scan();else if(action==='geolocate')navigator.geolocation.getCurrentPosition(point=>{
   byId('latitude').value=point.coords.latitude;byId('longitude').value=point.coords.longitude;
   if(map){marker.setLatLng([point.coords.latitude,point.coords.longitude]);map.setView([point.coords.latitude,point.coords.longitude],13);}
  },()=>status('statusMessage1','Location unavailable. Enter coordinates or select a point on the map.',true),{enableHighAccuracy:true,timeout:15000});
 });
}
window.addEventListener('hashchange',()=>{if(location.hash==='#locationMap'){showStep(1);byId('locationMap').scrollIntoView({behavior:'smooth',block:'center'});}});
byId('grabCoordinatesForm').addEventListener('submit',event=>{event.preventDefault();advance(2);});
byId('runScanForm').addEventListener('submit',event=>{event.preventDefault();scan();});
byId('model_selection').addEventListener('change',()=>{byId('selectedModelName').textContent=byId('model_selection').selectedOptions[0]?.textContent??'';});
refreshAccount().then(()=>{
 if(!window.L)return;
 map=L.map('locationMap').setView([40.758,-73.9855],12);
 const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'}).addTo(map);
 tiles.on('tileerror',()=>status('statusMessage1','The street map could not load. You can still use your current location or enter coordinates.',true));
 attachRadar(map);
 marker=L.marker([40.758,-73.9855]).addTo(map);
 map.on('click',event=>{byId('latitude').value=event.latlng.lat.toFixed(6);byId('longitude').value=event.latlng.lng.toFixed(6);marker.setLatLng(event.latlng);});
}).catch(e=>status('pageStatus',e.message,true));
