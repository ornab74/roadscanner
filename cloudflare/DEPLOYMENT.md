# Cloudflare deployment

This is a new Worker application, separate from the original Flask/Tunnel
deployment. It does not import existing encrypted SQLite accounts or reports.
Do not copy local development credentials or test databases into this service.

## Components

- Worker: `roadscanner-ride`, intended domain `ride.qroadscan.com`.
- D1: `roadscanner-ride` for accounts, password hashes, sessions, API-key hashes,
  the credit ledger, rate limits, and request metadata.
- R2: private bucket `roadscanner-ride-reports`. Report bodies use AES-256-GCM
  with authenticated owner/request identity. Objects expire after 90 days.
- Durable Object: one named scanner instance. Its Container has no Internet
  access and uses a checksum-verified model baked into a non-root image.
- Scheduled maintenance refunds expired reservations and removes expired
  sessions/rate-limit records. A failed scan refunds its reservation immediately.

The release supports direct OpenAI GPT-5.5 and local TinyLlama inference in English, account
registration/login/password changes, API-key creation/revocation, advanced
scene text inputs, a location map, timestamped RainViewer radar imagery, and
encrypted report history. It does not claim weather forecasting or remotely
observed hazards. The model's road-safety accuracy has not been validated.

Payments are deliberately disabled. New accounts start with zero credits.
The owner launch account received a separately recorded ten-credit operator
grant for validation; this is not a purchase. Stripe fulfillment, additional model
providers, translations, legacy blogs/administration, OAuth/passkeys, and
existing-account/data migration require further implementation and validation.

## Reproduce the deployment

Use Node 22.21+ and Docker. From `cloudflare/`:

```sh
npm ci
python -m pip install -r requirements-ui.txt
python build_frontend.py
bash fetch-model.sh
npm test
npm run migrate
npx wrangler secret bulk /secure/path/cloudflare-secrets.json
npm run deploy
```

The UI renderer reads the original `main.py` templates and shared
control CSS using Python AST without initializing Flask. It preserves the QRS
page designs while connecting CSP-compatible page modules to the Worker APIs.
Account forms use email-based login and the existing 12-character minimum
password policy. Regenerate the assets after changing source templates.

Keep TLS, artifact hashes, and package verification enabled. For this managed
environment, pass its CA as a BuildKit secret when building the image:

```sh
docker build --secret id=proxy_ca,src=/etc/ssl/certs/ca-certificates.crt \
  -f cloudflare/Dockerfile -t roadscanner-cloud-scanner:staging .
```

Wrangler can reuse these verified Docker build layers. The model download is
ignored by Git and is reproduced by `fetch-model.sh`. The immutable model
checksum, upstream provenance, and license are in MODEL.md and MODEL-LICENSE.txt.
The image installs a subset of the existing hash-locked Python dependencies
without editing requirements.txt and applies the existing DiskCache mitigation.

Use standard Cloudflare authentication. A scoped token uses
`CLOUDFLARE_API_TOKEN`. A Global API Key instead uses `CLOUDFLARE_API_KEY` and
`CLOUDFLARE_EMAIL`; unset `CLOUDFLARE_API_TOKEN` for that process so it does not
override Global API Key authentication. Never write credentials into this
repository or deployment configuration.

The Worker needs three independent secrets:

- `QRS_API_KEY_PEPPER`: at least 32 random bytes encoded as text.
- `QRS_LLAMA_API_TOKEN`: a separate random text secret, at least 32 bytes.
- `QRS_REPORT_KEY`: a 32-byte AES key encoded as 64 hexadecimal characters.

Back up these secrets securely. Changing the report key without migrating
existing encrypted objects makes those reports unreadable. D1's managed
recovery and the R2 lifecycle are separate from an operator's backup policy.
Do not delete or recreate the database, bucket, or Durable Object namespace
as an application rollback. Deploy a previously verified Worker version and
its compatible container image while preserving data and secrets.

In the onboarding workspace, the credential-aware Wrangler helper is
`/workspace/roadscanner-dev/cloudflare-cli.py`. Initial owner credentials are
in the private file `/workspace/roadscanner-dev/owner-login.json`; change the
password after first login. Production application secrets are saved privately
at `/workspace/roadscanner-dev/cloudflare-secrets.json`, outside the checkout.
These files must not be printed in logs, committed, or included in Docker context.

## Validate before routing the domain

1. Apply migrations and verify the actual D1 credit invariants.
2. Verify the model checksum, container readiness, signed inference requests,
   and signed responses with the real model.
