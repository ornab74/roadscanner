export function attachRadar(map){
 const toggle=document.getElementById('radarToggle'),timeline=document.getElementById('radarTimeline'),slider=document.getElementById('radarFrame'),status=document.getElementById('radarStatus');
 if(!map.getPane('rainviewer')){map.createPane('rainviewer');map.getPane('rainviewer').style.zIndex='350';map.getPane('rainviewer').style.pointerEvents='none';}
 let frames=[],layer=null,loadedAt=0,generation=0,frameText='';
 function clear(){if(layer){map.removeLayer(layer);layer=null;}}
 function render(){
  clear();if(!toggle.checked)return;
  const f=frames[Number(slider.value)];if(!f)return;
  frameText='Frame '+new Date(f.time*1000).toLocaleString();let loaded=0,wet=0,readable=0,failed=0;
  layer=L.tileLayer(`https://tilecache.rainviewer.com${f.path}/256/{z}/{x}/{y}/2/1_1.png`,{pane:'rainviewer',crossOrigin:'anonymous',opacity:.8,maxNativeZoom:7,maxZoom:19,attribution:'Weather radar © <a href="https://www.rainviewer.com/" target="_blank" rel="noopener noreferrer">RainViewer</a>'});
  status.textContent=frameText+' · loading radar image tiles…';
  layer.on('tileload',e=>{loaded++;try{const c=document.createElement('canvas');c.width=e.tile.naturalWidth;c.height=e.tile.naturalHeight;const x=c.getContext('2d');x.drawImage(e.tile,0,0);const p=x.getImageData(0,0,c.width,c.height).data;readable++;for(let i=3;i<p.length;i+=4)if(p[i]>20){wet++;break;}}catch{}});
  layer.on('tileerror',()=>{failed++;status.textContent=frameText+' · some radar image requests failed. Coverage may be incomplete.';});
  layer.on('load',()=>{status.textContent=frameText+(failed?' · radar loaded with missing tiles.':loaded&&readable&&!wet?' · image tiles loaded, but contain no precipitation pixels here. No rain detected in the supplied tile, or coverage is missing.':loaded?' · radar imagery loaded. Colored pixels indicate precipitation; transparent areas do not confirm coverage.':' · no radar tiles loaded.');});
  layer.addTo(map);
 }
 async function update(){
  const id=++generation;timeline.hidden=!toggle.checked;clear();if(!toggle.checked)return;
  status.textContent='Loading recent RainViewer frames…';
  try{
   if(Date.now()-loadedAt>300000){const r=await fetch('https://api.rainviewer.com/public/weather-maps.json',{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('feed');const data=await r.json();frames=(Array.isArray(data?.radar?.past)?data.radar.past:[]).filter(f=>Number.isSafeInteger(f.time)&&f.time>Date.now()/1000-4*3600&&f.time<=Date.now()/1000+300&&/^\/v2\/radar\/[a-zA-Z0-9]+$/.test(f.path)).slice(-24);if(!frames.length)throw Error('no recent frames');loadedAt=Date.now();}
   if(id!==generation||!toggle.checked)return;slider.max=frames.length-1;slider.value=frames.length-1;render();
  }catch{if(id===generation)status.textContent='RainViewer feed unavailable. Map selection still works.';}
 }
 toggle.addEventListener('change',update);slider.addEventListener('input',render);document.getElementById('radarRegional')?.addEventListener('click',()=>map.setZoom(7));update();
}
