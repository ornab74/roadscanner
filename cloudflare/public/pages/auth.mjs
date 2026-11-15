import {completeSecondFactor} from './second-factor.mjs';
import {api,byId,session,status} from './common.mjs';
const form=byId('authForm'), mode=form.dataset.mode, email=form.elements.email, password=form.elements.password;
const submit=form.querySelector('[type=submit]');let secondFactorPending=false;
const setLabel=value=>{if(submit.tagName==='INPUT')submit.value=value;else submit.textContent=value;};
const originalLabel=mode==='register'?'Create account':'Login';
const finishLogin=()=>{const next=new URLSearchParams(location.search).get('next');location.assign(['/dashboard','/settings/user','/radar','/admin','/aircraft'].includes(next)?next:'/dashboard');};
const resetFactor=()=>{secondFactorPending=false;email.readOnly=false;password.disabled=false;password.value='';byId('passkeySignIn')?.setAttribute('hidden','');byId('cancelSecondFactor')?.setAttribute('hidden','');setLabel(originalLabel);};
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
 if(secondFactorPending){submit.disabled=true;try{await completeSecondFactor();finishLogin();}catch(e){error(e.message);}finally{submit.disabled=false;}return;}
 if(!email.value.trim()||email.validity.typeMismatch){error('Enter a valid email address.');email.focus();return;}
 if(password.value.length<12||password.value.length>256){error('Use a password with 12–256 characters.');password.focus();return;}
 if(mode==='register'&&!byId('acceptTerms').checked){error('Read and accept the Terms of Service to create an account.');byId('acceptTerms').focus();return;}
 submit.disabled=true;setLabel(mode==='register'?'Creating account…':'Logging in…');
 try{
  const result=await api(mode==='register'?'/auth/register':'/auth/login',{method:'POST',body:JSON.stringify({email:email.value.trim(),password:password.value,...(mode==='register'?{accept_terms:byId('acceptTerms').checked,terms_version:form.dataset.termsVersion,terms_sha256:form.dataset.termsSha256}:{})})});
  if(mode==='register'){
   sessionStorage.setItem('qrs-signup-email',email.value.trim());password.value='';location.assign('/login?registered=1');
  }else{
   if(result.mfa_required){secondFactorPending=true;email.readOnly=true;password.disabled=true;password.value='';byId('passkeySignIn').hidden=false;byId('cancelSecondFactor').hidden=false;setLabel('Verify security key');status('authError','Password accepted. Use your enrolled security key to finish signing in.');try{await completeSecondFactor();finishLogin();}catch(e){error(e.message);}}else finishLogin();
  }
 }catch(e){error(e.message);}finally{submit.disabled=false;setLabel(secondFactorPending?'Verify security key':originalLabel);}
});
if(mode==='register')api('/api/config').then(config=>{if(!config.registration_enabled){submit.disabled=true;error('Registration is currently closed.');}}).catch(()=>error('Unable to check registration availability. Please reload the page.'));
session().then(user=>{if(user)location.replace('/dashboard');}).catch(()=>{});
if(mode==='login'){
 const button=byId('passkeySignIn');if(button)button.onclick=async()=>{button.disabled=true;try{await completeSecondFactor();finishLogin();}catch(e){error(e.message);}finally{button.disabled=false;}};
 const cancel=byId('cancelSecondFactor');if(cancel)cancel.onclick=async()=>{cancel.disabled=true;try{await api('/auth/passkey/cancel',{method:'POST',body:'{}'});resetFactor();status('authError','Enter your email and password to start again.');password.focus();}catch(e){error(e.message);}finally{cancel.disabled=false;}};
 if(new URLSearchParams(location.search).has('security_changed'))status('authError','Your security-key settings changed. Sign in again; accounts with an enrolled key require both password and key.');
}
