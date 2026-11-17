# Parcel — delivery-driver API demo

A small fictional delivery workflow using QRoadScan's destination-approach risk API. Includes the route diagram, caution card, proposed instructions, mock order completion and explicit unknown/context-only states.

## Preview

Open https://ride.qroadscan.com/demo/delivery. It displays a recorded real API response from public Fifth Avenue endpoints. No registration, API key or model call is required. Mock outcome controls do not call the API.

## Local setup

Requires Node.js 22+. No dependencies:

```sh
cd examples/delivery-driver
node server.mjs
```

Open **http://127.0.0.1:8899** exactly. The example binds only to loopback and rejects other Host headers.

For live API calls, configure `QRS_API_KEY` securely in your server environment before starting. Use an expiring QRoadScan key with `routes:write`, not an OpenAI or Cloudflare key. Do not put a key into the public files or commit it. A live button then appears.

`POST /api/demo/route` on the local server accepts only an idempotency UUID. The server supplies the fixed public journey and forwards to `POST https://ride.qroadscan.com/api/v1/routes`. The browser never receives the key. Successful results are cached per operation; pending requests do not start parallel work. There is a local maximum of three new upstream attempts per process. Retry with the same operation ID. Paid credits and free trials remain governed by QRoadScan's limits; the local guard is not a dollar spending cap.

## What it demonstrates

- `endpoint_inspections.destination.adjacent_section_risk_score`: modeled approach index, with null preserved as unknown.
- `route_geojson`: schematic SVG ribbon derived from the returned coordinates. Decorative blocks are not a real basemap.
- `steps`: model-proposed driver instructions and section-level scores.
- `risk_summary`: returned score coverage, without implying accident probability.
- Unsupported routes: clear the ribbon and instructions instead of retaining a previous route.
- Mock delivery completion: updates only this browser page, without a dispatch backend.

The driver, order and delivery status are fictional. The recorded route is real API output, not verified navigation or a driveway inspection. There is no GPS tracking, live traffic or real dispatch service. Mock response states are labeled.

The local server uses a strict static-file allowlist, exact loopback Host/Origin checks for mutations, bounded request/response sizes, a fixed upstream origin and no redirects. It intentionally has no public-hosting support. For production, add application authentication, ownership, durable idempotency, CSRF/session protections and per-user budgets before exposing any server-side API proxy.
