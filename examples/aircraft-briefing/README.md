# Aero — aircraft briefing API demo

Preview: https://ride.qroadscan.com/demo/aircraft

The hosted preview uses **fictional illustrative fixtures**, not observations. Wind samples are labeled illustrative and have no observation time. Missing airport weather, surveillance and fuel assumptions stay visible. There are no clearance, separation, conflict-detection or flight-readiness decisions. This is not ATC, collision avoidance or a verified flight route.

## Run locally

Node.js 22+, no dependencies. From the repository root:

```sh
node examples/aircraft-briefing/server.mjs
```

Open **http://127.0.0.1:8901** exactly. For live mode, configure `QRS_API_KEY` with `aviation:review` and `QRS_DEMO_AIRCRAFT_ID` with an owned aircraft profile UUID on your server before starting. The local server posts the fixed KGSP–KAVL scenario to `POST /api/v1/aviation/briefing`. It assumes no usable-fuel quantity; aircraft assumptions come from your own profile. Missing inputs leave the scenario incomplete. Provider availability and aviation AI/request quotas apply separately from road scan trials; operator provider costs may still apply.

The UI reads `snapshot` and `briefing`: surveillance availability, airport observations, wind validity/provenance, fuel-scenario completeness and human-review checks. No traffic shown is not clear airspace. Forecast pressure levels are approximations, not measured flight-level winds. Consult official briefings, current charts/NOTAMs, aircraft limitations and responsible pilot/dispatcher/ATC decisions.

The server binds only to loopback, checks Host/Origin, uses a static allowlist, limits request/response sizes, permits one in-flight request and at most three new upstream attempts per process, and keeps credentials private. Results are cached only in memory. The aviation API does not promise idempotency: after a transport error the local operation is uncertain and not resent automatically. Restarting loses the cache; do not blindly restart/retry uncertain aviation work. This is not a durable job system or a spending cap.

For production, add authenticated users, ownership, durable operation storage and budget/session protections. Hosted previews have no live proxy, live aircraft monitoring, GPS or operational flight-control functions.
