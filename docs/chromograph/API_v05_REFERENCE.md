> Historical v0.5 API reference. V0.6 live account bindings, recent-auth issuance and token reissue requirements supersede its credential-lifecycle limitations. See the current README.

# Roadscanner Chromograph-X v0.5 — owned persistent search + scoped devices

**The complete application is already merged in `main.py`.** All v0.4 search, Palette256, route/weather/radar, external AI and native QRS2 features are retained. V0.5 adds application functionality that was missing: saved owner-isolated record collections, versioned public search metadata, native signature validation, device credentials and retryable IPFS publishing.

No GitHub change, cloud provisioning, real database migration or deployment was performed. New functionality is opt-in and has not passed a complete original-app/native-key staging deployment.

## What's new

- **Persistent owned registry**: a new schema separate from the original app's SQLite database; either Cloudflare D1 through its authenticated REST API or an explicitly initialized local staging SQLite database. No TypeScript required.
- **Saved Palette256 search**: indexes deliberately public RGB/palette/weather/time/tags metadata next to encrypted record version references. Searches no longer require the client to supply candidate records; latest owned records are queried and reranked with explanations. Bounded to the newest 256 candidates with an explicit truncation flag.
- **Scoped device access**: random 256-bit bearer secrets, SHA256 hashes stored server-side, per-device scopes, 1-hour to 7-day expiry, session-controlled issuance/revocation and owner isolation. Credentials cannot mint credentials or run admin publish/maintenance jobs.
- **Retry-safe writes**: `Idempotency-Key`, expected-version compare-and-swap, immutable content hashes and chained version metadata. One SQL statement per state transition; no assumption that a REST batch is transactional.
- **Durable IPFS outbox**: verified QRS2 ciphertext is accepted into a temporary encrypted spool. Explicit queue workers claim a fenced lease, pin ciphertext to IPFS, persist candidate CID, fetch it back, check SHA256, then clear the SQL ciphertext spool. Failures retain ciphertext and retry state with bounded backoff; expired leases can recover.
- **Native trust checks**: accepts QRS2 HY1 with ML-KEM-768 and the app's trusted ML-DSA-65/87 signer; compares the complete trusted public key before native signature verification. No decryption or private-key export.
- **Signed checkpoints**: version heads can be anchored with domain-separated native ML-DSA signatures. Clients must pin a previously trusted key and save prior checkpoints to reason about rollback; a response's self-advertised key alone is not a trust root.
- **Shared durable quotas**: owner/group counters in D1/SQLite, rather than per-process-only counters for the new v3 API. Maintenance prunes old quota windows. These counters add SQL writes and are not free.

Old v1/v2 routes still work. Enabling the registry retires the legacy **shared-token AI relay** by default (HTTP 410); migrate devices to `/api/chromograph/v3/ai/analyze`. An explicitly named migration flag exists, but enabling it preserves the old shared-token risk.

## Quick staging setup

1. Back up current `main.py`, SQLite, sealed keys and configuration. Copy the new `main.py` into a separate checkout of the original Roadscanner repository. Preserve all original assets/dependencies; this package is not the entire upstream repository.
2. Configure a **new registry database**, using one of the paths below. Never run this migration against `secure_data.db` or treat local Container disk as durable.
3. Provision a separate high-entropy `ROADSCANNER_CX_OWNER_KEY` (32+ characters) in your secret manager. It maps the authenticated legacy user ID to a pseudonymous owner namespace. **Back it up and keep it stable**; rotating it without an ownership migration changes record/token namespaces. Do not reuse a QRS2 key, AI key or API bearer token.
4. Set `ROADSCANNER_CX_ENABLED=1` and `ROADSCANNER_CX_REGISTRY_ENABLED=1` only in staging after original login/passkey/crypto tests pass.
5. Test a browser session, CSRF-protected device creation, one genuine QRS2 envelope, owned search, and publish recovery before public rollout.

### D1 path (new native-Container backend)

