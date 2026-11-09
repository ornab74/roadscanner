# Roadscanner Chromograph-X v0.6 — browser workspace and account-bound devices

**The complete application is merged into `main.py`.** This release retains the v0.5 registry/D1/IPFS APIs and all previous Palette256, weather/RainViewer, route-exposure and external-AI features, and adds a usable browser workspace at **`/chromograph`**.

No GitHub push, production DB migration or live deployment was performed. All new application code is in the single `main.py`; native QRS2 encryption/decryption functions and the previous source statements remain unchanged.

## New in v0.6

- **Python-rendered browser workspace**: saved-record browsing/search, encrypted-file import and revisions, history, device creation/revocation, weather checks and publishing diagnostics.
- **No browser JavaScript or application TypeScript**: normal HTML forms, server-rendered views, CSS and existing Flask sessions. No frontend framework, extra local AI dependency, or client-side API key.
- **Account-bound device credentials**: every device request checks a live, read-only snapshot of its legacy account. Account removal, password-hash change, passkey addition/removal/change, account privilege change or authentication-handle change invalidates the token. Ordinary passkey counter/label updates do not.
- **Recent sign-in for issuance**: the native session-establishment helper records an account snapshot after successful sign-in, so a still-recent old cookie cannot reissue tokens after a credential change. It uses the original app's recent-authentication policy where present (otherwise five minutes). No device token can issue another token or access browser/admin controls.
- **Paginated owned browsing**: `GET /api/chromograph/v3/records` with a keyset cursor; owner scoping remains mandatory and cursors are not credentials.
- **Publishing diagnostics**: owned queue status in the workspace, admin-only queue API, due/backoff/expired-lease indications and explicit retry/process controls. Ciphertext, tokens and private key material are excluded from diagnostics.
- **Careful revision behavior**: the browser form preserves existing weather/time/palette metadata unless the selected color changes; tags and record type are prefilled.

The shared sidebar gains a link where existing pages use `qrs_user_sidebar_html`. Other legacy pages with their own inline navigation may still need a direct `/chromograph` link.

## Important upgrade from v0.5

**Apply the new registry migration and reissue old device credentials.** V0.5 tokens have no live-account binding and are intentionally refused by v0.6. There is no fallback to an unbound device or a cookie after a bad bearer token.

1. Back up code, registry, original SQLite, sealed keys and configuration.
2. Stage the new `main.py` in a checkout of the original Roadscanner repository. The full original assets, native dependencies and trusted key configuration remain required.
3. If a v0.5 registry exists, apply `deploy/0004_device_account_bindings.sql` **to that separate registry**, never to the legacy `secure_data.db`. It creates one new table/index only.
4. For a brand-new registry, apply both `0003_owned_registry.sql` and `0004_device_account_bindings.sql`. The included local initializer emits both schemas and refuses an existing file.
5. Keep the existing `ROADSCANNER_CX_OWNER_KEY` stable. Do not generate a new key just because this is an upgrade; existing owner namespaces depend on it.
6. Confirm read-only access to the original `DB_FILE` containing `users` and `webauthn_credentials`. The native app's startup migrations provide its existing authentication schema. The new binding check does not alter that DB.
7. Enable `ROADSCANNER_CX_ENABLED=1` and `ROADSCANNER_CX_REGISTRY_ENABLED=1` in staging after the original app/login/key checks pass.
8. Sign in again under v0.6 and open **`/chromograph`**. Existing browser sessions lack the new sign-in snapshot and cannot issue device tokens until they reauthenticate. Issue new scoped device credentials; update mobile clients securely. Revoke obsolete tokens and confirm password/passkey/account changes invalidate new ones.
9. Run real D1/Pinata/native-key staging checks before a production cutover.

When the new binding table or original authentication store is unavailable, device access fails closed. A browser sign-in remains necessary for credential lifecycle/admin actions.

## Browser workflows

### Find and browse

Open `/chromograph` after signing in. Select a color and optional comma-separated public tags. Saved search is bounded to the latest 256 owned candidates and explains its palette/weather/time/tag scores. Browse older records using cursor pagination; this is not a million-record ANN index or a calibrated hazard probability.

Record history is at `/chromograph/records/<record_id>`. A checkpoint link uses the existing native ML-DSA signer; clients must already trust its public key and retain prior anchors to reason about rollback.

### Import or revise an encrypted record

Choose an encrypted export whose contents are a single **`PQ2.` envelope string** produced by the trusted Roadscanner instance. A JSON wrapper around that string is not accepted. The form does not encrypt plaintext files on the user's behalf.

Choose a record ID, public color/type/tags and confirm public metadata indexing. Trusted ML-KEM/ML-DSA envelope verification happens before acceptance. The initial publishing state is `pending`, never falsely `pinned`.

Open an existing record before uploading a revision. Its expected version is supplied by the page and checked atomically. Existing weather/time/palette context is preserved when the primary color is unchanged. A genuine primary-color change resets the simple browser form's palette to that chosen color; advanced multi-color editing remains available through the JSON API.

