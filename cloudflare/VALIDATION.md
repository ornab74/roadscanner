# Initial release validation

Validated on 2026-11-10 for `https://ride.qroadscan.com`.

- 41 JavaScript tests and 10 Python tests passed. The Worker handler tests
  exercise real SQLite statements/triggers for authentication, origin checks,
  password-change session invalidation, report ownership, metering, replay,
  failure refunds, request limits, and disabled payments.
- All seven migrations applied successfully to Cloudflare D1. An isolated
  remote fixture confirmed atomic reservation debits and exactly-once refunds;
  that fixture was removed after the checks.
- The non-root, read-only local scanner passed model checksum verification,
  readiness, actual TinyLlama inference, response authentication, and nonce
  replay rejection. The local validation container was removed afterward.
- Actual Cloudflare scans passed on workers.dev and the custom domain.
  Repeating an API idempotency key returned the stored report and charged once.
  Authenticated retrieval decrypted the report from R2. Scanner-busy responses
  refunded reservations. The external API key used for validation was revoked,
  and its subsequent authentication attempt was rejected.
- Chromium verified production login, the map, a browser scan without an API
  key, the updated credit balance, saved report history, and API documentation.
  Radar imagery loaded with HTTP 200 tiles after accepting RainViewer's hashed
  frame paths. Browser and HTTP checks retained TLS verification.
- R2 public access is disabled. Report bodies have a 90-day lifecycle rule.
  The existing `qroadscan.com` Worker was preserved; the new custom domain is
  bound only to `roadscanner-ride`.
- Changed and newly created source files were checked for the actual deployment
  credential values; none were found. Application secrets and the initial owner
  login are stored outside the checkout in private local files.

The browser's initial unauthenticated session probe returns 401 as intended.
The signup regression was reproduced: ID lookups used with CSS selectors threw
before changing the form. It was fixed, then the simplified UI was replaced
with the original template-derived QRS pages. Live browser checks confirmed
Create Account navigation, visible validation, real registration, success
redirect, login, the restored three-step scan/report workflow, settings, and
radar imagery. Temporary signup accounts were removed after validation.
The site's strict CSP blocks a zone-injected Cloudflare analytics beacon;
zone-wide analytics settings were left unchanged. Neither blocked normal use.

These checks establish the exercised release behavior, not a complete security
audit or an evaluation of road-safety prediction accuracy. Synthetic validation
scenes are operator-supplied observations, not evidence of actual local hazards.
Payments, additional providers/translations, legacy features, and existing-user
migration remain outside this initial release; see DEPLOYMENT.md.

## Direct OpenAI validation (2026-11-11 UTC)

An isolated production test account completed the three-step browser scan with
HTTP 200 using `gpt-5.5-2026-04-23`. The report modal and home-page OpenAI
assessment rendered successfully, the second home request returned the cached
assessment, and no page-script errors occurred. The fixture used its own
operator-granted application credit, preserving the owner's balance; its
account and report objects were removed afterward.

Automated tests also verify the direct Responses API request, strict structured
output parsing, provider identity, dashboard failure refunds, independent home
assessment of a TinyLlama source, and cached reuse without another provider call.

## Original public homepage restoration

Compared the original public `harm_ratio` flow in commit `5737a61`. The homepage
now automatically loads the direct OpenAI percentage preview without login or
a saved scan, using the original category thresholds. Production Chromium
verified a real 33% response, the OpenAI provider, cached refresh, missing-CSRF
rejection, and no page-script errors. The complete wheel fit at viewport widths
1863, 1365, 1024, 768, 390, and 320 pixels with no horizontal overflow.

Tests cover signed cookie/header CSRF validation, forged and cross-origin
requests, rejection of arbitrary prompts, numeric severity bounds, shared
cache reuse, and unchanged account balances. This public illustrative preview
is independent of private account reports; it does not represent live sensing.

## Location/weather, map and settings repairs

The fixed illustrative public scenario was replaced by permission-based browser
location and current MET Norway weather estimates. Live production Chromium
checks returned a 16% OpenAI weather index for the New York test region, then
fetched London weather after changing location. Cached refresh preserved source
identity, timestamps and rounded coordinates; denied permission displayed no
numeric score. All 20 JavaScript tests pass, including weather input validation,
stale/failed upstream rejection and separate regional caches.

