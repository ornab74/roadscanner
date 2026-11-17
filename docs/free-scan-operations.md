# Capped registration and free scan operations

The public trial allows five browser scene/route attempts per account per UTC day and three API scene/route attempts per account lifetime. Both channels share ceilings of 50 free attempts per UTC day and 500 per UTC month. Paid balances remain separate and Stripe remains disabled.

`0019_free_allowances.sql` installs the policy disabled. Deployment activates the singleton `free_scan_policy` row only after the new Worker is deployed. The operator registration environment switch and the site's registration setting must both allow signup.

The `reserve_credit` database trigger admits free work, records its channel and UTC window, and otherwise checks/debits paid credits in the same statement. The existing key-validity, account-restriction and idempotency controls remain active. Failed/expired free work stays counted; refunds never mint paid credits for a free reservation. Historical usage must not be deleted to refill an account's API trial. Creating more keys does not refill it.

Authorized operators can pause all free admission immediately with:

```sql
UPDATE free_scan_policy SET enabled=0 WHERE id=1;
```

To re-enable the approved policy:

```sql
UPDATE free_scan_policy SET enabled=1,web_daily=5,api_lifetime=3,
 global_daily=50,global_monthly=500 WHERE id=1;
```

The policy can be lowered through these columns; schema CHECK constraints prevent increasing the approved ceilings accidentally. Closing registration uses `REGISTRATION_ENABLED=false` plus a Worker deployment, or the admin registration setting; pausing free scans does not by itself close signup or prevent spending existing paid balances.

The shared attempt caps do not include homepage previews, speech, image generation or aviation reviews, which retain their own controls. They do not guarantee a Cloudflare or AI-provider dollar invoice limit. Existing Workers/Durable Objects shutoffs and the application R2 budget are independent protections.

Account responses expose paid credits, API availability, browser availability and trial limits separately. API and browser totals overlap in paid funds and must not be summed. UI checks are informative; database reservation is authoritative when users submit concurrently.
