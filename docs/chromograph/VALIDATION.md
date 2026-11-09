# v0.6 validation evidence and limits

## Performed

- Complete merged main.py compiled; prior v0.5 statements and native QRS2 encryption/decryption definitions remain unchanged by AST comparison.
- All carried search, radar/PNG, weather/ETA, D1-contract double, queue recovery, native-signing double, scope/CSRF/ownership and operator-initialization tests.
- New live-account binding tests used real read-only SQLite lookups: account removal, password-hash/privilege/handle/passkey changes, normal counter/label updates, other-account isolation, missing auth store, old unbound credentials, partial binding failure and recent-login checks. The exact native session-establishment function was extracted for unit tests of snapshot capture and fail-closed issuance after a sign-in-binding outage; this does not constitute full native authentication startup.
- New Flask workspace tests exercised rendered HTML, POST/CSRF, encrypted-only uploads, metadata-preserving revisions, owned search/history, pagination with tied timestamps, credential display/reissue state, admin controls, request-size bounds, missing-weather handling and sanitized backend failures.
- HTML parser assertions verified that generated forms include CSRF values and the workspace loads no browser JavaScript.
- Fresh local initialization creates the additive v0.5/v0.6 registry tables without importing the native application or touching the legacy database.

Actual totals/outcomes are in the locally generated `TEST_RESULTS.xml`. Source hashes and deployment flags are in `docs/chromograph/release.json`.

## Not performed

- Full original app startup, native key restore/rotation or real ML-KEM/ML-DSA interoperability.
- Cloudflare provision/migration/live execution, IPFS pinning, real AI/weather/radar calls or provider license verification for an intended commercial workload.
- Docker build, actual mobile credential vault integration, Flutter build or browser visual-layout QA.

Headless Chromium installation failed because the downloaded artifact was invalid/unavailable. No browser screenshot or end-to-end rendered-layout result is claimed. Flask response/form tests passed; real desktop/mobile browser checks remain a release task.

## Remaining structural work

1. Finish legacy SQLite/sealed-key persistence and native startup testing before production Cloudflare Container cutover.
2. Stage the live D1/Pinata API paths and scheduled explicit queue drain, with real spending/provider quotas and operational monitoring.
3. Add independent IPFS replicas and encrypted recovery reads (e.g. the separately designed R2 option); v0.6 doesn't implement these.
4. Review auth-binding invalidation behavior, especially conservative invalidation after password-hash rehashes, before a user-facing rollout.
5. Relevance/weather calibration, authoritative alert integration and large-scale ANN indexing remain separate research/engineering tasks. Classical phase/color features do not establish quantum advantage, safe driving or extra cryptographic entropy.
