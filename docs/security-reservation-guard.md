# Paid-work credential checks at reservation time

A focused follow-up to the 2026-11-13 security review found an expiry timing gap.
HTTP authentication checked API key expiry, but the atomic database credit-debit
trigger checked ownership and revocation without rechecking expiry. A key could
therefore expire while a request body was being read, yet still start a new paid
operation. This requires a valid authenticated key at admission; it does not let
an unauthenticated caller invent a key or spend another user's balance.

The local reproduction expired a fixture key between HTTP authentication and
reservation. Before the change, the request returned 200 and called the provider.
After the change it returns 401, with zero provider calls, reservations or ledger
entries, and an unchanged credit balance.

Migration `0013_reservation_key_validity.sql` adds a BEFORE INSERT guard for new
reserved operations. Using database time, it verifies that the key exists, belongs
to the operation's user, is not revoked, and has not expired. A failure aborts the
same statement before the credit-debit trigger executes. The existing ownership,
revocation, credit and billing-hold checks remain in place.

Scene scans, visual routes and garage image generation translate the guard failure
into `invalid_api_key` (401). Versioned API responses retain the standard Bearer
challenge and request correlation. Work already reserved before expiry may finish;
this migration does not retroactively cancel provider calls, change existing
balances, remove reports, or alter existing key expiry dates. Revocation was already
checked by the prior debit trigger; the new guard preserves it and improves the
error mapping while closing the missing expiry check.

Apply the migration before deploying the updated Worker. It is additive and does
not rewrite existing records. Tests cover database-time expiry, the exact expiry
boundary, revoked/mismatched keys, valid-key reservations, and credential changes
between authentication and reservation for scans, routes and image generation.

This is a bounded security improvement, not an exhaustive audit. Stripe remains
disabled. No authentication secrets or API key values are included in the patch.

Validation: all **135 Cloudflare tests passed**. After deployment, an isolated live
fixture confirmed a fresh key worked, then the expired-key database reservation
was rejected with `api_key_no_longer_valid`, with no operation row or credit debit.
Expired API access returned 401; normal session access still worked and Stripe
remained disabled. The isolated account and key were removed afterward.
