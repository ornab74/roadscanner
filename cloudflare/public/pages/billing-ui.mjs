import {api,byId,requireSession,status} from './common.mjs';
export async function billingUI(){
 const host=byId('billing');if(!host)return;
 const message=(text,error=false)=>status('billingMessage',text,error);
 async function refresh(){
  const info=await api('/api/billing');host.hidden=!info.available;if(!info.available)return;
  byId('billingNote').textContent='Approved sandbox tester · no real payments';
  byId('billingPolicy').textContent='Stripe test mode. Fixture prices are for testing only. No automatic overage charges. '+info.monthly_credit_policy;
  byId('billingProducts').replaceChildren();
  for(const product of info.products){const card=document.createElement('article'),title=document.createElement('h3'),price=document.createElement('p'),button=document.createElement('button');card.className='billing-product';title.textContent=product.kind==='credits'?'Test credit pack':'Test monthly plan';price.textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:product.currency}).format(product.amount/100)+(product.interval?' / month':'')+' · '+product.credits+' credits';button.type='button';button.className='primary';button.dataset.billingProduct=product.kind;button.textContent=product.kind==='credits'?'Test purchase':'Test subscription';button.disabled=info.restricted;
   button.onclick=async()=>{button.disabled=true;try{const result=await api('/api/billing/checkout',{method:'POST',body:JSON.stringify({product:product.kind})});const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw Error('Unexpected checkout destination.');location.assign(url.href);}catch(error){message(error.message,true);button.disabled=false;}};
   card.append(title,price,button);byId('billingProducts').append(card);
  }
  byId('billingPortal').disabled=!info.portal_available;
  byId('billingSubscriptions').textContent=info.subscriptions.length?info.subscriptions.map(s=>'Subscription: '+s.status).join(' · '):'No test subscription yet.';
  if(info.restricted)message('Billing requires review. Further paid work is paused; existing reports remain accessible.',true);
  const user=await requireSession();if(user)byId('planDetails').textContent=user.plan+' · '+user.api_credits+' credits';
 }
 byId('billingRefresh').onclick=()=>refresh().then(()=>message('Credits and subscription status refreshed.')).catch(e=>message(e.message,true));
 byId('billingPortal').onclick=async()=>{const button=byId('billingPortal');button.disabled=true;try{const result=await api('/api/billing/portal',{method:'POST',body:'{}'});const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='billing.stripe.com')throw Error('Unexpected billing destination.');location.assign(url.href);}catch(e){message(e.message,true);button.disabled=false;}};
 await refresh();const result=new URL(location.href).searchParams.get('billing');if(result==='success')message('Test checkout returned successfully. Only a verified Stripe webhook grants credits; use Refresh if processing is still pending.');else if(result==='cancelled')message('Checkout canceled. No credits were granted by this return page.');
}