- Create a new D1 database via the Cloudflare dashboard/CLI. Apply **only** `deploy/0003_owned_registry.sql` to the deliberately selected registry.
- Set `ROADSCANNER_CX_REGISTRY_BACKEND=d1`.
- Set `CLOUDFLARE_ACCOUNT_ID`, `ROADSCANNER_CX_D1_ID`, and secret `ROADSCANNER_CX_D1_TOKEN` (least-privilege D1 read/write token scoped to the intended account/resource).
- V0.5 connects from the native Python Container to Cloudflare's D1 query REST API. It needs no extra Worker for these new v3 registry routes. The earlier Python Worker remains an optional parallel path for the previous bridge APIs.

This REST adapter is intended for modest throughput and incurs API latency / SQL quota usage. A Worker-binding service adapter is a later optimization. Real Cloudflare REST behavior, including result types/RETURNING support for this schema, needs an end-to-end staging test before deployment; tests here use the documented wire contract with a local SQLite execution double.

### Local path (development / explicit staging only)

```bash
python scripts/chromograph_registry_ops.py init-local --database /absolute/new/registry.db
```

The operator tool refuses to overwrite an existing file, creates it with mode 0600 and does not import the application/native keys while initializing it.

Set:

```text
ROADSCANNER_CX_REGISTRY_BACKEND=sqlite
ROADSCANNER_CX_REGISTRY_PATH=/absolute/new/registry.db
```

Cloudflare Container filesystems are ephemeral. This local backend is **not** a substitute for D1 in a scale-to-zero deployment. The application refuses to configure its new registry path as the original `DB_FILE`.

## Device access

An authenticated existing Roadscanner user issues a token with a CSRF-protected browser POST:

`POST /api/chromograph/v3/devices`

```json
{"scopes":["record:read","record:write","search:read"],"ttl_hours":24}
```

The response reveals the new token once. Store it in the mobile platform's secure credential store; never logs, source control or public app configuration. Do not send the OpenAI key, Cloudflare API token or Pinata JWT to clients.

Allowed scopes:

- `record:read` — own record metadata/ciphertext, versions, checkpoint.
- `record:write` — own record creation/revisions/retry requests.
- `search:read` — own persistent public-index search.
- `weather:read` — consented server weather/radar request.
- `route:read` — consented ETA weather exposure request.
- `ai:analyze` — explicitly enabled, consented external AI route analysis.

Use `Authorization: Bearer rsd1.<id>.<secret>` on supported v3 endpoints. An invalid/overscoped bearer never falls back to a cookie session. Cookie-authenticated writes always explicitly validate CSRF; token-only requests do not rely on browser cookies.

Use `GET /api/chromograph/v3/devices` to list credentials, and a session/CSRF POST to `/api/chromograph/v3/devices/<id>/revoke` to revoke one. Tokens cannot perform those lifecycle operations. Account-deletion/password-reset/device-compromise workflows must call revocation before production; they are not yet wired into the legacy account-management routes. A standalone device token remains valid until revocation or expiry.

## Save and search actual encrypted records

`POST /api/chromograph/v3/records` with header `Idempotency-Key: unique-client-operation-001`:

```json
{
  "record_id":"road-hazard-001",
  "expected_version":0,
  "kind":"hazard",
  "public_context":{
    "rgb":"#3388cc",
    "palette":[{"rgb":"#3388cc","weight":3},{"rgb":"#d09040","weight":1}],
    "weather":{"rain_mm":1.2,"wind_gust_kph":25},
    "tags":["wet","road"]
  },
  "public_index_ack":true,
  "envelope":"PQ2.<genuine Roadscanner encrypt_data output>"
}
```

A successful response has `pin_state=pending`: it does **not** claim the object is already published. A revision uses `expected_version` equal to the current version and a new idempotency key. Repeating an identical request/key returns the same record; reusing a key for different data fails with 409.

Owned saved search: `POST /api/chromograph/v3/search`

