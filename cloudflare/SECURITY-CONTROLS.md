# Route planner security controls

This describes implemented controls and exercised checks, not a complete
independent security audit or certification of route accuracy.

- Private route, imagery and geocoding endpoints require a valid account session,
  exact browser Origin and a signed, expiring CSRF cookie/header pair. Report
  retrieval checks ownership. Session cookies are Secure, HttpOnly and host-only.
- Request bodies, JSON nesting, field sets, image count, encoded bytes, media
  signatures and image pixel dimensions are bounded. The primary screenshot's
  actual dimensions must match its geographic capture metadata. Browser image
  resizing strips uploaded file metadata. SVG/HTML uploads are not accepted.
- Automatic imagery uses fixed HTTPS services and validates export download
  origin/path and actual image dimensions. Redirects are not followed. Model
  requests carrying API keys also use manual redirect handling and reject
  redirect responses, avoiding credential forwarding to an unexpected host.
- Provider keys remain Worker secrets. No key is embedded in frontend assets or
  model context. Provider error messages, raw image bodies, residential queries
  and live GPS fixes are not logged by application code.
- Images, labels and notes are untrusted model inputs. Structured output is
  validated for shape, bounded text, finite scores, connected geometry and
  endpoint alignment. Returned text is inserted as text, never executed as HTML.
  Uncertain section evidence cannot produce a numeric confidence color.
- Raw image bytes are not retained in reports. Saved route results and geocoder
  caches are encrypted. Automatic public map-image preview links can expire.
  OpenAI requests use `store: false`; provider data policies remain applicable.
- Scan credits use atomic reservation/debit/refund rules and idempotent requests.
  Context-only and failed analyses return application credits. Provider API use
  may still cost money. Support grants are unique, operator-inserted ledger
  entries; no public credit-grant endpoint exists. Rate limits bound paid calls
  and address/imagery requests.
- GPS starts only by user action in full-screen mode. Exit, hidden page, unload,
  changed endpoints or a new plan stop it. Generation checks discard queued
  callbacks after Stop. Poor accuracy and off-route positions pause turn cues.
  Live position history is not sent to the LLM or persisted by the app. Following
  the vehicle still requests viewport tiles from the selected map provider.
- Strict script CSP, frame restrictions, HSTS and geolocation permissions policy
  remain enabled. Tests retain TLS certificate verification.

The system provides LLM route proposals, not verified legal routing, reliable
traffic-aware ETA, indoor positioning or measured accident prediction. Forecast
and imagery age/coverage limitations remain visible. GPS distances are measured
along the proposed polyline, and time-before-turn assumes current GPS speed.


Road geometry imports use fixed HTTPS OpenFreeMap hosts, manual redirects, bounded tile counts, bytes, vertices and search. Imported names remain untrusted text. The annotation model cannot replace mapped coordinates. Cartographic joins do not verify legal routing. Simulated quantum appearance changes neither risk scores nor coordinates; GPS accuracy used by that display stays in the browser. Fullscreen-only GPS lifecycle guards remain enforced.

## Account security and admin console

- All browser mutation routes (including login, signup, logout, password changes,
  key management, route tools, and admin actions) pass a central exact-Origin,
  Fetch Metadata and signed expiring cookie/header CSRF check. Bearer-only v1
  scans remain outside cookie authentication. CSRF refresh reuses a valid cookie
  to avoid breaking another tab. Disabled billing performs no mutation.
- Passkeys/FIDO2 credentials use pinned SimpleWebAuthn server 14.1.0 / browser 14.0.0, strict origin/RP
  validation, required user verification and discoverable credentials. Only
  public keys are stored. Two-minute challenges are bound to the browser/session,
  consumed once, and checked for expiry. Signature counters use compare-and-swap.
- API-key creation/revocation, passkey enrollment/removal, other-session logout,
  and private admin data/actions require five-minute server-side verification.
  Password sign-in does not implicitly elevate; verified passkey sign-in does.