3. Deploy on the Worker's workers.dev hostname and test login, origin/CSRF
   enforcement, API authorization, a real scan, idempotent replay, encrypted
   report retrieval, and credit/refund behavior.
4. Test the browser workflow, then add the custom-domain route. Preserve any
   existing hostname configuration rather than overwriting unrelated records.
5. Repeat the health and authenticated workflow checks on the custom domain.

Enabling Stripe later requires implementing and testing the D1 fulfillment
and subscription paths, not just adding credentials or enabling a button.

## Homepage Grok guess mode and dashboard models

The homepage uses `HOME_PROVIDER=grok`, the Worker secret `GROK_API_KEY`, and
`GROK_HOME_MODEL=grok-4-1-fast-non-reasoning`, matching the supplied original
code's model setting. xAI currently resolves this alias to `grok-4.3`; the actual
response model is displayed rather than inventing a model identity. Calls go
directly to `https://api.x.ai/v1/chat/completions`, not Cloudflare inference.
The request preserves the original temperature 0.7, 300-token output cap and
JSON-object response format.

`grok-home-prompt.mjs` contains the original `_build_guess_prompt` extracted
from the user-supplied source via AST. Its timestamp, anonymous simulation
visitor and synthetic seed are supplied server-side. This Worker does not run
the old host's CPU/RAM measurements or quantum-state simulation. A system
clarification and visible provenance distinguish fictional guess-mode output
from real sensing. No actual location or personal identifiers are sent.

The original seven fields (`harm_ratio`, `label`, `color`, `confidence`,
`reasons`, `blurb`) are strictly validated, including the exact five-category
color mapping. They control the percentage, heading, root accent, confidence
pill, explanations, and confidence-aware breathing animation. The homepage
automatically loads without login or location permission, supports manual and
60-second automatic refreshes, and never caches Grok readings. The original
page layout and wheel renderer remain, with the responsive clipping fix.

Signed CSRF cookies/headers, Origin checks and provider-call limits remain:
six simulation calls per IP per minute and 120 globally per hour. Failed or
truncated model responses show unavailable status, without synthetic fallback
successes. Strict CSP and server-only provider secrets remain unchanged.

The dashboard still offers direct OpenAI GPT-5.5 (with `OPENAI_API_KEY`) and
TinyLlama. Its separate stored-report OpenAI endpoint and regional weather
helpers remain available; neither drives the Grok homepage. Payments remain
disabled. No Cloudflare AI Gateway credits are required for direct provider
calls; usage is billed by xAI/OpenAI to their respective configured accounts.

## Single-page visual route planner

`/dashboard` now renders `frontend/planner.html` with `planner.mjs` and
`planner.css`, using the same shared account navigation as settings. The old
three-step UI is replaced by a full-viewport map workspace with start/end place
search or coordinate entry, map selection and draggable pins, Streets/Satellite
layers, endpoint screenshot capture, up to two uploaded context images,
RainViewer frames, section review and saved reports. Full-screen mode expands
the entire planner, and phone layouts stack the controls and map.

`ROUTE_MODEL=gpt-6-luna` uses the existing `OPENAI_API_KEY`. Its availability was
confirmed against the actual account model catalog and real multimodal calls.
The Responses API receives the primary visible, georeferenced map screenshot,
optional endpoint/site-plan/directory images, preferences, and timestamped MET
Norway estimates at up to three rounded corridor locations. Raw images are not
written into reports. Images are resized in-browser, bounded server-side, and
sent with `store: false`. Reports retain the resulting proposal, geographic
section geometry, model identity, weather provenance and limitations, encrypted
in R2 under the existing retention policy.

This is deliberately an LLM-only *visual proposal* system, without OSRM or other
routing engines. It does not verify legal turns, road access, closures, traffic,
obstacles, indoor corridors or apartment/unit numbers. Those require sufficient
visible context and user verification. If context is insufficient, the model
returns specific requests with no fabricated route. Directions are for review,
not validated GPS navigation. No automated voice guidance or rerouting is claimed.

The model returns at most 24 contiguous sections in normalized screenshot
coordinates. The server validates bounds, connected geometry and endpoint
alignment, then converts points using Web Mercator. Each section has an
instruction, provenance and a modeled weather/visual caution score. Numeric
scores render a continuous green/amber/red ribbon; unsupported scores remain
gray and dashed. A known area forecast may support an explicitly assumed
area-weather exposure index, not a measured street hazard or accident probability.
The planner never randomizes scores or invents differences to create more colors.

