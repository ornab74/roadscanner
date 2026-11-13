# QRoadScan Stripe integration: sandbox launch

## Current deployment

Stripe billing runs in **test mode only** on `https://ride.qroadscan.com`.
The production website can display the sandbox controls to approved testers,
but cannot accept a live Stripe key or fulfill a live event. Ordinary accounts
cannot buy test credits. This matters because scan credits pay for real AI calls.

The sandbox uses two demonstration products, not approved commercial pricing:

| Product | Test amount | Grant |
| --- | --- | --- |
| Prepaid pack | USD 5.00 | 100 credits after successful payment |
| Monthly plan | USD 20.00 per month | 1,000 credits for each paid initial/renewal invoice |

No automatic usage overages, automatic top-ups, or postpaid usage charges are created.
The existing D1 credit ledger remains the consumption meter. Stripe collects payment,
issues invoices, and manages subscription payment state. New usage-rating products
are outside this change; a future rating-system migration requires a separate plan.

**Monthly expiry/rollover is deliberately not a live policy yet.** Test monthly
allowances accumulate in the existing balance. Cancellation ends the Pro plan but
does not remove previously granted test credits. Do not enable commercial sales
until the allowance, rollover, expiry, refund and cancellation policies are agreed.

## Test through the website

1. Sign in using an approved sandbox tester or administrator account.
2. Open **User Settings → Billing**.
3. Select **Test purchase** or **Test subscription**. Checkout is hosted by Stripe;
   the application never receives card numbers, CVCs or card form submissions.
4. Confirm Stripe displays the **Sandbox** indicator. Use only Stripe test cards,
   such as `4242 4242 4242 4242`, a future expiry, and a test CVC.
5. Complete Checkout. On return, choose **Refresh credits** if the webhook is still
   processing. A success return URL does not itself grant credits. A public first-party landing
   (`/payment-return`) performs a fixed internal navigation to Settings; this preserves
   SameSite=Strict cookies on the cross-site return from Stripe.
6. Open the billing portal to review test invoices, update the payment method, or
   schedule cancellation at period end.

A canceled/expired Checkout grants nothing. A declined payment grants nothing.
An existing open Checkout blocks another for the same product for up to an hour;
Checkout sessions themselves expire after 30 minutes. Do not retry purchases
repeatedly while a payment is pending. Stripe can complete asynchronous payments
later; fulfillment checks the current payment status.

## Application API

