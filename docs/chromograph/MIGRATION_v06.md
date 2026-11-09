# Migration and rollback checklist — v0.6

## Registry migration

The new `cx6_device_subjects` table stores device ID, numeric legacy user ID, HMAC account fingerprint and binding time. It stores no raw password hash, passkey bytes, plaintext token, key material or exact location.

For an existing v0.5 D1 registry (verify the selected name/ID first):

```bash
npx wrangler d1 execute <your-separate-registry-name> \
  --remote --file=deploy/0004_device_account_bindings.sql
```

For a new registry, apply `0003_owned_registry.sql` first. Do not run these against the legacy app database. The commands are instructions only; no remote execution occurred here.

For a fresh local development registry:

```bash
python scripts/chromograph_registry_ops.py init-local --database /absolute/new/registry.db
```

The initializer refuses an existing file. For an existing local registry, use your reviewed SQLite migration process to apply `0004_device_account_bindings.sql` after a backup; do not overwrite/reinitialize the database.

## Account/device transition

- Back up and preserve the current owner namespace key and native encryption/signing trust material.
- Verify the original auth DB path is readable in read-only mode and has the native app's current `users` and `webauthn_credentials` columns.
- Drain/reconcile pending native signed-envelope jobs before any signing-key rotation; this release doesn't add old-key trust automatically.
- Old browser sessions also lack a sign-in snapshot: reauthenticate under v0.6 before token issuance. Old v0.5 credentials are unbound; reissue after a recent sign-in. No automatic trust migration is attempted.
- Check that password-hash changes, account removal, passkey material/handle changes and admin-flag changes invalidate devices on subsequent checks. Already in-flight requests are not retroactively canceled.
- Ordinary passkey sign counters, usage timestamps and labels are excluded from the auth fingerprint.
- Do not change the owner namespace key to revoke a device; use revocation. Key changes need a proper ownership/binding migration.

- Do not reuse/reassign legacy numeric user IDs. A full immutable-account identity migration remains separate from this registry upgrade.

## Workspace rollout

- Keep feature flags off while validating original login, scans, blog, passkeys and QRS2 restore.
- Enable the registry only in staging, then open `/chromograph` after sign-in.
- Check browser forms and CSRF behind the actual HTTPS reverse proxy. Flask-WTF's secure-origin checks still apply.
- Check mobile layout in a real browser before rollout; the headless browser binary was unavailable during this work.
- Validate encrypted-only upload limits, stale revision conflict behavior, preserved context and metadata-index consent.
- Validate that an admin's process-next action operates on the shared queue, not only the currently displayed account's jobs.
- Validate live provider contracts, quotas, commercial terms and Cloudflare D1 REST behavior before real user data.

## Rollback

Disable the feature/registry flags and restore the previous reviewed image/main.py and its signed dependency lock. The migration only adds a new table/index, so leaving it in place does not change legacy tables. No automatic table drop, token resurrection, ciphertext deletion or IPFS unpin is performed.

A downgrade to v0.5 does not enforce v0.6 live account bindings. Revoke credentials that should not survive rollback and review this security consequence before downgrading.
