import Stripe from 'stripe';
import {readJSON} from './security.mjs';
import {boundedBody} from './internal-auth.mjs';
const VERSION='2026-10-28.endive',now=()=>Math.floor(Date.now()/1000);
const q=(e,s,...a)=>e.DB.prepare(s).bind(...a),fail=(m,s=400)=>{throw Object.assign(new Error(m),{status:s});};
const json=(d,s=200)=>Response.json(d,{status:s,headers:{'Cache-Control':'no-store'}});
const events=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','charge.refunded','charge.dispute.created','charge.dispute.closed','radar.early_fraud_warning.created']);
export function sandboxConfigured(env){return env.BILLING_MODE==='test'&&/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY??'')&&!!env.STRIPE_WEBHOOK_SECRET&&/^price_[A-Za-z0-9]+$/.test(env.STRIPE_PRICE_CREDITS??'')&&/^price_[A-Za-z0-9]+$/.test(env.STRIPE_PRICE_PRO??'');}
export function stripeClient(env){if(env.BILLING_MODE!=='test'||! /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY??''))fail('payments_disabled',503);return new Stripe(env.STRIPE_SECRET_KEY,{apiVersion:VERSION,httpClient:Stripe.createFetchHttpClient(),maxNetworkRetries:1,timeout:20000});}
function allowance(env,kind){const n=Number(kind==='credits'?env.QRS_CREDIT_PACK_SIZE:env.QRS_PRO_MONTHLY_CREDITS);if(!Number.isSafeInteger(n)||n<1||n>1000000)fail('billing_catalog_invalid',503);return n;}
async function catalog(env,client){const list=[];for(const kind of ['credits','pro']){const price=await client.prices.retrieve(kind==='credits'?env.STRIPE_PRICE_CREDITS:env.STRIPE_PRICE_PRO);if(price.livemode!==false||!price.active||!Number.isSafeInteger(price.unit_amount)||price.unit_amount<=0||price.currency!=='usd'||price.type!==(kind==='credits'?'one_time':'recurring')||kind==='pro'&&(price.recurring?.interval!=='month'||price.recurring.interval_count!==1))fail('billing_catalog_invalid',503);const credits=allowance(env,kind);await q(env,'INSERT OR IGNORE INTO billing_catalog(price_id,product,credits) VALUES (?,?,?)',price.id,kind,credits).run();const saved=await q(env,'SELECT credits,product FROM billing_catalog WHERE price_id=?',price.id).first();if(saved.credits!==credits||saved.product!==kind)fail('billing_catalog_invalid',503);list.push({kind,price_id:price.id,amount:price.unit_amount,currency:price.currency,credits:allowance(env,kind),interval:kind==='pro'?'month':null});}return list;}
async function allowed(env,p,isAdmin){return await isAdmin(env,p.user_id)||!!await q(env,'SELECT user_id FROM billing_test_access WHERE user_id=?',p.user_id).first();}
function safeURL(value,host){let u;try{u=new URL(value);}catch{fail('billing_provider_unavailable',503);}if(u.protocol!=='https:'||u.hostname!==host||u.username||u.password||u.port)fail('billing_provider_unavailable',503);return u.href;}
async function customer(env,p,client){let row=await q(env,'SELECT customer_id FROM billing_customers WHERE user_id=?',p.user_id).first();if(row)return row.customer_id;const created=await client.customers.create({email:p.email,description:'QRS approved sandbox tester'},{idempotencyKey:'qrs-test-customer:'+p.user_id});if(created.livemode!==false)fail('billing_mode_mismatch',503);await q(env,'INSERT OR IGNORE INTO billing_customers(user_id,customer_id,created_at) VALUES (?,?,?)',p.user_id,created.id,now()).run();row=await q(env,'SELECT customer_id FROM billing_customers WHERE user_id=?',p.user_id).first();if(row?.customer_id!==created.id)fail('billing_customer_conflict',409);return row.customer_id;}
async function owner(env,customerID){const id=typeof customerID==='string'?customerID:customerID?.id;return id?await q(env,'SELECT user_id,customer_id FROM billing_customers WHERE customer_id=?',id).first():null;}
async function syncSubscription(env,client,id,eventCreated){const sub=await client.subscriptions.retrieve(id);if(sub.livemode!==false)fail('billing_mode_mismatch',400);const user=await owner(env,sub.customer);if(!user)return [];
 const ours=(sub.items?.data??[]).some(item=>item.price?.id===env.STRIPE_PRICE_PRO);if(!ours)return [];
 return [q(env,`INSERT INTO billing_subscriptions(id,user_id,customer_id,status,event_created,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,event_created=excluded.event_created,updated_at=excluded.updated_at WHERE billing_subscriptions.user_id=excluded.user_id AND billing_subscriptions.customer_id=excluded.customer_id AND billing_subscriptions.status!='canceled' AND excluded.event_created>=billing_subscriptions.event_created`,sub.id,user.user_id,user.customer_id,sub.status,eventCreated,now()),q(env,"UPDATE accounts SET plan=CASE WHEN EXISTS(SELECT 1 FROM billing_subscriptions WHERE user_id=? AND status IN ('active','trialing')) THEN 'pro' ELSE 'free' END,updated_at=? WHERE user_id=?",user.user_id,now(),user.user_id)];
}
export async function processBillingEvent(env,event,client){
 if(event.livemode!==false)fail('billing_mode_mismatch',400);if(!/^evt_[A-Za-z0-9]+$/.test(event.id??'')||!Number.isSafeInteger(event.created)||event.created<=0)fail('invalid_stripe_event');
 if(!events.has(event.type))return {ignored:true};if(await q(env,'SELECT id FROM billing_events WHERE id=?',event.id).first())return {replayed:true};
 const object=event.data?.object;if(!object||typeof object.id!=='string')fail('invalid_stripe_event');let statements=[];
 if(event.type.startsWith('checkout.session.')){
  const session=await client.checkout.sessions.retrieve(object.id,{expand:['line_items']});if(session.livemode!==false)fail('billing_mode_mismatch');
  const order=await q(env,'SELECT * FROM billing_orders WHERE session_id=?',session.id).first();if(order){
   const cid=typeof session.customer==='string'?session.customer:session.customer?.id;
   if(cid!==order.customer_id||session.client_reference_id!==order.id||session.mode!==(order.product==='credits'?'payment':'subscription'))fail('billing_order_mismatch');
   const lines=session.line_items?.data??[];if(lines.length!==1||session.line_items?.has_more||lines[0].price?.id!==order.price_id||lines[0].quantity!==1)fail('billing_order_mismatch');
   statements.push(q(env,'UPDATE billing_orders SET status=? WHERE id=?',session.payment_status==='paid'?'paid':session.status??'pending',order.id));
   if(order.product==='credits'&&session.payment_status==='paid'&&['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))statements.push(q(env,'INSERT OR IGNORE INTO billing_grants(id,user_id,source,credits,created_at) VALUES (?,?,?,?,?)','checkout:'+session.id,order.user_id,'prepaid_purchase',order.credits,now()));
  }
 }else if(event.type==='invoice.paid'||event.type==='invoice.payment_failed'){
  const invoice=await client.invoices.retrieve(object.id);if(invoice.livemode!==false)fail('billing_mode_mismatch');const user=await owner(env,invoice.customer);
  if(user){const subID=invoice.parent?.subscription_details?.subscription??invoice.subscription;const sid=typeof subID==='string'?subID:subID?.id;
   if(sid){statements.push(...await syncSubscription(env,client,sid,event.created));
    if(event.type==='invoice.paid'&&invoice.status==='paid'&&['subscription_create','subscription_cycle'].includes(invoice.billing_reason)){
     const lines=await client.invoices.listLineItems(invoice.id,{limit:100});const matches=lines.data.filter(l=>(l.pricing?.price_details?.price??l.price?.id)===env.STRIPE_PRICE_PRO&&l.quantity===1);if(lines.has_more)fail('billing_invoice_too_large',503);
     const grant=await q(env,'SELECT credits FROM billing_catalog WHERE price_id=? AND product=?',env.STRIPE_PRICE_PRO,'pro').first();if(matches.length===1&&!grant)fail('billing_catalog_invalid',503);if(matches.length===1)statements.push(q(env,'INSERT OR IGNORE INTO billing_grants(id,user_id,source,credits,created_at) VALUES (?,?,?,?,?)','invoice:'+invoice.id,user.user_id,'monthly_paid_allowance',grant.credits,now()));
    }
   }
  }
 }else if(event.type.startsWith('customer.subscription.'))statements.push(...await syncSubscription(env,client,object.id,event.created));
 else{
  let charge;if(event.type.startsWith('charge.dispute.'))charge=await client.charges.retrieve(typeof object.charge==='string'?object.charge:object.charge?.id);else if(event.type==='radar.early_fraud_warning.created')charge=await client.charges.retrieve(object.charge);else charge=await client.charges.retrieve(object.id);
  if(charge.livemode!==false)fail('billing_mode_mismatch');const user=await owner(env,charge.customer);
  if(user){if(event.type==='charge.dispute.closed'&&object.status==='won')statements.push(q(env,"INSERT INTO billing_holds(id,user_id,reason,active,created_at) VALUES (?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET active=0 WHERE billing_holds.user_id=excluded.user_id",'dispute:'+object.id,user.user_id,'charge.dispute.closed',now()));else if(event.type!=='charge.dispute.closed')statements.push(q(env,'INSERT OR IGNORE INTO billing_holds(id,user_id,reason,created_at) VALUES (?,?,?,?)',(event.type.startsWith('charge.dispute.')?'dispute:':'risk:')+object.id,user.user_id,event.type,now()));}
 }
 statements.push(q(env,'INSERT OR IGNORE INTO billing_events(id,type,created_at,processed_at) VALUES (?,?,?,?)',event.id,event.type,event.created,now()));
 await env.DB.batch(statements);return {processed:true};
}
export async function billingWebhook(request,env,clientOverride){
 if(!sandboxConfigured(env))fail('payments_disabled',503);const client=clientOverride??stripeClient(env),bytes=await boundedBody(request.body,262144);let event;
 try{event=await client.webhooks.constructEventAsync(new TextDecoder('utf-8',{fatal:true}).decode(bytes),request.headers.get('Stripe-Signature'),env.STRIPE_WEBHOOK_SECRET,300,Stripe.createSubtleCryptoProvider());}catch{fail('invalid_stripe_signature');}
 try{return json(await processBillingEvent(env,event,client));}catch(error){if(error.status===400)throw error;console.error('billing_webhook_failed',/^evt_[A-Za-z0-9]+$/.test(event.id??'')?event.id:'invalid_event');fail('billing_processing_failed',503);}
}
export async function billingRoutes(request,env,helpers,clientOverride){
 const url=new URL(request.url);if(!url.pathname.startsWith('/api/billing'))return null;
 const p=await helpers.principal(request,env);if(!p.session_hash)fail('login_required',401);
 const configured=sandboxConfigured(env),access=configured&&await allowed(env,p,helpers.isAdmin);
 if(url.pathname==='/api/billing'&&request.method==='GET'){
  if(!access)return json({available:false,mode:'disabled'});
  const client=clientOverride??stripeClient(env);let products;try{products=await catalog(env,client);}catch{fail('billing_provider_unavailable',503);}
  const linked=await q(env,'SELECT customer_id FROM billing_customers WHERE user_id=?',p.user_id).first(),holds=(await q(env,'SELECT reason FROM billing_holds WHERE user_id=? AND active=1',p.user_id).all()).results;
  const subscriptions=(await q(env,'SELECT id,status FROM billing_subscriptions WHERE user_id=?',p.user_id).all()).results;
  return json({available:true,mode:'test',products,portal_available:!!linked,subscriptions,restricted:holds.length>0,no_automatic_overages:true,monthly_credit_policy:'Sandbox fixture: paid monthly allowances accumulate; final live rollover/expiry policy is not configured.'});
 }
 if(!access)fail(configured?'stripe_test_access_required':'payments_disabled',configured?403:503);
 if(request.method!=='POST')fail('method_not_allowed',405);await helpers.limit(env,'billing:'+p.user_id,6,300);
 const client=clientOverride??stripeClient(env),body=await readJSON(request,2048);
 if(url.pathname==='/api/billing/checkout'){
  if(!body||Object.keys(body).sort().join(',')!=='product'||!['credits','pro'].includes(body.product))fail('invalid_billing_product');
  if(await q(env,'SELECT id FROM billing_holds WHERE user_id=? AND active=1',p.user_id).first())fail('billing_account_restricted',403);
  await q(env,"UPDATE billing_orders SET status='stale' WHERE user_id=? AND status IN ('creating','open') AND created_at<?",p.user_id,now()-3600).run();
  if(body.product==='pro'&&await q(env,"SELECT id FROM billing_subscriptions WHERE user_id=? AND status IN ('active','trialing','past_due','unpaid','incomplete')",p.user_id).first())fail('subscription_already_exists',409);
  if(await q(env,"SELECT id FROM billing_orders WHERE user_id=? AND product=? AND status IN ('creating','open') AND created_at>?",p.user_id,body.product,now()-3600).first())fail('checkout_already_open',409);
  const product=(await catalog(env,client)).find(c=>c.kind===body.product),cid=await customer(env,p,client),id=crypto.randomUUID();
  if(body.product==='pro'){const existing=await client.subscriptions.list({customer:cid,status:'all',limit:100});if(existing.has_more||existing.data.some(s=>['active','trialing','past_due','unpaid','incomplete','paused'].includes(s.status)))fail('subscription_already_exists',409);}
  try{await q(env,"INSERT INTO billing_orders(id,user_id,product,price_id,credits,customer_id,status,created_at) VALUES (?,?,?,?,?,?,'creating',?)",id,p.user_id,product.kind,product.price_id,product.credits,cid,now()).run();}catch{fail('checkout_already_open',409);}
  try{const session=await client.checkout.sessions.create({managed_payments:{enabled:false},mode:body.product==='credits'?'payment':'subscription',customer:cid,line_items:[{price:product.price_id,quantity:1}],client_reference_id:id,expires_at:now()+1800,success_url:'https://ride.qroadscan.com/payment-return?status=success',cancel_url:'https://ride.qroadscan.com/payment-return?status=cancelled',integration_identifier:'qrs_sandbox_'+[...crypto.getRandomValues(new Uint8Array(8))].map(n=>String.fromCharCode(97+n%26)).join(''),...(body.product==='credits'?{invoice_creation:{enabled:true}}:{subscription_data:{description:'QRS sandbox monthly allowance; no overage billing'}})},{idempotencyKey:'qrs-test-checkout:'+id});
   if(session.livemode!==false)fail('billing_mode_mismatch');const destination=safeURL(session.url,'checkout.stripe.com');await q(env,'UPDATE billing_orders SET session_id=?,status=? WHERE id=?',session.id,'open',id).run();return json({url:destination,mode:'test'});
  }catch{await q(env,"UPDATE billing_orders SET status='creation_failed' WHERE id=? AND status='creating'",id).run();fail('billing_provider_unavailable',503);}
 }
 if(url.pathname==='/api/billing/portal'){
  if(!body||Object.keys(body).length)fail('invalid_billing_request');const row=await q(env,'SELECT customer_id FROM billing_customers WHERE user_id=?',p.user_id).first();if(!row)fail('billing_customer_missing',409);
  try{const session=await client.billingPortal.sessions.create({customer:row.customer_id,configuration:env.STRIPE_PORTAL_CONFIGURATION,return_url:'https://ride.qroadscan.com/payment-return?status=portal'});return json({url:safeURL(session.url,'billing.stripe.com'),mode:'test'});}catch{fail('billing_provider_unavailable',503);}
 }
 fail('not_found',404);
}