Production OpenStreetMap tiles returned HTTP 200 with the required site-origin
referrer. RainViewer overlay tiles returned HTTP 200 on the dashboard map, with
a frame slider and timestamp. `/radar` redirects to the themed dashboard map.

Fixed CSS extraction for dynamically created style tags: BeautifulSoup's
`get_text()` returned empty content, while `.string` held the settings CSS.
Production checks verified the restored settings theme and sidebar on desktop
and phone, key creation/reveal/copy, authenticated API credit balance, and
revocation returning 401. The isolated fixture account was removed afterward;
owner credentials and credits were unchanged. No page-script errors occurred.
Strict script CSP remains enabled. Optional Cloudflare analytics may still be
blocked; the application does not depend on it.

## Location failure simulation fallback

Reviewed the user-provided older `_build_guess_prompt`. Added a separate
structured OpenAI guess-mode prompt for fictional locations, terrain, weather,
traffic and time of day. Simulation and weather results have distinct cache
keys and explicit source markers. Arbitrary client prompts are rejected;
signed CSRF, origin checks, encryption and provider-call limits remain active.

All 21 JavaScript tests passed. Production Chromium exercised denied,
unavailable, timed-out and unsupported geolocation: all automatically rendered
a clearly labeled OpenAI simulation (42% in this test). The retry control
returned to real regional weather. No page-script errors or mobile horizontal
overflow occurred. Provider failures never substitute a fabricated success.

## Uncached simulation refreshes

Removed simulation cache reads, writes and shared leases. Every accepted
simulation request generates a new scene, calls OpenAI, and returns a unique
assessment ID, `cached: false`, and no cache expiry. Weather caching remains
separate. Simulation limits allow six calls per IP per minute and 120 globally
per hour. The UI no longer displays a ten-minute simulation cache timer.

All 21 JavaScript tests passed. Production browser validation completed two
successive OpenAI simulations (42% then 48%), with distinct assessment IDs
and no cached response. Equal numeric scores remain valid model outputs.

## Radar visibility and shared account navigation

RainViewer now starts enabled, with the frame slider and timestamp visible by
default. Production browser checks confirmed successful radar tile responses,
automatic controls, and the legacy radar redirect. Map links return to step one
when another scanner step is active.

Dashboard and user settings now render one shared account-navigation template
and stylesheet. Production checks at 1365px and 390px confirmed identical links,
icons, dimensions, spacing and colors, with the correct active page and no page
script errors or horizontal overflow. The temporary account was removed.

## Original Grok homepage restoration

Extracted the supplied original `_build_guess_prompt` with AST, preserving its
text and placeholders. Restored direct xAI chat-completions settings, all seven
original reading fields, the exact label/color rubric, confidence pill and
confidence-aware breathing, root accent changes, and uncached refreshes.
Synthetic seeds and simulation provenance remain explicit; no physical sensing
or accuracy claim follows from the fictional prompt.