These are **browser-session billing APIs**, not bearer-key APIs. The normal API
keys used for scans do not authorize billing. Cookies are Secure/HttpOnly, and all
browser billing POSTs require the application's signed CSRF token and accepted
Origin. Prices, quantities, customer IDs and redirect targets come from the server.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/billing` | Approved tester's catalog, plan state and portal availability |
| POST | `/api/billing/checkout` | Body `{"product":"credits"}` or `{"product":"pro"}`; returns hosted Checkout URL |
| POST | `/api/billing/portal` | Body `{}`; returns this user's portal URL |
| POST | `/billing/webhook` | Stripe-signed raw-body delivery; never call from a browser |

The existing same-origin frontend `api()` helper attaches CSRF automatically:

```javascript
import {api} from '/pages/common.mjs';
const result = await api('/api/billing/checkout', {
  method: 'POST',
  body: JSON.stringify({product: 'credits'}),
});
const target = new URL(result.url);
if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com') {
  throw new Error('Unexpected billing destination');
}
location.assign(target.href);
```

This code runs in an authenticated application page, not a third-party site.
Never copy session cookies, CSRF tokens or Stripe keys into support requests.
There is no endpoint that lets an API caller grant themselves purchased credits.

## Payment and entitlement flow

1. Verify the cookie session, approved test access, CSRF, rate limit and billing holds.
2. Retrieve configured Stripe Prices and verify test mode, currency, interval and activity.
3. Persist an immutable price-to-credit mapping and account-owned Stripe Customer.
4. Reserve a pending order before creating Checkout with a stable idempotency key.
5. Create Checkout using one server-selected Price, quantity one, fixed return URLs,
   and a random integration identifier. Standard Stripe Payments is selected per
   session with `managed_payments.enabled=false`; account-wide settings are untouched.
6. Stripe delivers a signed event. The Worker verifies the exact raw payload,
   signature and timestamp tolerance, then retrieves authoritative Stripe objects.
7. Confirm customer ownership, order reference, Price, quantity and payment status.
8. Atomically record the grant, append the credit ledger and update the account.
   Grant IDs are unique by Checkout session or paid subscription invoice.

A prepaid Checkout grants only on `checkout.session.completed` or
`checkout.session.async_payment_succeeded` with `payment_status=paid`.
A subscription Checkout never grants its own allowance: `invoice.paid` grants
for `subscription_create` and `subscription_cycle` instead. This avoids granting
both Checkout and invoice credits for the same subscription payment.

Subscription/customer ownership is established before Checkout is issued, allowing
invoice delivery to precede Checkout/subscription events. Current Stripe subscription
state is retrieved when synchronizing. Canceled subscriptions cannot be resurrected
by a delayed event. Duplicate events and different success event types for the same
payment cannot duplicate a grant. Database batching keeps fulfillment atomic.

## Webhook endpoint and events

Endpoint: `https://ride.qroadscan.com/billing/webhook`.
API version: `2026-10-28.endive`; Node SDK: `23.0.0`.

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.closed`
- `radar.early_fraud_warning.created`

Only this exact POST route is exempt from browser CSRF because Stripe authenticates
it using its signing secret. Invalid signatures return 400; processing failures
return a retryable 503. The body is limited to 256 KiB. Live events are rejected.
Event logs do not contain raw payment objects, secret values or card details.

Refunds, disputes and early fraud warnings place an account on a billing review
hold. Holds block further credit-reserving work while preserving reports and the
ledger. They do not attempt an automatic refund calculation or negative balance.
A won dispute clears its dispute hold; a durable tombstone prevents a delayed
creation event from reopening it. Other refund/fraud holds require operator review.
Define the commercial review and refund process before live launch.

## Operator configuration

Required Worker secrets/bindings:

- `BILLING_MODE=test`
- `STRIPE_SECRET_KEY`: test secret, preferably a least-privilege restricted `rk_test_` key
- `STRIPE_PUBLISHABLE_KEY`: test public key; hosted redirect Checkout currently does not need it in the browser
- `STRIPE_WEBHOOK_SECRET`: endpoint-specific `whsec_` signing secret
- `STRIPE_PRICE_CREDITS`, `STRIPE_PRICE_PRO`: test Price IDs
- `QRS_CREDIT_PACK_SIZE=100`, `QRS_PRO_MONTHLY_CREDITS=1000`: sandbox fixtures
- `STRIPE_PORTAL_CONFIGURATION`: dedicated test portal configuration

Use secure environment settings or Wrangler secret input; never commit `.env`, key
values, webhook secrets or CLI authentication files. `STRIPE_PUBLISHABLE_KEY` is the
canonical name; `STRIPE_PUBLISH_KEY` is not used by this implementation. A publishable
key is safe for browser usage, but a secret/restricted key and webhook secret are not.

Apply `cloudflare/migrations/0012_stripe_sandbox.sql` before deploying. Operator-only
`billing_test_access` rows approve existing users without giving them administrator
privileges. Do not expose a self-enrollment endpoint. Existing administrators are
approved automatically. Test customer ownership lives in `billing_customers`, separate
from legacy customer IDs. Do not rewrite customer ownership to point to live objects.

Price-to-credit mappings are immutable. To change the credit quantity, create a new
Stripe Price and plan an explicit mapping migration; changing the environment number
for an existing Price fails closed. Application orders, grants, subscriptions and
holds are inspectable in their `billing_*` tables, with no raw card data retained.

## Validation and troubleshooting

Run `node --test tests/cloudflare-*.test.mjs` from the repository root. Billing tests
exercise duplicate payment events, invoice-before-Checkout delivery, renewal,
cancellation, customer mismatch, signature rejection, CSRF/session restrictions,
refund holds and server-owned Checkout parameters.

For a real test Checkout, inspect Stripe's test event delivery log and the matching
application order/grant. Do not manually add credits to conceal webhook failures.
If Checkout returns `billing_provider_unavailable`, inspect the Stripe request log
with an authorized operator; never send a raw provider response to the browser.
A test success redirect with no grant can mean the webhook is pending or failed.

A `checkout_already_open` response prevents duplicate pending purchases. A
`subscription_already_exists` response means local subscription state or the current
Stripe Customer already has an outstanding subscription. A
`billing_account_restricted` response requires operator billing review.

## Required before live launch

Live operation is intentionally unavailable in this build. After sandbox acceptance:

1. Agree real currency, pack prices/credits, monthly price/allowance, rollover/expiry,
   refunds, cancellation behavior and account-level limits.
2. Complete Stripe business/payment activation and review supported payment methods.
3. Select a separate production configuration and customer ownership namespace;
   sandbox grants must never be presented as paid live entitlement.
4. Review registered tax obligations with a qualified adviser. **Automatic tax is not
   enabled and no tax registrations have been verified.** Configure relevant product
   tax codes and active registrations before enabling Stripe Tax. Do not assume that
   switching automatic tax on alone establishes registration or tax collection.
5. Provision a live signing endpoint and least-privilege live restricted key securely.
   Review key access, webhook replay protection and portal configuration.
6. Implement and test the agreed live credit bucket/expiry and refund policies,
   migration, reconciliation, alerting and operational recovery.
7. Obtain explicit launch approval, deploy the reviewed live-mode implementation,
   then perform a controlled live purchase/refund with the business owner's approval.

Do not bypass the current test guard or merely replace the key with `sk_live_`.