```json
{"query":{"rgb":"#3388cc","tags":["wet"]},"kind":"hazard","limit":20,"diversity":0.15}
```

The server queries the caller's latest record versions, validates stored metadata hashes, and reranks up to 256. It returns version and pin state; pending ciphertext is distinguishable from published data. It is **not** an unbounded ANN index.

Other routes:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/chromograph/v3/records/<id>` | Own latest metadata/public context |
| GET | `/api/chromograph/v3/records/<id>?ciphertext=1` | Own QRS2 ciphertext, verified against stored SHA256 |
| GET | `/api/chromograph/v3/records/<id>/versions` | Last 100 version metadata, truncation flagged |
| GET | `/api/chromograph/v3/records/<id>/checkpoint` | Native ML-DSA-signed head checkpoint |
| POST | `/api/chromograph/v3/records/<id>/retry` | Requeue own dead versions |
| POST | `/api/chromograph/v3/weather` | Scoped location-consented weather/radar; location in body rather than query URL |
| POST | `/api/chromograph/v3/route-exposure` | Scoped v0.4 ETA route weather engine |
| POST | `/api/chromograph/v3/ai/analyze` | Scoped AI relay with `privacy_ack` and `location_ack`; set `ROADSCANNER_CX_DEVICE_AI_ENABLED=1` |
| GET | `/api/chromograph/v3/status` | Browser-admin-only readiness booleans |
| POST | `/api/chromograph/v3/admin/publish-next` | Browser-admin + CSRF: process one queued object |
| POST | `/api/chromograph/v3/admin/maintenance` | Browser-admin + CSRF: prune <=1000 old budget windows and report queue counts |

All v3 endpoints require registry/feature enable flags. New APIs never return private signing/decryption keys, token hashes or full registry SQL error text.

## Publishing and recovery

Set `PINATA_JWT` as a server secret and optionally configure a trusted `ROADSCANNER_CX_IPFS_GATEWAY` ending in `/ipfs` (HTTPS only; default Pinata gateway).

An explicit operator in the configured native environment can drain bounded jobs:

```bash
python scripts/chromograph_registry_ops.py drain --limit 1
```

The command imports the actual native app, so it needs all original admin/key/dependency configuration. It does not bypass verification or generate test keys. Default one job; maximum twenty. A scheduler can invoke it in a separately configured trusted operational runtime. No unsafe background thread was added to the web app.

Pinning uses the prior scaffold's Pinata `pinJSONToIPFS` adapter and a new document wrapper `{schema:roadscanner-qrs2-v1,envelope:PQ2...}`. This CID is **different from** the prior scaffold's wrapper CID even for the same envelope. It is not the CID of the raw envelope string. Live provider compatibility/credentials still need staging validation.

On successful remote verification, SQL ciphertext is set to NULL; D1 retains public index metadata, version digests, CID and status. During failures, the SQL spool retains **ciphertext only**. This temporary D1 storage has real SQL/storage cost. Minimal R2 recovery is not implemented in v0.5; the earlier Worker R2 option is separate and is not automatically used here. No automatic unpinning is attempted: a public CID may have other consumers.

## Testing and limits

Run the bundled tests with a development environment containing pytest, Flask, Flask-WTF and httpx:

```bash
python -m pytest -q tests/chromograph
python -m py_compile main.py
```

Tests use real Flask clients and SQLite execution, mocked HTTP, generated radar fixtures and an explicitly non-PQ native signing **test double**. They do not prove actual ML-DSA/ML-KEM interoperability, full original-app startup, real Cloudflare REST behavior, Pinata persistence, provider licensing or production availability. See `docs/chromograph/VALIDATION.md` and `docs/chromograph/release.json`.

Quantum-inspired color/phase scoring remains classical, experimental and separate from secure randomness. Weather/time/CPU/RAM do not provide cryptographic entropy or certified safety. All previous weather/radar uncertainty limits apply.
