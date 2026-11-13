export const byId=id=>document.getElementById(id);
export const friendly={
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
export async function api(path,options={}){
 if(!['GET','HEAD','OPTIONS'].includes((options.method??'GET').toUpperCase())){
  const tokenResponse=await fetch('/api/home/csrf',{credentials:'same-origin',cache:'no-store'});
  if(!tokenResponse.ok)throw new Error('Unable to obtain a security token. Please reload.');
  options={...options,headers:{...options.headers,'X-CSRF-Token':(await tokenResponse.json()).csrf_token}};
 }
 const response=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});
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
 for(const form of document.querySelectorAll('[data-action=logout]'))form.addEventListener('submit',async event=>{
  event.preventDefault();await api('/auth/logout',{method:'POST'});location.assign('/home');
 });
}
export function status(id,message,error=false){
 const element=byId(id);if(!element)return;
 element.textContent=message;element.hidden=!message;element.classList.toggle('text-danger',error);
}
