import test from 'node:test';import assert from 'node:assert/strict';
import Stripe from '../cloudflare/node_modules/stripe/esm/stripe.esm.node.js';
import {fixture} from './fixtures/account-worker.mjs';
import {billingRoutes,billingWebhook,processBillingEvent,sandboxConfigured} from '../cloudflare/billing.mjs';
const config={BILLING_MODE:'test',STRIPE_SECRET_KEY:'sk_test_fixture_only',STRIPE_WEBHOOK_SECRET:'whsec_fixture_only',STRIPE_PRICE_CREDITS:'price_pack',STRIPE_PRICE_PRO:'price_month',QRS_CREDIT_PACK_SIZE:'100',QRS_PRO_MONTHLY_CREDITS:'1000'};
const event=(id,type,object)=>({id:'evt_'+id.replace(/^evt_/,'').replaceAll('_',''),type,data:{object},livemode:false,created:Math.floor(Date.now()/1000)});
const credit=f=>f.DB.prepare("SELECT credits,plan FROM accounts WHERE user_id='owner'").first();
async function prepare(){const f=await fixture();Object.assign(f.env,config);await f.DB.prepare('INSERT INTO billing_test_access VALUES (?,?)').bind('owner',1).run();await f.DB.prepare('INSERT INTO billing_customers VALUES (?,?,?)').bind('owner','cus_owner',1).run();await f.DB.prepare('INSERT INTO billing_catalog VALUES (?,?,?)').bind('price_month','pro',1000).run();return f;}
const session={id:'cs_pack',livemode:false,customer:'cus_owner',client_reference_id:'order_pack',mode:'payment',payment_status:'paid',status:'complete',line_items:{data:[{price:{id:'price_pack'},quantity:1}],has_more:false}};
test('signed sandbox payments grant credits once across duplicates and async-success events',async()=>{
 const f=await prepare();try{
  await f.DB.prepare("INSERT INTO billing_orders VALUES (?,?,?,?,?,?,?,'open',?)").bind('order_pack','owner','credits','price_pack',100,'cus_owner','cs_pack',1).run();
  const client={checkout:{sessions:{retrieve:async()=>session}}};
  await processBillingEvent(f.env,event('evt_one','checkout.session.completed',{id:'cs_pack'}),client);await processBillingEvent(f.env,event('evt_one','checkout.session.completed',{id:'cs_pack'}),client);await processBillingEvent(f.env,event('evt_two','checkout.session.async_payment_succeeded',{id:'cs_pack'}),client);
  assert.equal((await credit(f)).credits,102);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM billing_grants').first()).n,1);
  const other={...session,id:'cs_bad',customer:'cus_other'};
  // A mismatching owner/customer may never turn a signed event into a grant.
  await f.DB.prepare("UPDATE billing_orders SET session_id='cs_bad' WHERE id='order_pack'").run();
  await assert.rejects(processBillingEvent(f.env,event('evt_bad','checkout.session.completed',{id:'cs_bad'}),{checkout:{sessions:{retrieve:async()=>other}}}),/mismatch/);assert.equal((await credit(f)).credits,102);
 }finally{f.close();}
});
test('invoice payment before checkout/subscription delivery grants initial and renewal allowances exactly once',async()=>{
 const f=await prepare();let invoiceID='in_initial';const client={subscriptions:{retrieve:async()=>({id:'sub_owner',livemode:false,customer:'cus_owner',status:'active',items:{data:[{price:{id:'price_month'}}]}})},invoices:{retrieve:async()=>({id:invoiceID,livemode:false,customer:'cus_owner',status:'paid',billing_reason:invoiceID==='in_initial'?'subscription_create':'subscription_cycle',parent:{subscription_details:{subscription:'sub_owner'}}}),listLineItems:async()=>({data:[{quantity:1,pricing:{price_details:{price:'price_month'}}}],has_more:false})}};
 try{await processBillingEvent(f.env,event('evt_invoice','invoice.paid',{id:invoiceID}),client);await processBillingEvent(f.env,event('evt_invoice_again','invoice.paid',{id:invoiceID}),client);assert.equal((await credit(f)).credits,1002);invoiceID='in_renew';await processBillingEvent(f.env,event('evt_renew','invoice.paid',{id:invoiceID}),client);assert.equal((await credit(f)).credits,2002);assert.equal((await credit(f)).plan,'pro');
  client.subscriptions.retrieve=async()=>({id:'sub_owner',livemode:false,customer:'cus_owner',status:'canceled',items:{data:[{price:{id:'price_month'}}]}});await processBillingEvent(f.env,event('evt_cancel','customer.subscription.deleted',{id:'sub_owner'}),client);assert.equal((await credit(f)).plan,'free');assert.equal((await credit(f)).credits,2002);
 }finally{f.close();}
});
test('refund/dispute holds gate paid operations while preserving balances and won-dispute tombstones',async()=>{
 const f=await prepare(),client={charges:{retrieve:async()=>({livemode:false,customer:'cus_owner'})}};try{
  await processBillingEvent(f.env,event('evt_refund','charge.refunded',{id:'ch_owner'}),client);assert.equal((await credit(f)).credits,2);
  const response=await f.request('/api/v1/scans',{method:'POST',headers:{Authorization:'Bearer '+f.key,'Content-Type':'application/json','Idempotency-Key':'billing-held-scan-12345'},body:JSON.stringify({latitude:40,longitude:-74,vehicle_type:'car',destination:'Fixture'})});assert.equal(response.status,403);assert.equal((await response.json()).error,'billing_account_restricted');assert.equal(f.calls(),0);
  await processBillingEvent(f.env,event('evt_won','charge.dispute.closed',{id:'dp_owner',charge:'ch_owner',status:'won'}),client);await processBillingEvent(f.env,event('evt_dispute_late','charge.dispute.created',{id:'dp_owner',charge:'ch_owner'}),client);assert.equal((await f.DB.prepare("SELECT active FROM billing_holds WHERE id='dispute:dp_owner'").first()).active,0);
 }finally{f.close();}
});
test('sandbox guard refuses live keys/events and unsigned or tampered webhooks',async()=>{
 const f=await prepare();try{
  assert.equal(sandboxConfigured({...f.env,STRIPE_SECRET_KEY:'sk_live_fixture'}),false);
  await assert.rejects(processBillingEvent(f.env,{...event('evt_live','invoice.paid',{id:'in_one'}),livemode:true},{}),/mode_mismatch/);
  const sdk=new Stripe('sk_test_fixture_only'),raw=JSON.stringify(event('evt_sig','unhandled.event',{id:'obj_one'})),header=Stripe.webhooks.generateTestHeaderString({payload:raw,secret:config.STRIPE_WEBHOOK_SECRET});
  const good=new Request('https://example.test/billing/webhook',{method:'POST',headers:{'Stripe-Signature':header},body:raw});assert.equal((await billingWebhook(good,f.env,sdk)).status,200);
  await assert.rejects(billingWebhook(new Request('https://example.test/billing/webhook',{method:'POST',headers:{'Stripe-Signature':header},body:raw+' '}),f.env,sdk),/invalid_stripe_signature/);
  const unsigned=await f.request('/billing/webhook',{method:'POST',body:'{}'});assert.equal(unsigned.status,400);assert.equal((await unsigned.json()).error,'invalid_stripe_signature');
 }finally{f.close();}
});
test('checkout is cookie/CSRF protected and not available to ordinary accounts or bearer keys',async()=>{
 const f=await prepare(),helpers={principal:async()=>({user_id:'other',session_hash:'session'}),isAdmin:async()=>false,limit:async()=>{}};try{
  const request=new Request('https://example.test/api/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"product":"credits"}'});
  await assert.rejects(billingRoutes(request,f.env,helpers,{}),e=>e.status===403);
  const noCSRF=await f.request('/api/billing/checkout',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:'{"product":"credits"}'});assert.equal(noCSRF.status,403);
  const api=await f.request('/api/billing',{headers:{Authorization:'Bearer '+f.key}});assert.equal(api.status,401);
 }finally{f.close();}
});
test('checkout uses only server catalog, standard Payments, and refuses duplicate Stripe subscriptions before webhooks',async()=>{
 const f=await prepare(),helpers={principal:async()=>({user_id:'owner',email:'fixture@example.invalid',session_hash:'session'}),isAdmin:async()=>false,limit:async()=>{}};let calls=0;
 const client={prices:{retrieve:async id=>({id,livemode:false,active:true,unit_amount:id==='price_pack'?500:2000,currency:'usd',type:id==='price_pack'?'one_time':'recurring',recurring:id==='price_pack'?null:{interval:'month',interval_count:1}})},subscriptions:{list:async()=>({data:[{status:'active'}],has_more:false})},checkout:{sessions:{create:async(p)=>{calls++;assert.equal(p.line_items[0].price,'price_pack');assert.equal(p.line_items[0].quantity,1);assert.deepEqual(p.managed_payments,{enabled:false});assert.equal(p.payment_method_types,undefined);assert.equal(p.customer,'cus_owner');assert.match(p.integration_identifier,/[a-z]{8}$/);return {id:'cs_created',livemode:false,url:'https://checkout.stripe.com/c/pay/fixture'};}}}};
 const request=kind=>new Request('https://example.test/api/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product:kind})});
 try{await assert.rejects(billingRoutes(request('pro'),f.env,helpers,client),e=>e.status===409);assert.equal(calls,0);const result=await billingRoutes(request('credits'),f.env,helpers,client);assert.equal(result.status,200);assert.equal((await result.json()).mode,'test');assert.equal(calls,1);await assert.rejects(billingRoutes(request('credits'),f.env,helpers,client),e=>e.status===409);assert.equal(calls,1);}finally{f.close();}
});
test('Stripe return landing is public and cannot grant credits or select an external redirect',async()=>{
 const f=await prepare();try{
  f.env.ASSETS={fetch:async r=>new Response(new URL(r.url).pathname,{headers:{'Content-Type':'text/html'}})};
  const response=await f.request('/payment-return?status=success&url=https://attacker.invalid');assert.equal(response.status,200);assert.equal(await response.text(),'/pages/billing-return.html');assert.equal((await credit(f)).credits,2);
  const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm'),source=readFileSync(new URL('../cloudflare/public/pages/billing-return.mjs',import.meta.url),'utf8');
  for(const status of ['success','cancelled','https://attacker.invalid','//attacker.invalid']){let target;runInNewContext(source,{URLSearchParams,location:{search:'?status='+encodeURIComponent(status),replace:v=>{target=v;}}});assert.ok(target.startsWith('/settings/user'));assert.equal(new URL(target,'https://example.test').origin,'https://example.test');}
 }finally{f.close();}
});