- Named API keys have 1–365-day lifetimes (default 90), one-time disclosure,
  HMAC-at-rest lookup, revocation and last-use metadata. Existing legacy keys are
  retained; their lack of expiry is displayed. Listings never return hashes or
  raw secrets. Browser-session pseudo-keys cannot be managed as API keys.
- Admin role is an operator-provisioned D1 allowlist. Role checks run on the server
  for every admin route. Bearer API keys cannot use the console. User search is
  bounded, parameterized and paginated; the console cannot grant admin roles or
  decrypt other users' reports. Provider status exposes booleans, never secrets.
- Support grants are positive, bounded, idempotent ledger transactions. Session
  and key revocations, grants, enrollment and successful reauthentication create
  audit records. Audit history expires after 180 days; expired challenges are
  removed on the existing schedule. No passwords or raw tokens enter audit data.
- Generated pages hash every local stylesheet, script and module preload with
  SHA-384 SRI. A build manifest checks final asset bytes. Browser tests proved
  modified entry modules, transitive module imports and stylesheets are rejected.
  CSP disallows inline script execution, external scripts, objects and framing.
  Inline style attributes remain necessary for Leaflet positioning. SRI does not
  protect against a party replacing both HTML and its referenced asset hashes.

Cloudflare injects an external analytics beacon at the zone layer. CSP deliberately
blocks it. A ride-only analytics exclusion was attempted but the Cloudflare plan
rejected an additional rule; no existing zone-wide analytics rule was changed.
This causes a known console CSP message without preventing app execution.

## Garage images and aviation evidence

- Vehicle schemas bound fields and validate kind-specific numeric specs. All
  garage lookups and active-profile updates check ownership. Profile JSON is
  encrypted with a vehicle-specific owner-bound AAD. Optimistic versions reject
  stale edits; road guidance loads the actual owned profile server-side.
- Artwork is produced only by an explicit, metered request with an idempotency
  key. Reservation/debit/refund use the existing transactional credit ledger.
  Local PHF instruction checks and provider moderation fail closed. Both prompt
  and output must pass before any image is delivered. Output format/dimensions
  and response byte counts are bounded. Private PNG blobs use AES-GCM with
  owner/vehicle/image AAD and authenticated no-store retrieval; no public bucket
  or raw provider image URL is used. Prompts omit dedicated plate/VIN/registration fields and request no visible registrations; user appearance text is explicitly warned against personal identifiers. Pending/orphaned objects have bounded cleanup leases.
- Aviation endpoints accept only owned aircraft profiles, bounded coordinates,
  airport-code syntax and bounded fuel/altitude inputs. Providers use fixed HTTPS
  hosts, no redirects, timeouts, body caps and quota limits. OpenSky OAuth tokens
  are memory-only. Provider failures expose safe status categories, not bodies,
  credential-bearing URLs or secrets. Source records remain untrusted text.
- Public surveillance is filtered for recent positions and snapshot age. Cached
  stale positions are withheld. Missing/empty traffic never implies clear airspace.
  Airport reports expose issue/observation/validity times and missing/stale fields.
  Wind samples validate time, units and numeric ranges, and distinguish model
  pressure levels from measured flight-level wind. 250 hPa context is not a jet
  axis, turbulence or icing forecast. Provider caches are short and expire.
- Fuel/wind arithmetic is deterministic, unit-consistent and explicitly based on
  user inputs. No fuel is invented when required inputs are missing or exceed
  declared capacity. The model reviews existing facts without authority to issue
  flight commands, clearance, separation, regulatory reserve approval or go/no-go
  decisions. Structured advisory output is bounded and obvious operational
  command forms are rejected. No flight-control or aviation GPS interface exists.
- Input changes clear displayed scenario results; stale surveillance is removed
  from the map/table. Polling stops on hidden/page-exit/input change. Aviation
  source data, not art or simulated quantum output, drives scenario arithmetic.
  No synthetic vehicle image is used as aircraft-performance or weather evidence.

Garage image reservations are excluded from scan-report history, report retrieval, homepage scene sources and scan statistics. Admin metrics count generated images separately. Deletion clears encrypted profile contents immediately, schedules private image deletion and later purges the tombstone.
