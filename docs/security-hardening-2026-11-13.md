# Security hardening notes — 2026-11-13

This pass reviewed the production Cloudflare authentication, CSRF/passkey binding,
API scopes, administrative authorization, billing entry points, private report and
garage-image access, provider request constraints and scanner authentication code.
It was a focused manual review, not an exhaustive repository audit or a guarantee
that no vulnerabilities remain. The Codex Security plugin's supporting references
and scan tools were unavailable, so its full managed scan was not completed.

## Cookie parsing correction

The previous session and preview-cookie regular expressions started with a word
boundary. This matched names such as `lookalike-__Host-qrs_session` and
`lookalike-__Host-qrs_preview`. The session expression also accepted certain
suffixes after a valid 64-character token. This weakened the intended exact-name
boundary of the browser's `__Host-` cookie protection.

A local regression reproduction with controlled, valid fixture tokens showed:

- A lookalike session cookie authenticated `/api/session` before the correction.
- A lookalike preview cookie satisfied CSRF verification for a same-origin request.
- The same requests fail after the correction.

This does not bypass cryptographic token/signature verification. Exploitation
would require a valid token and a way to deliver a matching lookalike cookie to a
victim, for example a separately compromised sibling subdomain setting a parent-
domain cookie. No such compromised subdomain or real account takeover was shown.
The change prevents that cookie-confusion condition rather than claiming that
arbitrary unauthenticated visitors could forge another user's token.

The shared cookie parser now matches whole, case-sensitive names and rejects
ambiguous duplicate names. Session tokens and signed preview values are then
validated against their complete expected format. Session authentication, CSRF
issuance/verification and passkey challenge binding use the same parser.

Existing Secure, HttpOnly, SameSite=Strict, host-only session cookies, CSRF Origin
checks, signed token verification and passkey user verification are retained.
Legitimate cookies refresh normally; invalid/ambiguous preview cookies receive a
fresh signed cookie from the token endpoint.

## Browser isolation

Worker responses now include:

- `X-Frame-Options: DENY`, complementing the existing `frame-ancestors 'none'` CSP.
- `Cross-Origin-Opener-Policy: same-origin`, isolating cross-origin opener relationships.
- `Cross-Origin-Resource-Policy: same-origin`, restricting cross-origin no-CORS embedding.

These are additional hardening controls, not three independently discovered
vulnerabilities. They preserve the existing CSP, SRI assets, same-origin application
APIs and redirect-based Stripe integration. Cross-origin popup integrations would
need a separate compatibility review before being added.

## Validation and retained boundaries

- `node --test tests/cloudflare-*.test.mjs`: **132 passed, 0 failed**.
- Cookie regression tests cover aliases, suffixes, duplicate names, malformed values,
  legitimate login/logout, preview refresh, and isolation headers on errors and success.
- Existing account tests still exercise role/elevation checks, scoped API access,
  CSRF, credential-change races and passkey challenge/session boundaries.
- `npm audit --omit=dev --json`: **0 known production Node dependency vulnerabilities**
  in the advisory database queried during this pass. This does not cover development
  tools, Python dependencies, unknown vulnerabilities or runtime configuration.
- Live HTTPS checks confirmed rejection of lookalike, suffixed and duplicate session
  cookies, and lookalike/duplicate CSRF cookies, while preserving a valid session.
- A real Chromium login and Settings smoke test passed without JavaScript exceptions.
- Stripe remains disabled through `STRIPE_ENABLED=false`; no keys were rotated,
  exposed or committed, and this change grants no new account permissions.

Authorization checks, private R2 owner binding/encryption, provider allowlists,
request/response size bounds and quotas were inspected in the reviewed paths.
No additional validated bypass was established there during this pass. Legacy
`main.py`, the full Python dependency graph, external-provider infrastructure and
Cloudflare account-wide settings were not exhaustively audited.
