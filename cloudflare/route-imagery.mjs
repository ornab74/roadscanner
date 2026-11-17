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
  views.push({id:name+'-detail-streets',role:name+' close-up labeled entrance/exit and connector direction context',kind:'street',bounds:around(p,request.mode==='walking'?90:140)});
  views.push({id:name+'-detail-satellite',role:name+' close-up entrance/exit, drive-through connection and parking access; signs and legality remain unverified',kind:'satellite',bounds:around(p,request.mode==='walking'?50:80)});
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
export function satelliteTileViews(view){
 const z=19,n=2**z,lon=(view.bounds.west+view.bounds.east)/2,lat=(view.bounds.south+view.bounds.north)/2;
 const xf=(lon+180)/360*n,yf=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n,x=Math.max(0,Math.min(n-1,Math.floor(xf))),y=Math.max(0,Math.min(n-1,Math.floor(yf)));
 const sides=[[xf-x,x-1,y],[1-(xf-x),x+1,y],[yf-y,x,y-1],[1-(yf-y),x,y+1]].sort((a,b)=>a[0]-b[0]);
 const tiles=[[x,y],[sides[0][1],sides[0][2]]].filter(([x,y])=>x>=0&&y>=0&&x<n&&y<n),latitude=y=>Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI;
 return tiles.map(([x,y],i)=>({...view,id:view.id+'-tile-'+i,role:view.role+' (native aerial detail tile '+(i+1)+'; coverage is only its stated bounds)',zoom:z,tile:{z,x,y},bounds:{west:x/n*360-180,east:(x+1)/n*360-180,north:latitude(y),south:latitude(y+1)}}));
}
async function fetchSatelliteTile(view,fetcher){
 const {z,x,y}=view.tile,url=root+'World_Imagery/MapServer/tile/'+z+'/'+y+'/'+x;
 const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.headers.get('Content-Type')?.toLowerCase().startsWith('image/'))throw Error('Imagery tile unavailable');
 const bytes=new Uint8Array(await boundedBody(response.body,512000));
 if(bytes[0]!==255||bytes[1]!==216)throw Error('Invalid imagery tile format');constrainImage(bytes,{format:'jpeg',width:256,height:256});
 const {tile,...metadata}=view;return {...metadata,width:256,height:256,image:'data:image/jpeg;base64,'+base64(bytes),preview_url:url,provider:'Esri World_Imagery / contributors',captured_at:Math.floor(Date.now()/1000),imagery_date:'unknown'};
}
async function captureView(view,fetcher){
 try{return {frames:[await fetchImagery(view,fetcher)],warnings:[]};}catch(error){
  // Some aerial export scales return a zero-sized image. Native close-up tiles
  // stay bounded and use the same fixed provider; they do not widen coverage claims.
  if(view.kind==='satellite'&&(view.id.includes('-detail-')||view.id.startsWith('connector-'))){
   const tiles=await Promise.allSettled(satelliteTileViews(view).map(t=>fetchSatelliteTile(t,fetcher))),frames=tiles.filter(r=>r.status==='fulfilled').map(r=>r.value);
   if(frames.length)return {frames,warnings:['Aerial export unavailable for '+view.id+'; native close-up tiles show partial coverage only.']};
  }
  throw error;
 }
}
async function captureViews(views,fetcher){
 const frames=[],warnings=[];
 for(let i=0;i<views.length;i+=2){const results=await Promise.allSettled(views.slice(i,i+2).map(v=>captureView(v,fetcher)));for(const [j,r] of results.entries()){if(r.status==='fulfilled'){frames.push(...r.value.frames);warnings.push(...r.value.warnings);}else{const message=r.reason?.message??'';console.error('route_imagery_unavailable',views[i+j].id,/^(Imagery |Invalid imagery |Missing imagery )/.test(message)&&/^[A-Za-z0-9: _-]+$/.test(message)?message:'upstream_or_parse_failure');warnings.push('Automatic imagery unavailable for '+views[i+j].id);}}}
 return {frames,warnings};
}

export async function captureRouteImagery(request,fetcher=fetch){return captureViews(imageryViews(request),fetcher);}
export function connectorViews(aligned){
 const sections=aligned.segments??[],selected=[],views=[];
 for(const i of new Set([1,sections.length-1,...sections.map((_,i)=>i).slice(1)])){
  if(i<1||i>=sections.length||selected.length>=2)continue;
  const previous=sections[i-1],next=sections[i];
  if(![previous,next].some(s=>s.road_class==='service'||s.name_provenance==='UNKNOWN'))continue;
  const p=next.geometry?.coordinates?.[0];if(!p)continue;
  const location={longitude:p[0],latitude:p[1]};
  if(selected.some(q=>Math.hypot((q.latitude-location.latitude)*111320,(q.longitude-location.longitude)*111320*Math.cos(location.latitude*Math.PI/180))<80))continue;
  selected.push(location);
  for(const kind of ['street','satellite'])views.push({id:'connector-'+i+'-'+kind,role:'close-up mapped junction between sections '+previous.id+' and '+next.id+'; compare straight-through versus side-turn/exit evidence, not assumed access',kind,section_ids:[previous.id,next.id],bounds:around(location,kind==='street'?150:85)});
 }
 return views;
}
export async function captureConnectorImagery(aligned,fetcher=fetch){return captureViews(connectorViews(aligned),fetcher);}
