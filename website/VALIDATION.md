# Public website validation

Validated 2026-11-14 on `https://qroadscan.com`.

- Deployment: Cloudflare assets-only Worker `qroadscan`.
- Final version: `0ed441e4-654b-4baa-8561-8f66ecf60b17`.
- Previous deployment available for rollback: `604288e2-3cf2-4443-9e90-747f99742fad`.
- Homepage and preserved `/naza-one/` page passed real Chromium checks at widths
  1440, 1024, 768, 390 and 360 pixels, with no horizontal page overflow or script exceptions.
- Menu opening/closing, preview switching, API language selection and keyboard
  tab controls passed. Python and JavaScript clipboard copying passed in production.
- Navigation points to the app's current Docs, Blog and workspace. Live `/docs`,
  `/blog` and `/app` redirects resolve to their intended Ride URLs.
- The documentation, OpenAPI specification and linked documentation fragments
  were checked against the live app.
- CSS/JS SRI matched deployed source bytes; rebuilding SRI was idempotent.
- HTML has no inline scripts, inline event handlers or inline styles. No external
  fonts or analytics libraries are included in the site source.
- Live static assets returned expected CSP, nosniff and browser security headers.
  Page-level `Cache-Control: no-transform` prevents analytics auto-injection into
  HTML, retaining the strict CSP. The final browser check reported no CSP violations.
- Naza One Windows, Android test pages, Google testing group and source links
  remain accessible. The original full Naza One landing content is at `/naza-one/`.
- The route diagram is explicitly illustrative, with fictional endpoints, and
  makes no routing, geolocation, weather or model-provider requests.
- `roadscanner-ride` and its databases, private storage and secrets were not
  redeployed or modified. Its health endpoint stayed healthy and public live
  payments remained disabled.

The application test suite was not rerun for this static-site-only update.
Site checks exercised the actual pages and interactions rather than adding tests
that merely repeat static markup. Existing local Stripe skills and environment
files are excluded from the commit.
