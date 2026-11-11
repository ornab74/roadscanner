# Cloudflare deployment migration

The new Worker/Container release is implemented under `cloudflare/`; see
`cloudflare/DEPLOYMENT.md` for deployment and validation. It supports the core
account/API/scanner workflow with payments disabled, English TinyLlama inference,
private encrypted report storage, maps, and radar imagery. Existing encrypted
SQLite data and the remaining Flask features have not all been migrated.
The architecture and gates below also describe the remaining migration work.

## Target architecture

* A Worker serves the public API and static UI and validates requests before
  reaching private services. Cloudflare Access can protect administrative routes.
* D1 stores users, API key hashes, credit balances, idempotency records, Stripe
  event IDs and the credit ledger. Credit reservation, settlement and webhook
  deduplication must be atomic; test actual D1 transaction semantics before use.
* A private R2 bucket stores encrypted reports and model artifacts. Never expose
  model or user data through a public bucket. Define retention and backups.
* Cloudflare Containers runs the llama-cpp-python inference service. The Worker
  is its only caller. Authenticate each request and response, restrict request
  sizes, and verify the model digest before loading it. Container disk is
  ephemeral: provision a verified model on startup and account for cold starts.
* Stripe webhooks terminate at the Worker and are verified against the raw body.
  RainViewer remains an external imagery provider; its images are not forecasts.

## Migration gates

1. Inventory existing encrypted SQLite data and establish a tested backup and
   restore procedure. Do not overwrite the source database during migration.
2. Design and test D1 migrations and atomic billing operations, including
   duplicate and out-of-order Stripe events, concurrent reservations and refunds.
3. Port authentication, sessions, CSRF protection, API authorization, scans,
   administration and the user interface. Preserve existing API contracts.
4. Build the scanner container for Cloudflare Containers, validate resource
   limits, model licensing and startup time, and verify the DiskCache mitigation.
5. Configure secrets with Cloudflare's secret store, a private R2 bucket, D1,
   a custom domain and Stripe test-mode webhook. Never commit credentials.
6. Run end-to-end tests against a staging deployment, including payment retries,
   credit reconciliation, data migration, model failure and recovery. Only then
   switch DNS and Stripe to production after a rollback rehearsal.

The previous Docker/Tunnel guide remains applicable only to the existing server
deployment. No Cloudflare resources or account credentials are configured by this
document.