The browser form reuses an idempotency key for resubmission, so retrying the same upload does not silently create another version.

### Manage device access

Create only the scopes a device needs. Issued secrets are shown once in the server response, not stored in plaintext in SQL or browser storage by the app. Save them in the mobile platform's secure credential store. No provider/Cloudflare/Pinata key should ever go to the mobile client.

The workspace distinguishes active, expired, revoked and **reissue required** credentials, including before an invalidated device is next used.

Password-hash rehashing can also invalidate credentials, even if the user's password text did not change. This is conservative: the legacy DB does not expose a separate stable password-change epoch. Reissue after such a change. The live account fingerprint is an HMAC; raw password hashes and passkey material are not copied into D1. The binding table does contain the legacy numeric user ID as an internal identifier.

### Check weather

Enter coordinates and consent to sending rounded coordinates to Open-Meteo/RainViewer. Coordinates are posted in the body, not copied to a query URL by this form. The existing server rounds provider coordinates and retains its bounded in-memory provider cache.

Missing data stays unknown; transparent radar pixels do not establish clear skies. Threshold screening is not a certified safe-driving decision. Historical radar movement remains an image proxy, not storm velocity or a future radar product.

### Inspect publishing

The workspace shows your own queue states and recovery indications. Owners can requeue their dead records. Browser admins can explicitly process one eligible job from the **shared** queue and open sanitized diagnostics. No web-process daemon or automatic destructive unpinning was added.

Provider failures retain queued encrypted data as described in the v0.5 reference. R2 read-back and independent secondary pins remain unimplemented in this pipeline.

## API additions and changes

| Method | Endpoint | Behavior |
|---|---|---|
| GET | `/chromograph` | Browser/session-only workspace |
| POST | `/chromograph/search` | CSRF-protected owned search form |
| POST | `/chromograph/upload` | Bounded encrypted export import/revision |
| POST | `/chromograph/devices` | Recent-session credential issuance |
| POST | `/chromograph/devices/<id>/revoke` | Owner/session credential revocation |
| POST | `/chromograph/weather` | Consented weather check |
| POST | `/chromograph/publish-next` | Browser-admin shared-queue processing |
| POST | `/chromograph/records/<id>/retry` | Owner retry of dead versions |
| GET | `/chromograph/records/<id>` | Owned history and revision form |
| GET | `/api/chromograph/v3/records?limit=30&cursor=...` | Owned record pagination; `record:read` devices or sessions |
| GET | `/api/chromograph/v3/admin/jobs` | Browser-admin publishing diagnostics |
| POST | `/api/chromograph/v3/devices` | Existing contract, now requires recent sign-in and creates a live account binding |

All browser POST forms have CSRF tokens; mixed bearer/session API protections remain in force. UI responses are `Cache-Control: no-store`. Device credentials cannot use the browser workspace or admin publishing endpoints.

## D1 and native Container configuration

Retain the v0.5 settings:

- `ROADSCANNER_CX_REGISTRY_BACKEND=d1`, Cloudflare account/database identifiers and a server-only D1 API token, **or** an explicitly persistent local staging SQLite path.
- Stable secret `ROADSCANNER_CX_OWNER_KEY` (32+ random characters).
- `PINATA_JWT` and an optional trusted HTTPS `/ipfs` gateway for publishing.
- `ROADSCANNER_CX_DEVICE_AI_ENABLED=1`, `OPENAI_API_KEY` and a provider-supported configured chat model only if external AI is deliberately enabled.

Owner namespaces inherit the legacy numeric user IDs: do not reassign/reuse account IDs. An immutable account-generation identity is still needed for a broader identity migration. The live account check still depends on the original native authentication DB. D1 registry storage does not make the legacy SQLite/sealed-key files durable in Cloudflare Containers. Complete that persistence/key-custody migration before scale-to-zero production use.

`deploy/` retains the slim native Container recipe: no Llama/PennyLane, one Gunicorn worker, original liboqs build and fresh signed dependency verification requirements. The image was not built in this session.

## Validation

```bash
python -m pytest -q tests/chromograph
python -m py_compile main.py
```

The development test environment needs Flask, Flask-WTF, httpx and pytest; these are not replacements for the production signed lock. The tests use real Flask clients/SQLite, mocked remote APIs and an explicitly non-PQ native signing test double. No claims of genuine post-quantum compatibility testing follow from that double.

See the locally generated `TEST_RESULTS.xml`, `docs/chromograph/release.json`, and `docs/chromograph/VALIDATION.md`. Full original-app/native-key startup, real Cloudflare/Pinata/AI/weather, Docker/Flutter builds and browser visual layout remain unvalidated. Browser HTML/form behavior was exercised through Flask, not an end-to-end headless browser.

Original QRS2 crypto is unchanged. Color/weather/time/CPU/RAM features remain experimental classical context, not cryptographic entropy or demonstrated quantum acceleration.
