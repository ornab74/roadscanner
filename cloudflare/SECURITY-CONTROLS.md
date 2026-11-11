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
