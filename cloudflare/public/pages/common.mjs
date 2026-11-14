export const byId=id=>document.getElementById(id);
export const friendly={
 invalid_blog_post:'Enter a title, a lowercase URL slug, and post text within the displayed limits.',
 invalid_site_settings:'Check the setting values and required change reason. Limits cannot exceed the safety ceilings.',
 post_not_found:'That post is no longer available.',
 blog_post_limit:'The blog has reached its 500-post limit. Ask the operator to review retained posts.',
 blog_unavailable:'The blog is temporarily unavailable.',

 settings_changed:'Settings changed in another tab. Reload them before saving.',
 post_changed:'This post changed elsewhere. Reload it before saving.',
 blog_slug_taken:'Another post already uses this URL slug.',
 feature_disabled:'This feature is temporarily disabled by the administrator.',
 new_work_paused:'New analyses are temporarily paused. Existing reports and account settings remain available.',

 billing_account_restricted:'Your billing account requires review before more paid work. Existing reports remain available.',
 payments_disabled:'Payments are not enabled for this account.',
 stripe_test_access_required:'Stripe test checkout is restricted to approved testers.',
 billing_provider_unavailable:'Stripe test checkout is temporarily unavailable. Please retry shortly.',
 checkout_already_open:'A checkout is already open for this product. Complete it or wait for its 30-minute expiry.',
 subscription_already_exists:'A subscription already exists. Use Manage subscription.',
 phf_blocked:'The PHF safety filter did not approve this illustration. Change the appearance details and try again.',
 phf_unavailable:'The PHF filter is unavailable. No illustration was delivered; the reserved credit was refunded.',
 image_generation_failed:'The illustration could not be completed. Your reserved credit was refunded.',
 vehicle_changed:'This vehicle changed during your request. Reload the garage and try again.',
 image_processing:'An image request is already processing. Please wait before retrying.',
 vehicle_mode_incompatible:'This vehicle uses a dedicated aircraft or rail briefing, not road GPS guidance.',
 aircraft_profile_required:'Choose an aircraft profile from your garage.',
 reauthentication_required:'Verify your identity to continue with this sensitive action.',
 admin_required:'This action requires administrator access.',
 credential_verification_failed:'The security key could not be verified. Please try again.',
 invalid_challenge:'This security-key request expired or was already used. Please start again.',
 invalid_expiry:'Choose an API-key lifetime between 1 and 365 days.',
 invalid_credentials:'The email or password is incorrect. Please try again.',
 invalid_email:'Enter a valid email address.',
 account_could_not_be_created:'An account with this email may already exist. Try logging in instead.',
 registration_disabled:'Registration is currently closed.',
 rate_limit_exceeded:'Too many attempts. Please wait a few minutes and try again.',
 login_required:'Please log in to continue.',
 insufficient_api_credits:'No scan credits remain. Purchases are currently unavailable.',
 scan_unavailable:'The scanner is busy or unavailable. Your reserved credit was refunded. Please try again.',
 home_model_not_configured:'The main-page model is not configured yet.',
 home_model_unavailable:'The homepage model is currently unavailable. Please try again shortly.',
 route_analysis_unavailable:'Route analysis could not finish. Your scan credit was refunded. Please try again.',
 insufficient_api_credits:'No scan credits remain. Purchases are currently unavailable.',
 endpoints_outside_map:'Fit both endpoints into the visible map before analyzing.',
 route_model_not_configured:'The route model is not configured.',
 weather_unavailable:'Current local weather is unavailable. Please try again shortly.',
 location_required:'Allow location to check your local weather.',
 invalid_csrf:'Your browser token expired. Please click Refresh to try again.',
 home_source_required:'Run a dashboard scan first so OpenAI has a saved scene to assess.',
 request_too_large:'The request is too large. Shorten the notes and try again.',
};
let csrfValue=null,csrfUntil=0,csrfPending=null;
export async function csrfToken(force=false){
 if(force){csrfValue=null;csrfUntil=0;}
 if(csrfValue&&Date.now()<csrfUntil)return csrfValue;
 if(csrfPending)return csrfPending;
 csrfPending=(async()=>{
  const response=await fetch('/api/home/csrf',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error('Unable to obtain a security token. Please reload.');
  const value=await response.json();if(typeof value.csrf_token!=='string'||!value.csrf_token||value.csrf_token.length>512)throw new Error('Invalid security token response. Please reload.');
  csrfValue=value.csrf_token;csrfUntil=Date.now()+(Number.isFinite(value.expires_at)?Math.max(0,Math.min(300000,value.expires_at*1000-Date.now()-60000)):60000);
  return csrfValue;
 })();
 try{return await csrfPending;}finally{csrfPending=null;}
}
// Retry only a CSRF rejection: the Worker verifies it before any mutation.
export async function csrfFetch(path,options={}){
 const mutation=!['GET','HEAD','OPTIONS'].includes((options.method??'GET').toUpperCase());
 if(!mutation)return fetch(path,{credentials:'same-origin',...options});
 for(let attempt=0;attempt<2;attempt++){
  const headers=new Headers(options.headers);headers.set('X-CSRF-Token',await csrfToken(attempt>0));
  const response=await fetch(path,{credentials:'same-origin',...options,headers});
  if(response.status!==403||attempt)return response;
  const error=await response.clone().json().catch(()=>null);if(error?.error!=='invalid_csrf')return response;
 }
}
export async function api(path,options={}){
 const response=await csrfFetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});
 const value=await response.json().catch(()=>({error:'Unable to read the response. Please try again.'}));
 if(!response.ok){const reasons={output_limit:'The route model reached its response limit.',model_incomplete:'The route model returned an incomplete response.',timeout:'The route analysis timed out.',invalid_output:'The route model returned a response that failed validation.',provider_http_error:'The route model provider is temporarily unavailable.',report_size_limit:'The route report exceeded its storage limit.',imagery_unavailable:'The automatic map imagery could not be captured.'};const detail=value.error==='route_analysis_unavailable'&&reasons[value.failure?.reason];const reference=value.error==='route_analysis_unavailable'&&/^[a-f0-9-]{36}$/.test(value.failure?.operation_id??'')?' Reference: '+value.failure.operation_id:'';throw Object.assign(new Error((detail?detail+' Your scan credit was refunded. Please try again.':friendly[value.error]??value.error??'Request failed. Please try again.')+reference),{status:response.status,code:value.error,failure:value.failure});}
 return value;
}
export async function session(){
 const response=await fetch('/api/session',{credentials:'same-origin'});
 if(response.status===401)return null;
 if(!response.ok)throw new Error('Unable to load your account. Please try again.');
 const user=await response.json();if(user.is_admin){for(const nav of document.querySelectorAll('.account-navigation')){if(!nav.querySelector('[data-admin-nav]')){const link=document.createElement('a');link.href='/admin';link.dataset.adminNav='';link.textContent='Admin console';nav.insertBefore(link,nav.querySelector('form'));}}}return user;
}
export async function requireSession(){
 const user=await session();
 if(!user){location.replace('/login?next='+encodeURIComponent(location.pathname));return null;}
 return user;
}
export function bindLogout(){
 loadSiteNotice();
 for(const form of document.querySelectorAll('[data-action=logout]'))form.addEventListener('submit',async event=>{
  event.preventDefault();await api('/auth/logout',{method:'POST'});location.assign('/home');
 });
}
export function status(id,message,error=false){
 const element=byId(id);if(!element)return;
 element.textContent=message;element.hidden=!message;element.classList.toggle('text-danger',error);
}

