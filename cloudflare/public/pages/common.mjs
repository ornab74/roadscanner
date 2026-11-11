export const byId=id=>document.getElementById(id);
export const friendly={
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
 route_analysis_unavailable:'The visual route model could not complete a valid proposal. Your scan credit was refunded. Try clearer imagery or a smaller area.',
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
 const response=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});
 const value=await response.json().catch(()=>({error:'Unable to read the response. Please try again.'}));
 if(!response.ok)throw Object.assign(new Error(friendly[value.error]??value.error??'Request failed. Please try again.'),{status:response.status,code:value.error});
 return value;
}
export async function session(){
 const response=await fetch('/api/session',{credentials:'same-origin'});
 if(response.status===401)return null;
 if(!response.ok)throw new Error('Unable to load your account. Please try again.');
 return response.json();
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
