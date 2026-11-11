import {constrainImage} from './image-constraints.mjs';
import {boundedBody} from './internal-auth.mjs';
const root='https://server.arcgisonline.com/ArcGIS/rest/services/';
const radius=6378137;
const mercator=lat=>Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
function extentBounds(e){if(!e||![e.xmin,e.xmax,e.ymin,e.ymax].every(Number.isFinite))throw Error('Missing imagery extent');return {west:e.xmin/radius*180/Math.PI,east:e.xmax/radius*180/Math.PI,south:Math.atan(Math.sinh(e.ymin/radius))*180/Math.PI,north:Math.atan(Math.sinh(e.ymax/radius))*180/Math.PI};}
export function around(p,meters){const dy=meters/111320,dx=dy/Math.max(.1,Math.cos(p.latitude*Math.PI/180));return {west:Math.max(-180,p.longitude-dx),east:Math.min(180,p.longitude+dx),south:Math.max(-84.9,p.latitude-dy),north:Math.min(84.9,p.latitude+dy)};}
export function imageryViews(request){
 const views=[];
 for(const [name,p] of [['start',request.start],['destination',request.destination]]){
  views.push({id:name+'-streets',role:name+' endpoint labeled street connections',kind:'street',bounds:around(p,request.mode==='walking'?500:900)});
  views.push({id:name+'-satellite',role:name+' endpoint aerial entrances/parking/building layout',kind:'satellite',bounds:around(p,request.mode==='walking'?130:240)});
 }
 const a=request.start,b=request.destination,span=Math.max(Math.abs(a.latitude-b.latitude)*111320,Math.abs(a.longitude-b.longitude)*111320*Math.cos((a.latitude+b.latitude)*Math.PI/360));
 if(span>1800){for(const [i,t] of [.2,.4,.6,.8].entries()){const p={latitude:a.latitude+(b.latitude-a.latitude)*t,longitude:a.longitude+(b.longitude-a.longitude)*t};views.push({id:'corridor-'+(i+1),role:'overlapping labeled corridor panel '+(i+1)+' of 4, from start toward destination',kind:'street',bounds:around(p,Math.max(1200,span*.24))});}}
 return views;
}
function base64(bytes){if(typeof bytes.toBase64==='function')return bytes.toBase64();let text='';for(let p=0;p<bytes.length;p+=1024)text+=String.fromCharCode(...bytes.subarray(p,p+1024));return btoa(text);}
export async function fetchImagery(view,fetcher=fetch){
 const service=view.kind==='satellite'?'World_Imagery':'World_Street_Map',url=new URL(root+service+'/MapServer/export'),b=view.bounds;
 for(const [k,v] of Object.entries({bbox:[b.west,b.south,b.east,b.north].join(','),bboxSR:'4326',imageSR:'3857',size:'1000,750',format:'jpg',f:'json'}))url.searchParams.set(k,v);
 const meta=await fetcher(url.toString(),{headers:{'User-Agent':'QRoadScan/1.0 https://ride.qroadscan.com','Accept':'application/json'},signal:AbortSignal.timeout(15000),redirect:'manual'});if(!meta.ok)throw Error('Imagery metadata unavailable HTTP '+meta.status);
 const d=JSON.parse(new TextDecoder().decode(await boundedBody(meta.body,32768)));if(d.error)throw Error('Imagery export error '+(Number.isInteger(d.error.code)?d.error.code:'unknown'));if(typeof d.href!=='string'||d.width!==1000||d.height!==750)throw Error('Invalid imagery metadata');const imageURL=new URL(d.href);
 if(imageURL.username||imageURL.password||imageURL.port&&imageURL.port!=='443'||imageURL.protocol!=='https:'||imageURL.hostname!=='server.arcgisonline.com'||!imageURL.pathname.toLowerCase().startsWith('/arcgis/rest/directories/arcgisoutput/'))throw Error('Invalid imagery image origin');
 const image=await fetcher(imageURL.toString(),{signal:AbortSignal.timeout(15000),redirect:'manual'});if(!image.ok||!image.headers.get('Content-Type')?.toLowerCase().startsWith('image/'))throw Error('Imagery image unavailable');
 const bytes=new Uint8Array(await boundedBody(image.body,1000000));if(bytes[0]!==255||bytes[1]!==216)throw Error('Invalid imagery image');try{constrainImage(bytes,{format:'jpeg',width:d.width,height:d.height});}catch{throw Error('Invalid imagery image dimensions');}
 return {...view,bounds:extentBounds(d.extent),width:d.width,height:d.height,image:'data:image/jpeg;base64,'+base64(bytes),preview_url:imageURL.toString(),provider:'Esri '+service+' / contributors',captured_at:Math.floor(Date.now()/1000),imagery_date:'unknown'};
}
export async function captureRouteImagery(request,fetcher=fetch){
 const views=imageryViews(request),frames=[],warnings=[];
 for(let i=0;i<views.length;i+=2){const results=await Promise.allSettled(views.slice(i,i+2).map(v=>fetchImagery(v,fetcher)));for(const [j,r] of results.entries()){if(r.status==='fulfilled')frames.push(r.value);else{const message=r.reason?.message??'';console.error('route_imagery_unavailable',views[i+j].id,/^(Imagery |Invalid imagery |Missing imagery )/.test(message)&&/^[A-Za-z0-9: _-]+$/.test(message)?message:'upstream_or_parse_failure');warnings.push('Automatic imagery unavailable for '+views[i+j].id);}}}
 return {frames,warnings};
}