All 24 JavaScript tests passed. Live production browser checks verified real
Grok responses (18%, Clear, #22d3a6, 71% confidence in the first response), a
second uncached response, original display-field wiring, unclipped desktop and
mobile wheels, and no page-script errors. The original model alias
`grok-4-1-fast-non-reasoning` returned actual model `grok-4.3`. The saved
`GROK_API_KEY` was detected by metadata; its value was never printed or copied
into source.

## Single-page GPT-6 Luna visual route workspace

All 28 JavaScript tests passed. New checks cover bounded screenshot validation,
Mercator transforms, endpoint/geometry continuity, unknown severity, image and
weather input to GPT-6 Luna, absence of routing-engine calls, incomplete provider
responses, session/CSRF enforcement, one-credit settlement, idempotent replay,
raw-image exclusion from saved reports, and exactly-once failure refunds.
Migration 0006 applied successfully to remote D1.

Two live production Chromium runs used an isolated account, actual OpenStreetMap
and Esri satellite tiles, captured endpoint imagery, MET Norway weather, and
`gpt-6-luna`. Both completed with HTTP 200. The first produced one walking section
with unknown severity. The longer test produced two connected walking sections,
each with modeled severity 8/100, and the corresponding chromographic ribbons.
Address search, endpoint selection, satellite capture, report/credit updates,
full-screen mode, and phone layout passed without page-script errors or
horizontal overflow. No routing-engine request was made. This validates the
exercised workflow, not the geographic correctness or safety of an LLM proposal.

RainViewer tiles returned HTTP 200. Pixel inspection found no precipitation in
the supplied tiles in the test view; the UI stated the empty/coverage limitation
rather than claiming the frame failed or that roads were clear. The temporary
account and both encrypted test reports were removed after validation.

## Address recovery, automatic imagery, and secure GPS preview

All 41 JavaScript tests and 10 Python tests passed. Added checks include support
grant idempotency, Census fallback and precision, ignored unit suffixes,
wrong-house filtering, georeferenced endpoint/corridor captures, arbitrary image
origin rejection, redirect rejection, image signature/dimension/MIME limits,
context-only refunds, and GPS progress/turn-distance calculations.

Live production browser checks confirmed a formerly missing Easley residential
sample resolved through Census with an approximation label. An apartment suffix
was stripped and explicitly not claimed as located. No actual customer home
address was requested for diagnosis. The support grant and context correction
were recorded without a payment.

Initial imagery tests exposed unsupported Workers `redirect: error`; changed
to manual handling with rejection. Live atlas preview then returned all eight
views with no warnings. A real multi-image GPT-6 Luna analysis produced an
Easley–Greenville driving proposal with two sections, referencing the road atlas.
The endpoint image capture, all automatic roles, fullscreen and phone layout
passed, with no routing-engine calls or page-script errors.

GPS browser tests used explicitly synthetic positions and a synthetic route,
not evidence of real driving accuracy. They verified next-turn distance/time,
speed, poor-accuracy/off-route pauses, native and in-app fullscreen behavior,
hidden-page shutdown and rejection of stale GPS callbacks after stop. No live
vehicle test, legal routing validation, independent full security audit or
road-safety prediction validation is claimed.

## Final runtime/security checks

All 41 JavaScript tests and 10 Python tests passed. Credentialed provider
requests reject redirects; image tests reject media mismatches, oversized pixel
dimensions, invalid headers and capture-size mismatches before model use.
The actual eight-frame Esri atlas passed these byte/pixel checks in production.
The longer real GPT-6 Luna analysis returned a driving proposal with two sections
and all eight frame roles, without imagery warnings or routing-engine calls.

Final GPS browser checks used synthetic positions and confirmed hidden-page
shutdown, ignored stale callbacks, native/in-app full-screen exit cleanup,
low-accuracy/off-route pauses, and live distance/time/speed updates. The isolated
account and three encrypted fixture report objects were removed. No customer
home address or live vehicle trace was used in these tests.


## Mapped road ribbons and simulated NAZA display

49 JavaScript tests passed, including vector geometry matching, immutable mapped-section annotation and reproducible two-qubit circuit tests. An offline Easley–Greenville proposal aligned to 354 imported road vertices over about 21 km with 85% named-corridor coverage. Cartographic alignment does not verify turn restrictions, private access, grade separation or driving legality.

The NAZA-inspired circuit is an analytic simulation with reproducible simulated shots. Only decorative fringe/pulse appearance changes. Risk scores and road geometry remain separate. No physical quantum sensor or road-safety validation is claimed.

The deployed fullscreen GPS check passed with synthetic positions: turn distance/time, speed, poor-accuracy and off-route pauses, hidden-page shutdown, ignored stale callbacks, and native/in-app fullscreen cleanup. Ten Python tests also passed. Runtime npm dependency audit reported no vulnerabilities.

The production end-to-end GPT-6 Luna test returned 12 mapped sections, 334 road vertices and a 20.5 km proposal with 91% named-corridor coverage. All eight automatic street/satellite frame roles loaded. The second model pass accepted and annotated the mapped corridor. Desktop/mobile layouts, state baseline toggle and GPS lifecycle checks passed without page-script errors. RainViewer tiles loaded but contained no precipitation pixels in that area.