Session-only endpoints:
- `POST /api/route/geocode`: explicit address search via Nominatim, never
  autocomplete. One shared upstream request per two seconds, encrypted one-day
  query/result cache; apply migration `0006_geocode_cache.sql` first.
- `POST /api/route/analyze`: signed browser CSRF cookie/header, exact Origin,
  bounded image payload, six calls per user/hour and sixty globally/hour.
  A returned route proposal costs one application credit. A valid
  `needs_context` response returns the credit and is not saved as a completed
  route. Provider/schema failures also refund exactly once. Provider API usage
  can still be incurred even when the application credit is returned.
  Idempotency keys prevent repeated charges; interrupted requests can be checked
  with the same key. The existing API reservation expiry/recovery applies.
- `GET /api/route/models`: authenticated provider model metadata only.

Street tiles use the required site-origin referrer. Satellite imagery uses the
public Esri World Imagery service with Esri/Maxar/Earthstar/community attribution;
this does not imply imagery is current or all private access paths are visible.
Browser map capture uses CORS-enabled visible tiles, not bulk downloads. User
uploads can provide missing site plans or directory details. RainViewer runs in
its own pane above the basemap; loaded tile alpha values distinguish an empty
precipitation image from failed loading. Neither empty radar nor missing coverage
is reported as a confirmed clear road. Regional zoom and the timeline remain
available. Weather attribution and CC BY 4.0 links appear in the analysis panel.

## Automatic atlas, Map Excellence, and GPS guidance

The analysis always captures a labeled street overview, even if Satellite was
selected. It then builds four endpoint images (street + aerial at each end),
and four overlapping street corridor panels for longer routes. Esri exports
supply actual projected extents, image roles, provider, capture time and an
explicit unknown acquisition date. The model receives that georeferenced
manifest and image batch, plus uploaded context. Up to eight automatic views
are fetched two at a time. These are ordinary map exports, not bulk downloads
from OpenStreetMap's volunteer tile servers.

`route-imagery.mjs` uses fixed HTTPS service URLs and validates export image
origins/path, dimensions, MIME and JPEG headers. Redirects are handled manually
and rejected; `redirect: error` is unsupported in Workers. Image response bytes
are bounded. If the automatic atlas is completely unavailable, the app refunds
before calling the route model instead of passing a missing batch onward.
`POST /api/route/atlas` is an authenticated, CSRF-protected, rate-limited preview
with no model call or scan charge. Reports retain frame metadata/preview URLs,
not raw image bytes; provider preview links can expire.

The Map Excellence prompt registers images, assembles visible connectivity,
examines endpoint approaches, compares plausible corridors, traces a proposal,
and audits uncertainty/geometry. Learned geographic knowledge can suggest
hypotheses; it does not turn remembered streets into verified facts. Unsupported
links remain uncertain/gray. Context-only responses return application credits.
This workflow is not a validated replacement for a street-routing engine.

Full-screen mode has a GPS preview panel with current/proposed next instruction,
distance before the next section, remaining line distance, speed, accuracy and
an approximate time at current GPS speed. It supports native full screen and an
in-app fallback for browsers without it. Location starts only after a user action
in full-screen mode. Exit, hidden page, page unload, changed endpoints or a new
route stop tracking. Generation guards reject queued callbacks after stop. No
continuous GPS trace is sent to OpenAI or saved server-side. Map following still
requests viewport tiles from the selected map provider. Poor accuracy or an
off-route fix pauses turn cues. Distances follow the model's proposed polyline;
legal turns, closures, road access, ETA under traffic and apartment access are
not verified. There is no automatic rerouting or voice guidance.

## Address coverage and support credits

The address adapter uses mapped house matches when available, filters out
mismatching house numbers, adds US Census street-interpolated address candidates,
and labels street/area-only matches. Unit suffixes are removed for geocoding and
explicitly marked as not located. Exact entrances/unit access still need map
confirmation and/or a readable site plan. Nominatim upstream limits and encrypted,
versioned caching remain; negative results expire sooner. Tests on four unrelated
Easley residential examples reproduced two OSM misses; Census returned all four.

Migration 0007 adds atomic, idempotent operator support grants via ledger insert.
No public grant endpoint exists; these are virtual application credits, not
purchases. A ten-credit grant and a separate one-credit context-only correction
were recorded for the support account. Payments remain disabled.
