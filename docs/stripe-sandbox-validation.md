# Stripe sandbox acceptance record

Validated 2026-11-13 against the deployed Cloudflare application at
`https://ride.qroadscan.com`. All Stripe writes used the configured test key;
no live payments or live customer objects were created.

## Automated checks

`node --test tests/cloudflare-*.test.mjs`: **128 passed, 0 failed**.

Billing coverage includes signed raw-body webhook handling, rejected live keys and
events, mismatched customers, duplicate payment/event delivery, invoice delivery
before Checkout, subscription renewals/cancellation, billing holds, CSRF and cookie
requirements, fixed catalog parameters, duplicate subscription checks, and the
public return landing's lack of fulfillment/open-redirect behavior.

## Real Stripe test flows

Performed using isolated application accounts, not the owner's credits:

- Opened Stripe-hosted Checkout through the deployed, CSRF-protected application API.
- Paid the USD 5 demonstration pack with Stripe's published 4242 test card.
- Verified the real Stripe webhook inserted exactly one 100-credit grant, increasing
  the isolated account from 1 fixture credit to 101 credits.
- Verified those 101 credits in the deployed Settings UI.
- Created a real sandbox subscription bound to a Stripe test clock. Its initial
  paid invoice increased the account from 1 to 1,001 credits and selected Pro.
- Advanced the test clock through renewal. The paid renewal invoice increased the
  balance to 2,001 credits.
- Canceled the test subscription. Its webhook restored Free and preserved 2,001 credits.
- Created a declined-payment subscription using Stripe's test payment-method token.
  The resulting incomplete subscription left the account Free with no extra credits.
- Resent a real paid-invoice event using Stripe CLI. The balance remained 2,001,
  demonstrating duplicate delivery did not duplicate fulfillment.
- Refunded the test credit-pack charge. The real refund webhook established the
  expected billing review hold on the isolated account.
- Verified the sandbox customer portal redirect and the first-party return flow
  from Stripe back to protected Settings with `SameSite=Strict` cookies intact.

The billing UI loaded without JavaScript exceptions. The existing external
Cloudflare Insights beacon was blocked by the current CSP; billing assets loaded
successfully. No CSP exception or third-party payment script was added to the app.

## Scope and remaining launch decisions

This is a sandbox acceptance record, not live-payment approval. Demonstration
prices and accumulating monthly grants are not final commercial policies. Live
keys/events are rejected in this build. Final prices, monthly expiry/rollover,
refund/review policy, production customer separation, tax registrations and Stripe
business activation must be reviewed before a separate live launch.

The Stripe plugin/planner was unavailable in this environment. The implementation
used the user's authorized official Stripe skills/documentation fallback, the
current Node SDK and direct test-mode Stripe APIs; no planner execution is claimed.
