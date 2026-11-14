// Public pages only read session state; no editor or mutation endpoint is exposed.
fetch('/api/session',{credentials:'same-origin'}).then(async r=>{if(!r.ok)return;const p=await r.json();if(p.is_admin===true)for(const id of ['writePost','adminBlogLink']){const element=document.getElementById(id);if(element)element.hidden=false;}}).catch(()=>{});
