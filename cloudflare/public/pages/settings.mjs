import {billingUI} from './billing-ui.mjs';
import {API_SCOPE_PRESETS} from './api-scopes.mjs';
import {garageUI} from './garage-ui.mjs';
import {api,byId,bindLogout,requireSession,status} from './common.mjs';
import {date,record,action,verified} from './security-ui.mjs';
import {startRegistration} from '/vendor/webauthn.mjs';
bindLogout();let currentKeyID=null;
const message=(m,error=false)=>status('settingsMessage',m,error);
const protect=fn=>async()=>{try{await fn();}catch(e){message(e.message,true);}};
const clearKey=()=>{currentKeyID=null;byId('apiKey').value='';byId('apiKey').type='password';byId('newKeyPanel').hidden=true;byId('showKey').textContent='Show key';};
async function refresh(){
 const user=await requireSession();if(!user)return;byId('accountSummary').textContent=user.email;byId('planDetails').textContent=user.plan+' · '+user.api_credits+' credits';
 const [keys,securityKeys,sessions,activity]=await Promise.all([api('/api/keys'),api('/api/security/keys'),api('/api/security/sessions'),api('/api/security/activity')]);
 byId('keyCount').textContent=String(securityKeys.length);byId('sessionCount').textContent=String(sessions.length);
 byId('keysList').replaceChildren(...keys.map(k=>{const expired=k.expires_at&&k.expires_at<Date.now()/1000,revoked=!!k.revoked_at;return record(k.name+(revoked?' · Revoked':expired?' · Expired':''),'Created '+date(k.created_at)+' · Expires '+(k.expires_at?date(k.expires_at):'No expiry (legacy)')+' · Last used '+date(k.last_used_at)+' · Scopes: '+JSON.parse(k.scopes??'[]').join(', '),!revoked?action('Revoke',protect(async()=>{await verified(()=>api('/api/keys/'+encodeURIComponent(k.id),{method:'DELETE'}));if(currentKeyID===k.id)clearKey();message('API key revoked.');await refresh();})):null);}));
 byId('securityKeysList').replaceChildren(...securityKeys.map(k=>record(k.name,'Added '+date(k.created_at)+' · Last used '+date(k.last_used_at)+(k.backed_up?' · Synced passkey':''),action('Remove',protect(async()=>{await verified(()=>api('/api/security/keys/'+encodeURIComponent(k.id),{method:'DELETE'}));message('Security key removed.');await refresh();})))));
 byId('sessionList').replaceChildren(...sessions.map(s=>record(s.current?'This session':'Other signed-in session','Created '+date(s.created_at)+' · Expires '+date(s.expires_at))));
 byId('activityList').replaceChildren(...activity.map(a=>record(a.action.replaceAll('_',' ').replaceAll('.',' · '),date(a.created_at))));
}
byId('enrollKey').onclick=protect(async()=>{const button=byId('enrollKey');button.disabled=true;try{if(!window.PublicKeyCredential)throw Error('This browser does not support security keys.');const options=await verified(()=>api('/api/security/keys/options',{method:'POST',body:JSON.stringify({name:byId('securityKeyName').value||'Security key'})}));const response=await startRegistration({optionsJSON:options.options});await api('/api/security/keys/verify',{method:'POST',body:JSON.stringify({challenge_id:options.challenge_id,response})});message('Security key added. You can now use it on the sign-in page.');byId('securityKeyName').value='';await refresh();}finally{button.disabled=false;}});
byId('createKey').onclick=protect(async()=>{const b=byId('createKey');b.disabled=true;try{const key=await verified(()=>api('/api/keys',{method:'POST',body:JSON.stringify({name:byId('keyName').value||'API key',expires_in_days:Number(byId('keyExpiry').value),scopes:API_SCOPE_PRESETS[byId('keyScopes').value]})}));clearKey();currentKeyID=key.id;byId('apiKey').value=key.key;byId('newKeyPanel').hidden=false;message('API key created. Copy it now; it is shown only once.');await refresh();}finally{b.disabled=false;}});
byId('showKey').onclick=()=>{const input=byId('apiKey');input.type=input.type==='password'?'text':'password';byId('showKey').textContent=input.type==='password'?'Show key':'Hide key';};
byId('copyKey').onclick=protect(async()=>{await navigator.clipboard.writeText(byId('apiKey').value);message('Key copied.');});byId('dismissKey').onclick=clearKey;
byId('revokeSessions').onclick=protect(async()=>{await verified(()=>api('/api/security/sessions/revoke-others',{method:'POST',body:'{}'}));message('Other sessions signed out.');await refresh();});
byId('passwordForm').onsubmit=async event=>{event.preventDefault();const b=event.target.querySelector('button');b.disabled=true;try{await api('/auth/password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});event.target.reset();location.assign('/login');}catch(e){message(e.message,true);}finally{b.disabled=false;}};
window.addEventListener('pagehide',clearKey);document.addEventListener('visibilitychange',()=>{if(document.hidden){byId('apiKey').type='password';byId('showKey').textContent='Show key';}});
refresh().catch(e=>message(e.message,true));

garageUI().catch(e=>status('garageMessage',e.message,true));

billingUI().catch(e=>status('billingMessage',e.message,true));
