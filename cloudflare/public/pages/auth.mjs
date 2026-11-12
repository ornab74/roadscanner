import {api,byId,session,status} from './common.mjs';
const form=byId('authForm'), mode=form.dataset.mode, email=form.elements.email, password=form.elements.password;
const submit=form.querySelector('[type=submit]');
const setLabel=value=>{if(submit.tagName==='INPUT')submit.value=value;else submit.textContent=value;};
const originalLabel=mode==='register'?'Create account':'Login';
const error=message=>{byId('authError').classList.remove('text-success');status('authError',message,true);};
if(mode==='login'&&new URLSearchParams(location.search).has('registered')){
 byId('authError').classList.add('text-success');status('authError','Account created. Log in to continue.');
 email.value=sessionStorage.getItem('qrs-signup-email')??'';sessionStorage.removeItem('qrs-signup-email');
}
password.addEventListener('input',()=>{
 const rule=byId('rule-len');if(rule){const valid=password.value.length>=12;rule.classList.toggle('ok',valid);rule.classList.toggle('bad',!valid);}
});
form.addEventListener('submit',async event=>{
 event.preventDefault();status('authError','');
 if(!email.value.trim()||email.validity.typeMismatch){error('Enter a valid email address.');email.focus();return;}
 if(password.value.length<12||password.value.length>256){error('Use a password with 12–256 characters.');password.focus();return;}
 submit.disabled=true;setLabel(mode==='register'?'Creating account…':'Logging in…');
 try{
  await api(mode==='register'?'/auth/register':'/auth/login',{method:'POST',body:JSON.stringify({email:email.value.trim(),password:password.value})});
  if(mode==='register'){
   sessionStorage.setItem('qrs-signup-email',email.value.trim());password.value='';location.assign('/login?registered=1');
  }else{
   const next=new URLSearchParams(location.search).get('next');
   location.assign(['/dashboard','/settings/user','/radar'].includes(next)?next:'/dashboard');
  }
 }catch(e){error(e.message);}finally{submit.disabled=false;setLabel(originalLabel);}
});
if(mode==='register')api('/api/config').then(config=>{if(!config.registration_enabled){submit.disabled=true;error('Registration is currently closed.');}}).catch(()=>error('Unable to check registration availability. Please reload the page.'));
session().then(user=>{if(user)location.replace('/dashboard');}).catch(()=>{});
if(mode==='login'){
 const button=byId('passkeySignIn');if(button)button.onclick=async()=>{button.disabled=true;try{const {startAuthentication}=await import('/vendor/webauthn.mjs'),options=await api('/auth/passkey/options',{method:'POST',body:'{}'}),response=await startAuthentication({optionsJSON:options.options});await api('/auth/passkey/verify',{method:'POST',body:JSON.stringify({challenge_id:options.challenge_id,response})});location.assign('/dashboard');}catch(e){error(e.message);}finally{button.disabled=false;}};
}