// One read per page load; announcements never inject HTML or load external code.
let noticeRequested=false;
function loadSiteNotice(){if(noticeRequested)return;noticeRequested=true;fetch('/api/site',{credentials:'same-origin'}).then(async r=>{if(!r.ok)return;const s=await r.json();document.dispatchEvent(new CustomEvent('qrs-site-config',{detail:s}));
 if(typeof s.support_url==='string'&&s.support_url){const target=document.querySelector('.account-navigation')??document.querySelector('nav .navbar-nav');if(target&&!target.querySelector('[data-support-link]')){const a=document.createElement('a');a.href=s.support_url;a.textContent='Support';if(target.classList.contains('account-navigation')){const icon=document.createElement('i'),label=document.createElement('span');icon.className='fas fa-life-ring';icon.setAttribute('aria-hidden','true');label.textContent='Support';a.replaceChildren(icon,label);}a.dataset.supportLink='';a.target='_blank';a.rel='noopener noreferrer';if(target.tagName==='UL'){const li=document.createElement('li');li.className='nav-item';a.className='nav-link';li.append(a);target.append(li);}else target.insertBefore(a,target.querySelector('form'));}}
 if(typeof s.announcement==='string'&&s.announcement){const banner=document.createElement('aside');banner.className='site-announcement'+(document.querySelector('.account-navigation')?' account-notice':'');banner.setAttribute('role','status');banner.textContent=(typeof s.site_name==='string'?s.site_name+' · ':'')+s.announcement;document.body.prepend(banner);}
 }).catch(()=>{});}
