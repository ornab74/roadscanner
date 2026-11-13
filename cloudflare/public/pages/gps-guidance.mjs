import {vehicleMapIcon} from './vehicle-marker.mjs';
import {prepareRoute,progress,distance,distanceText,timeText} from './route-progress.mjs';
export const isPlannerFullscreen=()=>!!document.fullscreenElement||!!document.querySelector('.planner-content')?.classList.contains('app-fullscreen');
export function gpsGuidance(map){
 const el=id=>document.getElementById(id),panel=el('gpsGuide');
 const gpsPane=map.getPane('gpsPosition')??map.createPane('gpsPosition');gpsPane.style.zIndex='650';gpsPane.style.pointerEvents='none';
 let vehicle=null,route=null,sections=[],watch=null,marker=null,accuracyRing=null,last=null,along=null,generation=0,timer=null,lastFix=0,spoken=null,firstFix=true,currentIndex=null;
 const trackingFields=['gpsTurnDistance','gpsTurnTime','gpsRemaining','gpsSpeed','gpsAccuracy','gpsArrival','gpsDuration'];
 function state(name,label){panel.dataset.state=name;el('gpsSignal').textContent=label;}
 function clearTravel(){el('gpsProgress').value=0;el('gpsProgress').setAttribute('aria-valuetext','Position unavailable');for(const id of ['gpsTurnDistance','gpsTurnTime','gpsRemaining','gpsArrival','gpsDuration'])el(id).textContent='—';el('gpsThen').textContent='Turn cues paused until a reliable position is available.';el('gpsRisk').textContent='Caution —';el('gpsRisk').removeAttribute('title');el('gpsRisk').dataset.level='unknown';el('gpsCurrent').textContent='';el('gpsRoadName').textContent='';el('gpsSection').textContent='Position not matched';currentIndex=null;el('gpsManeuver').textContent='—';window.speechSynthesis?.cancel();spoken=null;}
 function maneuver(text=''){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');svg.setAttribute('viewBox','0 0 48 48');svg.setAttribute('width','42');svg.setAttribute('height','48');svg.setAttribute('aria-hidden','true');const left=/left/i.test(text),right=/right/i.test(text),back=/u.turn/i.test(text),round=/roundabout/i.test(text);path.setAttribute('d',back?'M34 40V18C34 4 14 4 14 18V28M7 21L14 28L21 21':round?'M24 40V32C6 30 7 10 22 10C37 10 39 29 26 31M26 22V31H35':left?'M32 40V17H9M19 7L9 17L19 27':right?'M16 40V17H39M29 7L39 17L29 27':'M24 40V7M13 18L24 7L35 18');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','5');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);el('gpsManeuver').replaceChildren(svg);}
 function stop(message='GPS guidance stopped.'){
  generation++;if(watch!==null&&navigator.geolocation)navigator.geolocation.clearWatch(watch);watch=null;clearInterval(timer);timer=null;
  for(const layer of [marker,accuracyRing])if(layer)map.removeLayer(layer);marker=null;accuracyRing=null;last=null;along=null;lastFix=0;firstFix=true;
  clearTravel();for(const id of trackingFields)el(id).textContent='—';el('gpsProgress').value=0;
  el('gpsStart').disabled=!route;el('gpsStop').disabled=true;el('gpsInstruction').textContent=message;state('ready',route?'Route preview':'No route loaded');
  el('gpsSection').textContent=route?sections.length+' proposed sections':'No active route';
  window.dispatchEvent(new CustomEvent('qrs:gps-quality',{detail:{accuracy:null}}));
 }
 function availability(){const full=isPlannerFullscreen();panel.hidden=!full;el('gpsJourney').hidden=!full;if(!full)stop();el('gpsStart').disabled=watch!==null||!route;map.invalidateSize();}
 function announce(p,arrival){
  if(!el('gpsVoice').checked||!window.speechSynthesis||!window.SpeechSynthesisUtterance)return;
  const key=arrival?'arrival':p.index+':'+(p.beforeTurn<25?'now':p.beforeTurn<100?'near':'next');
  if(spoken===key)return;spoken=key;const utterance=new SpeechSynthesisUtterance((arrival?'Near the proposed destination. Confirm its entrance.':'In '+distanceText(p.beforeTurn)+', '+p.next).slice(0,350));utterance.rate=1;window.speechSynthesis.cancel();window.speechSynthesis.speak(utterance);
 }
 function stale(message='GPS signal is stale. Turn cues are paused until a fresh fix arrives.'){clearTravel();el('gpsSpeed').textContent='—';el('gpsAccuracy').textContent='—';el('gpsInstruction').textContent=message;state('stale','Waiting for fresh GPS');}
 function fix(position){
  if(watch===null||!route)return;if(!isPlannerFullscreen()){stop();return;}
  const c=position.coords,point=[c.longitude,c.latitude],time=position.timestamp??Date.now();
  if(!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude)||!Number.isFinite(c.accuracy)||c.accuracy<0||Math.abs(c.latitude)>90||Math.abs(c.longitude)>180||!Number.isFinite(time)||time>Date.now()+5000)return;
  if(Date.now()-time>15000){stale();return;}if(time<lastFix)return;lastFix=time;
  const heading=Number.isFinite(c.heading)&&c.heading>=0&&c.heading<=360?c.heading:0;
  if(!marker){marker=vehicle?L.marker([c.latitude,c.longitude],{icon:vehicleMapIcon(vehicle,heading),zIndexOffset:1000}).addTo(map):L.circleMarker([c.latitude,c.longitude],{pane:'gpsPosition',radius:8,color:'#fff',weight:3,fillColor:'#49c2ff',fillOpacity:1}).addTo(map);const label=document.createElement('span');label.textContent='Device GPS'+(vehicle?' · '+vehicle.name:'');marker.bindTooltip(label);}
  else{marker.setLatLng([c.latitude,c.longitude]);if(vehicle)marker.setIcon(vehicleMapIcon(vehicle,heading));}
  if(!accuracyRing)accuracyRing=L.circle([c.latitude,c.longitude],{radius:Math.min(c.accuracy,1000),color:'#49c2ff',weight:1,fillColor:'#49c2ff',fillOpacity:.08,interactive:false}).addTo(map);
  else accuracyRing.setLatLng([c.latitude,c.longitude]).setRadius(Math.min(c.accuracy,1000));
  el('gpsAccuracy').textContent=Math.round(c.accuracy)+' m';window.dispatchEvent(new CustomEvent('qrs:gps-quality',{detail:{accuracy:c.accuracy}}));
  if(c.accuracy>60){clearTravel();el('gpsSpeed').textContent='—';el('gpsInstruction').textContent='GPS accuracy is too low for turn guidance. Waiting for a better fix.';state('weak','Low GPS accuracy');last=null;return;}
  const dt=last?(time-last.time)/1000:0;let speed=Number.isFinite(c.speed)&&c.speed>=0?c.speed:null;
  if(speed===null&&last&&dt>=1&&dt<30&&c.accuracy<25&&last.accuracy<25)speed=distance(last.point,point)/dt;
  if(speed!==null&&speed>90)speed=null;
  const advance=last?Math.max(250,(speed??15)*Math.max(1,dt)*2+c.accuracy*2):Infinity;
  const p=progress(route,point,along,advance);el('gpsSpeed').textContent=speed!==null?Math.round(speed*2.23694)+' mph':'—';
  if(!p||p.offRoute>Math.max(65,c.accuracy*2)){clearTravel();el('gpsInstruction').textContent='Away from the proposed path. Review the map and replan when safe; turn guidance is paused.';state('offroute','Off proposed route');last={point,time,accuracy:c.accuracy};return;}
  currentIndex=p.index;along=p.along;last={point,time,accuracy:c.accuracy};
  el('gpsTurnDistance').textContent=distanceText(p.beforeTurn);el('gpsTurnTime').textContent=speed!==null&&speed>.5?'~'+timeText(p.beforeTurn/speed):'Speed needed';
  el('gpsRemaining').textContent=distanceText(p.remaining);el('gpsCurrent').textContent=p.current;el('gpsRoadName').textContent='ON '+(p.road||'Mapped connector');maneuver(p.next);
  el('gpsProgress').value=route.total?Math.min(100,p.along/route.total*100):0;el('gpsProgress').setAttribute('aria-valuetext',Math.round(el('gpsProgress').value)+' percent of proposed route');el('gpsSection').textContent='Section '+(p.index+1)+' / '+sections.length;
  const moving=speed!==null&&speed>=1.5,seconds=moving?p.remaining/speed:null;
  el('gpsDuration').textContent=seconds===null?'—':'~'+timeText(seconds);el('gpsArrival').textContent=seconds===null?'Pace needed':new Date(Date.now()+seconds*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  const s=sections[p.index],score=s?.risk_score;el('gpsRisk').textContent=Number.isInteger(score)?'Caution '+score+'/100':'Caution unscored';el('gpsRisk').title=s?.risk_reason??'No section score';el('gpsRisk').dataset.level=score===null||score===undefined?'unknown':score<40?'lower':score<75?'moderate':'elevated';
  el('gpsThen').textContent=sections[p.index+2]?'THEN · '+sections[p.index+2].instruction:p.last?'FINAL APPROACH · Confirm the actual entrance.':'THEN · Approach the proposed destination.';
  const arrival=distance(point,route.destination)<Math.max(20,c.accuracy)&&p.remaining<50;
  el('gpsInstruction').textContent=arrival?'Near the proposed destination. Confirm the actual entrance or unit.':!p.last&&p.beforeTurn<25&&c.accuracy<25?'Proposed turn now: '+p.next:p.next;
  state(arrival?'arrival':'tracking',arrival?'Near mapped endpoint':'GPS tracking');announce(p,arrival);
  if(el('gpsFollow').checked){if(firstFix)map.setView([c.latitude,c.longitude],17,{animate:false});else map.panTo([c.latitude,c.longitude],{animate:true,duration:.4});}firstFix=false;
 }
 el('gpsStart').onclick=()=>{
  if(!isPlannerFullscreen()||!route)return;if(!navigator.geolocation){el('gpsInstruction').textContent='GPS is unavailable. This feature needs device location; map preview remains available.';return;}
  stop('Waiting for GPS…');state('waiting','Acquiring GPS');el('gpsStart').disabled=true;el('gpsStop').disabled=false;const session=generation;lastFix=Date.now();
  watch=navigator.geolocation.watchPosition(position=>{if(generation===session)fix(position);},error=>{if(generation!==session)return;if(error.code===1)stop('Location permission denied.');else stale('GPS signal unavailable. Waiting for another position.');},{enableHighAccuracy:true,maximumAge:1000,timeout:15000});
  timer=setInterval(()=>{if(watch!==null&&Date.now()-lastFix>15000)stale();},5000);
 };
 el('gpsRisk').onclick=()=>{if(currentIndex!==null)window.dispatchEvent(new CustomEvent('qrs:inspect-section',{detail:{index:currentIndex}}));};
 el('gpsVoice').disabled=!window.speechSynthesis||!window.SpeechSynthesisUtterance;
 el('gpsVoice').onchange=()=>{spoken=null;if(!el('gpsVoice').checked)window.speechSynthesis?.cancel();};
 map.on('dragstart',()=>{if(watch!==null)el('gpsFollow').checked=false;});
 el('gpsRecenter').onclick=()=>{el('gpsFollow').checked=true;if(marker)map.setView(marker.getLatLng(),Math.max(16,map.getZoom()));};
 el('gpsOverview').onclick=()=>{if(!route)return;el('gpsFollow').checked=false;map.fitBounds(L.latLngBounds(route.edges.flatMap(e=>[[e.a[1],e.a[0]],[e.b[1],e.b[0]]])),{paddingTopLeft:[30,Math.min(350,map.getSize().y*.4)],paddingBottomRight:[30,Math.min(230,map.getSize().y*.25)]});};
 el('gpsStop').onclick=()=>stop();el('gpsExit').onclick=()=>el('fullscreen').click();
 document.addEventListener('fullscreenchange',availability);window.addEventListener('plannerfullscreenchange',availability);window.addEventListener('pagehide',()=>stop());document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('GPS paused while the page is hidden.');});availability();
 return {setVehicle(value){stop();vehicle=value??null;},setRoute(result){stop();sections=result.segments??[];route=result.status==='proposal'&&result.geometry_alignment?.status==='matched'&&sections.length?prepareRoute(sections):null;if(route&&!route.edges.length)route=null;el('gpsSection').textContent=route?sections.length+' proposed sections':'No active route';el('gpsInstruction').textContent=route?'Route loaded. Start guidance when ready.':'Load a mapped route to start guidance.';state('ready',route?'Route preview':'No route loaded');availability();},stop};
}
