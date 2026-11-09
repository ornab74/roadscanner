# Daybreak handoff: clone, reproduce, audit, then decide

## Scope and authorization

The owner asked to commit the complete v0.6 work for independent cloning/testing/security audit and to deploy it **themselves**. Do not deploy, publish DNS, rotate production keys, regenerate a trust root, migrate production data or spend on Cloudflare without the owner's explicit instruction for that action.

Review branch: `codex/cloudflare-v06-audit` in `ornab74/roadscanner`. Start from the actual commit SHA you fetch; do not trust a moving branch name as an immutable audit target.

```bash
git clone --branch codex/cloudflare-v06-audit https://github.com/ornab74/roadscanner.git
cd roadscanner
git rev-parse HEAD
python -m venv .venv
. .venv/bin/activate
python -m pip install --require-hashes -r tests/chromograph/requirements.txt
python -m pytest -q tests/chromograph --junitxml=TEST_RESULTS.xml
python -m py_compile main.py
python scripts/cloudflare_preflight.py --target containers-production
# The last command SHOULD block, report missing prerequisite names and return 2.
```

## What is included

- Full merged `main.py`: original 13K-line app plus v0.3–v0.6 additions.
- `tests/chromograph/`: real Flask/SQLite tests and mocked native/provider boundaries. Fixtures extract the additive block and exact session helper, rather than importing the full key/bootstrap/DB application.
- `docs/chromograph/release.json`: source provenance and unchanged legacy/native function contracts.
- `deploy/0003_owned_registry.sql` and `0004_device_account_bindings.sql`: new separate registry only.
- Slim Container recipe and unsigned-manifest preparation, plus **existing-key** signature helper.
- Read-only preflight, persistent-host compose, origin-header/Access tunnel templates and security-focused self-deployment guide.
- A hash-locked CI test environment; CI never gets production secrets or automatically deploys. Review active workflows inherited from `main` as well.

No private key, credential dump, real database, generated production `.env`, image build result or security certification is included.

## Priority audit questions

### A. Cryptography and trust

- Verify genuine QRS2 ML-KEM-768 + X25519 + AES-GCM + ML-DSA round trips with known test vectors and an isolated copy of real trusted keys. The local test signing double is HMAC, **not PQ evidence**.
- Review AEAD nonces/AAD, canonicalization, domain separation, key wrapping, private-key custody, HD/key epochs, bootstrap defaults, strict fallback rules and signature algorithm matching.
- Check complete signer equality, not a short fingerprint, and old-key rotation policy. Queued envelopes currently require the current trusted signer.
- Validate signed dependency locks with an independently trusted public key. The inherited `resign-pq-lock.py` creates a new key each run; do not call that trust preservation.
- Weather/timing/device metrics are public heuristic features, never key entropy. Reject any unsupported quantum/accuracy claims.

### B. Authentication and authorization

- Test the signed cookie/session, recent-auth snapshot wrapper, device scope/expiry/hash verification, mixed bearer/cookie CSRF and failure behavior for invalid bearer + valid cookie.
- Verify native read-only account fingerprints correctly invalidate deleted/password-changed/passkey-changed/privilege-changed accounts without rejecting ordinary counters/labels.
- Review race windows across native SQLite and D1. An account change does not cancel a request already in flight.
- Owner namespaces inherit native numeric IDs. Do not reassign IDs; design immutable account generations before broader identity migration.
- Verify missing binding/schema/auth-store errors fail closed and an old v0.5 token cannot authenticate.
- Audit original legacy routes too: new account-bound device checks do not automatically repair all original browser-session behavior.

### C. Storage, integrity and recovery

- Exercise single-statement CAS and idempotency under real D1 REST, including writes committed before transport errors.
- Validate ownership on every metadata/ciphertext/history/search/checkpoint path and cursor behavior under concurrent revisions.
- Check envelope/context/chain tampering, leased workers, expired/fenced leases, repeated crashes, retry limits and orphan pins.
- Measure SQL reads/writes/storage and queue backlog. Newest-256 reranking is not large-scale ANN.
- Test IPFS wrapper CID semantics, gateway integrity, provider outages/terms and retention. Ciphertext spool is cleared after confirmed pin/read-back; independent replica/R2 recovery is not implemented here.
- Demonstrate legacy auth/sealed-state persistence and consistent backup/restore across host/container/image changes before Containers production.

### D. Edge and runtime

- Access deny-by-default, real JWT validation at the tunnel/origin, direct-origin isolation, ProxyFix header sanitization, pinned WebAuthn origin/RP ID and odd-path normalization.
- Audit all image layers, runtime filesystem mounts, read-only root, capabilities, rootless socket access, local trust boundary, logging and secret delivery.
- Exercise strict QUIC/PQ fallback behavior and distinguish every TLS hop from envelope encryption. Do not infer end-to-end PQ authenticity from a tunnel flag.
- Test real native startup, cold start, Argon2 peak memory, one-worker concurrency and shutdown. The test suite does not import the full app.
- A production Python Worker/Durable Object Container controller is not present; do not substitute an unauthenticated public quick-start example.

### E. Browser/mobile and data consent

- Test actual desktop/mobile visual layout, multipart size enforcement, CSRF, escaping, no-store responses and credential single-display handling.
- Verify revision forms preserve palette/weather/time context and expected-version conflicts are surfaced.
- External AI must be opt-in, server-model-configured, rate/spend-limited and numeric-only; no screenshots/exact GPS/raw captures/keys in model payloads.
- Mobile clients need both legitimate Access authentication and app device scopes; never distribute a shared Cloudflare service credential.
- Weather gates, radar transparency/motion and phase scores must not be presented as certified driving safety or calibrated storm predictions.

## Required deliverables before recommending production

1. Audit report pinned to commit SHA, with reproducible findings, impact, fixes and verification.
2. True native/PQ, D1/Pinata, restore and edge negative-test evidence.
3. Docker image digest/SBOM/scan/provenance, reviewed dependency lock and stable signer fingerprint.
4. A proven persistent-host path or completed/audited durable Containers architecture; never just a successful `wrangler deploy` exit code.
5. Residual risks and an operator-approved rollout/rollback procedure. No automatic merge/deploy as part of an audit.
