import {api,bindLogout,session} from './common.mjs';
bindLogout();
session().then(user=>{
 if(!user)return;
 for(const a of document.querySelectorAll('nav a[href="/login"],nav a[href="/register"]'))(a.closest('li')??a).hidden=true;
 const nav=document.querySelector('nav .navbar-nav');
 if(nav){
  const item=document.createElement('li');item.className='nav-item';const a=document.createElement('a');a.href='/dashboard';a.className='nav-link';a.textContent='Dashboard';item.append(a);nav.append(item);
  const logoutItem=document.createElement('li');logoutItem.className='nav-item';const button=document.createElement('button');button.type='button';button.className='nav-link btn btn-link';button.textContent='Logout';button.onclick=async()=>{await api('/auth/logout',{method:'POST'});location.assign('/home');};logoutItem.append(button);nav.append(logoutItem);
 }
}).catch(()=>{});
