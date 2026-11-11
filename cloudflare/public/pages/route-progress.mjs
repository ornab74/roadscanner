const R=6371000,rad=v=>v*Math.PI/180;
export function distance(a,b){const p=rad(b[1]-a[1]),l=rad(b[0]-a[0]),h=Math.sin(p/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(l/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));}
export function prepareRoute(segments){let total=0;const edges=[],sections=[];for(const [index,s] of segments.entries()){const coords=s.geometry?.coordinates??[],begin=total;for(let j=1;j<coords.length;j++){const length=distance(coords[j-1],coords[j]);if(length>.1){edges.push({a:coords[j-1],b:coords[j],begin:total,length,index});total+=length;}}sections.push({begin,end:total,instruction:s.instruction,street:s.street});}return {edges,sections,total,destination:segments.at(-1)?.geometry?.coordinates.at(-1)};}
export function progress(route,point,previous=null,maxAdvance=500){
 let best=null;
 for(const e of route.edges){const cos=Math.cos(rad(point[1])),ax=(e.a[0]-point[0])*cos,ay=e.a[1]-point[1],dx=(e.b[0]-e.a[0])*cos,dy=e.b[1]-e.a[1],t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy))),p=[e.a[0]+t*(e.b[0]-e.a[0]),e.a[1]+t*(e.b[1]-e.a[1])],along=e.begin+t*e.length;
  if(previous!==null&&(along<previous-40||along>previous+maxAdvance))continue;
  const away=distance(point,p);if(!best||away<best.offRoute)best={along,offRoute:away,index:e.index,point:p};
 }
 if(!best)return null;
 const section=route.sections[best.index],next=route.sections[best.index+1];
 return {...best,remaining:Math.max(0,route.total-best.along),beforeTurn:Math.max(0,section.end-best.along),current:section.instruction,next:next?.instruction??'Approach the destination and confirm its entrance',last:!next};
}
export const distanceText=m=>m>=160?((m/1609.344)<10?(m/1609.344).toFixed(1):Math.round(m/1609.344))+' mi':Math.max(0,Math.round(m*3.28084/5)*5)+' ft';
export function timeText(seconds){if(!Number.isFinite(seconds)||seconds<0)return '—';return seconds<60?Math.max(1,Math.round(seconds))+' sec':Math.round(seconds/60)+' min';}
