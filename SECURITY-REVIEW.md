# Roadscanner Cloudflare security review — 2026-11-12

This targeted review covers the deployed Cloudflare Worker architecture. It is not a completed exhaustive repository audit or a guarantee that vulnerabilities are absent. The security plugin's shared scan references were unavailable, so its canonical scan/report workflow could not be completed. Findings below come from direct source inspection, focused tests, dependency checks, and Cloudflare API configuration reads.

## Changes applied

- Login previously limited attempts only by connecting IP. Distributed clients could target one password without sharing that limit. Login now additionally permits at most 30 attempts per normalized email per five-minute fixed window. Email rate keys use HMAC rather than plaintext. This applies equally to existing and nonexistent accounts. Existing per-IP protection remains. An attacker can temporarily exhaust this account limit; passkey login remains separate.
- Enabled execution of Cloudflare's free managed WAF ruleset for `ride.qroadscan.com` only. Existing custom and rate-limit rules were preserved. No paid product was enabled.

## Verified evidence

- Focused Worker/security/account tests: 23 passed, including rotating-IP attempts, case/whitespace email normalization, unrelated account login, CSRF rejection, administrator authorization and elevation, expiring/revoked API keys, report ownership, billing reservation/refund behavior, and encrypted report storage.
- `npm audit --omit=dev --json` in `cloudflare`: no known production dependency advisories at review time.
- Source confirms HttpOnly/Secure/SameSite session cookies, signed browser CSRF tokens, strict CSP, scoped API authentication, private encrypted R2 image retrieval with no-store responses, bounded request/provider bodies, and a scanner container with outbound internet disabled.
- Cloudflare settings already enable Always Use HTTPS, strict origin TLS, TLS 1.3 minimum, Browser Integrity Check, and Bot Fight Mode. 0-RTT is disabled. Managed DDoS protection is provided by Cloudflare. R2 images use the Worker binding rather than public image bucket URLs.

## Remaining limits and follow-up

- The deployment environment currently uses an account-wide Global API Key. Replace it with a narrowly scoped deployment token when practical; this review did not revoke or rotate credentials and interrupt deployment access.
- Disabled the production Worker development hostname (`workers_dev: false`); preview URLs remain disabled. Production traffic uses the custom domain and its zone WAF controls. Local test origins remain independent of the deployed routing configuration.
- Password storage now uses the versioned `qrs-pbkdf2-sha256-hmac-v1$100000$` format: salted PBKDF2-SHA256 at the Workers-supported 100,000 iterations, followed by HMAC-SHA256 under a dedicated Worker secret, bound to the salt and derived hash. Existing unversioned hashes upgrade on successful password login with a new random salt and compare-and-swap protection. Registration and password changes write the new format; reauthentication accepts both formats. The pepper is independent of Cloudflare deployment credentials and API-key lookup keys. Loss or rotation of the pepper requires a password-reset/recovery plan: do not replace it casually. Database-only compromise no longer permits offline verification of new hashes without that secret. This does not increase PBKDF2's iteration count or protect an attacker who obtains both database and Worker secrets.
- No claim is made of full legacy Flask, installer, supply-chain, Cloudflare-account membership, or historical-secret exposure coverage. Production user credentials were not used for attack testing. Provider model calls were mocked in the focused suite.
- Anonymous homepage model calls remain subject to existing per-IP and global application limits, rather than a new interactive challenge. API clients are not required to solve browser challenges by the added WAF execution rule itself; managed rule matches may still block malicious requests.

The next security review should complete repository-wide source coverage and assess account-scoped deployment credentials, password-hash migration, and canonical-host enforcement.
