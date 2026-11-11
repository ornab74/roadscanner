import {api,byId,bindLogout,requireSession,status} from './common.mjs';
bindLogout();
let currentKeyID=null;
async function refresh(){
 const user=await requireSession();if(!user)return;
 byId('accountSummary').textContent=user.email;
 byId('planDetails').textContent=user.plan+' plan · '+user.api_credits+' scan credits';
 const keys=await api('/api/keys');byId('keysList').replaceChildren();
 for(const key of keys.filter(k=>!k.revoked_at)){
  const row=document.createElement('p'),button=document.createElement('button');button.type='button';button.className='btn btn-outline-light btn-sm';button.textContent='Revoke key '+key.id.slice(0,8);
  button.onclick=async()=>{button.disabled=true;try{await api('/api/keys/'+key.id,{method:'DELETE'});if(currentKeyID===key.id){currentKeyID=null;byId('apiKey').value='';byId('apiKey').type='password';byId('copyKey').disabled=true;byId('showKey').disabled=true;byId('showKey').textContent='Show key';}status('settingsMessage','API key revoked.');await refresh();}catch(e){status('settingsMessage',e.message,true);button.disabled=false;}};row.append(button);byId('keysList').append(row);
 }
}
byId('passwordForm').addEventListener('submit',async event=>{
 event.preventDefault();try{await api('/auth/password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});location.assign('/login');}catch(e){status('settingsMessage',e.message,true);}
});
byId('createKey').onclick=async()=>{byId('createKey').disabled=true;try{const key=await api('/api/keys',{method:'POST',body:'{}'});currentKeyID=key.id;byId('apiKey').value=key.key;byId('apiKey').type='password';byId('showKey').textContent='Show key';byId('copyKey').disabled=false;byId('showKey').disabled=false;status('settingsMessage','API key created. Copy it now and store it securely.');await refresh();}catch(e){status('settingsMessage',e.message,true);}finally{byId('createKey').disabled=false;}};
byId('showKey').onclick=()=>{const input=byId('apiKey');input.type=input.type==='password'?'text':'password';byId('showKey').textContent=input.type==='password'?'Show key':'Hide key';};
byId('copyKey').onclick=async()=>{try{await navigator.clipboard.writeText(byId('apiKey').value);status('settingsMessage','Key copied.');}catch{byId('apiKey').type='text';byId('showKey').textContent='Hide key';byId('apiKey').focus();byId('apiKey').select();status('settingsMessage','Select and copy the key manually.');}};
refresh().catch(e=>status('settingsMessage',e.message,true));
