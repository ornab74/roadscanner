# Haul — truck dispatch API demo

Preview: https://ride.qroadscan.com/demo/truck

The hosted app uses **illustrative fixtures**, not a real truck assessment. It shows supplied profile dimensions, section caution indices, high-attention reviews and unknown clearance/restriction states. Its route diagram is schematic, not a surveyed road layout. No preview action calls an API or spends credits.

## Run locally

Node.js 22+, no dependencies. From the repository root:

```sh
node examples/truck-dispatch/server.mjs
```

Open **http://127.0.0.1:8900** exactly. For live mode, configure `QRS_API_KEY` with `routes:write` and `QRS_DEMO_TRUCK_ID` with an owned truck profile UUID in your server environment before starting. Never put a key into public files or commit it. A live button appears only when both settings exist.

The local server sends the fixed public Fifth Avenue scenario and the owned vehicle ID to `POST /api/v1/routes`. It does not approve that street for a truck. Existing API validation, ownership, feature switches, trial/paid reservations and quotas remain authoritative. The UI reads `segments`, `vehicle.specs` and `truck_turn_review`. Missing data remains unknown; no swept-path, clearance or legal-access claim is inferred.

The shared loopback server has an exact static allowlist and Host/Origin checks, bounded bodies, fixed upstream origin, no redirects, one in-flight request and at most three upstream attempts per process. Successful results are cached per operation ID in memory. Retries preserve the route API's idempotency key; this is not durable state or a dollar spending cap.

This is a teaching app, not a public proxy template. Add your own authentication, ownership, durable operation storage, CSRF/session design and per-user budgets before public hosting. The hosted preview exposes no live proxy.
