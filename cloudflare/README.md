# Cloudflare migration status

This directory is not deployable yet. The D1 migrations define the initial
account and reservation invariants; the scanner bridge is an untested adapter
for Cloudflare's Durable Object Container API. It is intentionally not bound to
a public Worker or a Wrangler deployment configuration.

Before enabling it, implement and test the public Worker, request signing,
response verification, model provisioning, authentication, D1/Stripe atomic
event handling, R2 encryption, data migration, and failure recovery. The
scanner image must contain the verified model at `/models` and the patched
DiskCache runtime. Validate container instance type and memory against the
model in a Cloudflare staging account before deploying.
