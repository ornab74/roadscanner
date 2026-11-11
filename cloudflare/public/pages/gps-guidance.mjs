export const isPlannerFullscreen=()=>!!document.fullscreenElement||!!document.querySelector('.planner-content')?.classList.contains('app-fullscreen');
import {prepareRoute,progress,distance,distanceText,timeText} from './route-progress.mjs';
export function gpsGuidance(map){
 const el=id=>document.getElementById(id),panel=el('gpsGuide');let route=null,watch=null,marker=null,last=null,along=null,generation=0;
 function stop(message='GPS guidance stopped.'){generation++;if(watch!==null&&navigator.geolocation)navigator.geolocation.clearWatch(watch);watch=null;if(marker){map.removeLayer(marker);marker=null;}last=null;along=null;el('gpsStart').disabled=!route;el('gpsStop').disabled=true;el('gpsInstruction').textContent=message;el('gpsCurrent').textContent='';for(const id of ['gpsTurnDistance','gpsTurnTime','gpsRemaining','gpsSpeed','gpsAccuracy'])el(id).textContent='—';}
 function availability(){const full=isPlannerFullscreen();panel.hidden=!full;if(!full)stop();el('gpsStart').disabled=!route;}
 function fix(position){if(watch===null||!route)return;if(!isPlannerFullscreen()){stop();return;}const c=position.coords,point=[c.longitude,c.latitude],time=position.timestamp??Date.now();if(!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude)||!Number.isFinite(c.accuracy)||c.accuracy<0||Math.abs(c.latitude)>90||Math.abs(c.longitude)>180)return;
  if(!marker)marker=L.circleMarker([c.latitude,c.longitude],{radius:8,color:'#fff',weight:3,fillColor:'#49c2ff',fillOpacity:1}).addTo(map);else marker.setLatLng([c.latitude,c.longitude]);el('gpsAccuracy').textContent=Math.round(c.accuracy)+' m';
  if(c.accuracy>60){el('gpsInstruction').textContent='GPS accuracy is too low for turn guidance. Waiting for a better fix.';for(const id of ['gpsTurnDistance','gpsTurnTime','gpsRemaining','gpsSpeed'])el(id).textContent='—';return;}
  const dt=last?(time-last.time)/1000:0;let speed=Number.isFinite(c.speed)&&c.speed>=0?c.speed:null;
  if(speed===null&&last&&dt>=1&&dt<30&&c.accuracy<25&&last.accuracy<25)speed=distance(last.point,point)/dt;
  if(speed!==null&&speed>90)speed=null;
  const advance=last?Math.max(250,(speed??15)*Math.max(1,dt)*2+c.accuracy*2):Infinity;
  const p=progress(route,point,along,advance);el('gpsSpeed').textContent=speed!==null?(speed*2.23694).toFixed(0)+' mph':'—';
  if(!p||p.offRoute>Math.max(65,c.accuracy*2)){el('gpsInstruction').textContent='Away from the proposed path. Review the map and replan when safe; turn guidance is paused.';el('gpsTurnDistance').textContent='—';el('gpsTurnTime').textContent='—';el('gpsRemaining').textContent='—';last={point,time,accuracy:c.accuracy};return;}
  along=p.along;last={point,time,accuracy:c.accuracy};el('gpsTurnDistance').textContent=distanceText(p.beforeTurn);el('gpsTurnTime').textContent=speed!==null&&speed>.5?'~'+timeText(p.beforeTurn/speed):'Speed needed';el('gpsRemaining').textContent=distanceText(p.remaining);el('gpsCurrent').textContent=p.current;
  const arrival=distance(point,route.destination)<Math.max(20,c.accuracy)&&p.remaining<50;
  el('gpsInstruction').textContent=arrival?'Near the proposed destination. Confirm the actual entrance or unit.':!p.last&&p.beforeTurn<25&&c.accuracy<25?'Proposed turn now: '+p.next:'In '+distanceText(p.beforeTurn)+', '+p.next;
  if(el('gpsFollow').checked)map.panTo([c.latitude,c.longitude],{animate:true,duration:.4});
 }
 el('gpsStart').onclick=()=>{if(!isPlannerFullscreen()||!route)return;if(!navigator.geolocation){el('gpsInstruction').textContent='GPS is unavailable. This feature needs device location; map preview remains available.';return;}stop('Waiting for GPS…');el('gpsStart').disabled=true;el('gpsStop').disabled=false;const session=generation;watch=navigator.geolocation.watchPosition(position=>{if(generation===session)fix(position);},error=>{if(generation!==session)return;el('gpsInstruction').textContent=error.code===1?'Location permission denied. Allow location to use full-screen GPS guidance.':'GPS signal unavailable. Waiting for another position.';if(error.code===1)stop('Location permission denied.');},{enableHighAccuracy:true,maximumAge:1000,timeout:15000});};
 el('gpsStop').onclick=()=>stop();el('gpsExit').onclick=()=>el('fullscreen').click();document.addEventListener('fullscreenchange',availability);window.addEventListener('plannerfullscreenchange',availability);window.addEventListener('pagehide',()=>stop());document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('GPS paused while the page is hidden.');});availability();
 return {setRoute(result){stop();route=result.status==='proposal'&&result.segments?.length?prepareRoute(result.segments):null;if(route&&!route.edges.length)route=null;availability();},stop};
}
