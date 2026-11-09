# Roadscanner v0.6: security-focused Cloudflare self-deployment

This is a **review candidate**, not a production certification. You deploy it yourself after independent testing and audit. No Cloudflare resources, secrets, DNS records or deployments were created by this work.

Start at [DAYBREAK_HANDOFF.md](DAYBREAK_HANDOFF.md). The exact merged source, tests and additive registry migrations are committed together. Original native `encrypt_data` / `decrypt_data` code is preserved; that does not prove the legacy cryptography or surrounding authorization is vulnerability-free.

## 1. Choose the correct deployment track

| Track | Suitable now | Where code/data run |
|---|---|---|
| **Persistent native host + Cloudflare Access/Tunnel + D1/IPFS** | Staging candidate; production only after the audit/restore tests below | Flask/native liboqs on a persistent Linux host; Access/Tunnel at Cloudflare; new registry in D1; encrypted objects in IPFS |
| **Cloudflare Workers + Containers** | **Disposable isolated staging only** | Native image in ephemeral Containers; an audited Python Worker/Durable Object controller still needs implementation/integration |
| **Containers production cutover** | **BLOCKED in this release** | Requires durable legacy auth/key storage, startup/restart/restore proof, isolated edge routing and real native-key tests |

The new D1 registry is **not** the original `secure_data.db`. V0.6 still reads the legacy users/passkeys DB and sealed files. A named Cloudflare Container, longer sleep timeout, snapshot or R2 FUSE mount does not by itself make live SQLite/key state durable. Do not point the production origin at Containers and hope state survives.

The first track keeps your Cloudflare/D1/IPFS plan while preserving state until Daybreak completes the native-storage migration. It is not a claim that Flask runs wholly inside Workers.

## 2. Fetch a reviewable revision

```bash
git clone --branch codex/cloudflare-v06-audit https://github.com/ornab74/roadscanner.git
cd roadscanner
git rev-parse HEAD
python -m venv .venv
. .venv/bin/activate
python -m pip install --require-hashes -r tests/chromograph/requirements.txt
python -m pytest -q tests/chromograph
python -m py_compile main.py
```

Record the commit SHA and image digest you actually audit. Test tooling is separate from the native production lock. This test suite intentionally avoids starting the full app, loading private keys or touching your real DB. Its native signing and remote API doubles are not proof of real PQ or Cloudflare interoperability.

Do not run a remote `curl | bash` installer before reviewing the fetched script. Inspect the original installer and existing workflows as part of Daybreak's review, not as trusted magic.

## 3. Review the trust and secret inventory

Use unique, server-side secrets. Never paste them into chat, commit a real `.env`, put them in Docker build arguments/layers, or embed them in Dart/JavaScript.

| Secret/state | Purpose | Handling |
|---|---|---|
| `INVITE_CODE_SECRET_KEY` | Flask session signing | Stable, independently random, 32+ characters; controlled rotation invalidates sessions |
| Native `ENCRYPTION_PASSPHRASE`, `QRS_SALT_B64`, encrypted X25519/ML-KEM/signing key values, sealed-store state | Decrypt/verify old QRS2 data | Restore exact trusted material; back up and exercise restore before rollout; do not silently regenerate |
| `admin_username`, `admin_pass` | Legacy native bootstrap/admin configuration | Protected runtime credential source; review the original admin-update behavior |
| `ROADSCANNER_CX_OWNER_KEY` | Stable pseudonymous record namespaces and account bindings | Separate 32+ character random key; back up; changing it is a migration, not a token-revocation method |
| `ROADSCANNER_CX_D1_TOKEN` | Container-side D1 read/write | Least-privilege token for the selected account/resources; separate from deploy/admin tokens |
| `PINATA_JWT` | Ciphertext pinning | Restricted server credential, account quotas and provider terms reviewed |
| `OPENAI_API_KEY` | Optional external AI | Server only, spend limits; no provider key on clients |
| Tunnel credentials | Native host to Cloudflare | Private runtime file/secret store; never commit tunnel JSON or an account certificate |
| Signed lock public key + manifest/signature | Dependency attestation | Pin a reviewer-approved public key fingerprint out of band; public key is public, private signing key is offline |

`QRS_X25519_PUB_B64`, `QRS_X25519_PRIV_ENC_B64`, `QRS_PQ_KEM_ALG`, `QRS_PQ_PUB_B64`, `QRS_PQ_PRIV_ENC_B64`, `QRS_SIG_ALG`, `QRS_SIG_PUB_B64`, `QRS_SIG_PRIV_ENC_B64` are exact native variable names. Set `STRICT_PQ2_ONLY=1`, `QRS_PQ_KEM_ALG=ML-KEM-768` and an approved `QRS_SIG_ALG` (`ML-DSA-65`/`ML-DSA-87`). Presence alone does not prove the values match your historical keys.

The native app can bootstrap missing keys. That is unsafe for a production restore if it happens accidentally. The included preflight refuses missing native configuration instead of silently starting a new key universe.

## 4. Build the slim image without replacing the trust root

The root dependency lock still reflects the original app. `deploy/requirements.cloud.in` omits `llama-cpp-python` and PennyLane while retaining other actual legacy imports, including NumPy/native crypto.

On a trusted build machine with reviewed resolver tooling:

```bash
python -m piptools compile --generate-hashes \
  --output-file deploy/requirements.cloud.txt deploy/requirements.cloud.in
python deploy/make_cloud_manifest.py --algorithm ML-DSA-44
```

**Select the algorithm matching your already trusted lock-signing key**, not automatically the example's ML-DSA-44. The envelope-signing key and dependency-lock key are different roles.

The existing `scripts/resign-pq-lock.py` generates a fresh signing key and overwrites the public trust anchor. Do **not** use that as a way to make an untrusted lock pass verification. For a stable approved key, the new helper signs and then verifies against the pinned public key:

```bash
# On your signing machine, key decrypted to a private tmpfs file OUTSIDE git.
python scripts/sign_cloud_manifest.py \
  --private-key-file /run/credentials/roadscanner-release-private.b64 \
  --public-key-file pq_pubkey.b64
```

The helper does not create private keys, overwrite the trust anchor or accept secret key bytes as CLI arguments. It refuses loose file permissions and a private key inside the repository. It is a candidate helper; verify it with real liboqs/keys before trusting a release.

Review the lock, manifest, public-key fingerprint, base-image digest and liboqs source digest. Then build with `deploy/Dockerfile.slim`. The Dockerfile keeps `--require-hashes` plus the original `verify.py`. No fake signature or auto-trust fallback is included.

```bash
docker build -f deploy/Dockerfile.slim -t roadscanner:cloud-v06-audit .
# Scan/attest the result, publish to your approved registry if needed, and
# record its immutable digest. Do not claim this local tag is an immutable digest.
```

This image has not been Docker-built here. An OOM/cold-start measurement with real Argon2/native key handling is mandatory; removing Llama does not remove native key-derivation memory costs. One Gunicorn worker and a conservative 2 GiB host limit are starting points, not measured minima.

## 5. Create only a new registry and apply the right migrations

In your own Cloudflare account, create a dedicated **staging** D1 database and narrowly scoped API token. Verify account/database IDs before running any command.

For a new CX registry:

```bash
npx wrangler d1 execute <staging-registry-name> --remote --file deploy/0003_owned_registry.sql
npx wrangler d1 execute <staging-registry-name> --remote --file deploy/0004_device_account_bindings.sql
```

For an existing v0.5 registry apply only `0004` after backup. Do not apply these to the legacy DB or blindly reapply v0.1 tables. The schemas are additive, not a migration of legacy users/passkeys.

Set `ROADSCANNER_CX_REGISTRY_BACKEND=d1` and its account/database/token settings on the native runtime. Real D1 REST semantics and concurrency must be checked with the chosen account; local tests use a wire-contract double and SQLite.

## 6. Restore state on a persistent host first

Use a clean, patched Linux host with controlled local accounts and rootless Docker where practical. Review the original repository's host install instructions. Do not expose the app's port publicly.

- Restore the original legacy SQLite, sealed files, HD/key epoch state and backups to an explicitly selected persistent volume.
- Directory owner must match the container user; use mode 0700 for state and 0600 for secret files.
- Verify an old QRS2 record decrypts, a known signature verifies, and key fingerprints match your prior trusted inventory.
- Back up consistently: use the SQLite backup API/online backup process or quiesce writes; a live filesystem copy is not automatically a valid DB backup.
- Encrypt backups independently and test restoring them on an isolated host. Record recovery objectives and key-loss consequences.
- Do not run two independent legacy SQLite/key writers against an object-store filesystem.

`deploy/compose.cloudflare-host.yml` requires an existing named state volume and an audited image reference. It binds **127.0.0.1:3000**, drops capabilities, has a read-only root filesystem and runs a fail-closed preflight before Gunicorn. It does not provision a server, volume, Cloudflare account or secret store.

Provide a decrypted credential file under a private runtime-only path such as `/run/credentials/...`, using an audited systemd credential/secret-manager workflow. `ROADSCANNER_ENV_FILE` identifies that temporary file. Do not create a committed production `.env`. Do not run `docker compose config` or `docker inspect` into shared logs: they can expand/expose secrets.

Set `ROADSCANNER_LOCK_PUBLIC_KEY_SHA256` to the exact reviewer-approved **file** hash of `pq_pubkey.b64` (including its chosen newline format); the preflight must not approve a new trust anchor merely because it is in the same checkout.

```bash
# Environment contains only the non-secret selector/reference values;
# the configured runtime credential file carries native/API secrets.
export ROADSCANNER_IMAGE='<your-reviewed-image@sha256:digest>'
export ROADSCANNER_STATE_VOLUME='<restored-persistent-state-volume>'
export ROADSCANNER_ENV_FILE='/run/credentials/roadscanner/runtime.env'
docker compose -f deploy/compose.cloudflare-host.yml up -d
```

The preflight reports configuration **names**, not secret values. It checks a separate private mount, key settings, lock hash/fingerprint and native signature verification. Passing it does not prove backup quality, endpoint isolation or security audit completion.

## 7. Put Cloudflare Access in front BEFORE publishing the hostname

1. Create a dedicated staging DNS name under a zone you control.
2. Create a Cloudflare Access self-hosted application covering the entire hostname. Use an allowlist/identity policy, MFA and an appropriate short session lifetime; no Everyone/Bypass rule.
3. Record the actual Access team name and application AUD. These are identifiers, not the application's session secret.
4. Review `deploy/cloudflared.access.example.yml`. Configure `originRequest.access.required: true`, your team name and AUD so **cloudflared validates the Access JWT before forwarding**. Do not trust a header's mere presence.
5. Review the loopback-only Nginx example: it overwrites forwarded host/proto/port, strips caller-controlled forwarding fields, suppresses URL access logging and preserves request-size limits. Pin the exact public hostname. This matters because the app trusts one proxy hop with ProxyFix.
6. Install/configure the host Nginx loopback listener and validate its syntax; it forwards port 3001 to Docker loopback port 3000. The tunnel points only to 127.0.0.1:3001. No public 80/443 origin listener is needed.
7. Create a locally managed tunnel with credentials kept out of git. Check the tunnel ingress rules; include the final 404 catch-all. Configure the current recommended path-normalization behavior and test odd paths/backslashes against Access enforcement.
8. Only then publish the DNS/tunnel route.

For strict PQ **tunnel key agreement**, verify the actual installed `cloudflared` version/configuration and run with explicit QUIC and no-PQ-fallback settings:

```bash
cloudflared tunnel --config /etc/cloudflared/roadscanner.yml \
  --protocol quic run --post-quantum <your-tunnel-uuid>
```

Use the same options in an audited service, not just an interactive shell. Cloudflare documents that QUIC ordinarily can fall back; the explicit flag forbids non-PQ fallback for that hop. HTTP/2 does not provide the same PQ tunnel agreement. Browser-to-edge negotiation and TLS signatures are separate properties: this is not proof of end-to-end PQ authentication across every hop. QRS2 envelope encryption remains a separate layer.

Loopback limits off-host access; other local processes remain inside the host trust boundary. Harden local users, credential access, rootless Docker socket permissions and firewall rules. Access does not replace native Flask login/ownership checks.

Mobile v3 APIs need a legitimate per-user/device Access path as well as the app's scoped credential. **Do not embed a shared Cloudflare service token in a distributed app or bypass Access for `/api/`.** Have Daybreak implement/test that client access flow before mobile rollout.

## 8. Required deny/restore tests before real traffic

| Test | Required evidence |
|---|---|
| Unauthenticated internet request | Access redirect/deny, not the native login page, API JSON or record data |
| Fake/expired/wrong-AUD Access assertion | Denied at tunnel/origin boundary |
| Direct origin port from another machine | Connection refused/blocked; never public native Flask |
| Spoofed forwarded host/proto and odd normalized paths | Cannot bypass Access or change the pinned RP/origin |
| Session POST without CSRF; invalid/overscoped/revoked bearer | Rejected |
| Account/password-hash/passkey change | Existing device invalidated; stale cookie cannot issue new tokens |
| Existing v0.5 tokens | Must be reissued after `0004` and a new v0.6 sign-in |
| Native key restore and image restart | Historical ciphertext remains decryptable; fingerprints/epochs unchanged |
| Pinata failure, failed read-back, lost SQL acknowledgement, expired lease | No false `pinned` status; ciphertext retained or recoverable |
| Container/host restart and complete backup restore | Persistent auth/registry/keys agree; no silent bootstrap or data loss |
| Two independent accounts | No cross-owner records, vectors, tokens, history or checkpoint access |

Keep monitoring logs free of authorization headers, raw credentials, coordinate query strings, ciphertext dumps and native exception tracebacks containing key material. Check the legacy app's logging/exception paths; the new helpers cannot sanitize every inherited path.

Enable features in stages: native health/login first, then registry, browser workspace, a test device, one genuine encrypted record, a single queue publish/read-back, then optional external AI. AI requires explicit consent and provider spend caps. Leave shared legacy relay disabled.

## 9. Cloudflare Containers staging and production gate

Use a **separate** Worker/Container application and D1 database with a custom Access-protected staging hostname. No production DNS or legacy state. Keep disposable-only data, fresh staging trust material and a tested backup of anything you intend to retain.

Daybreak must implement/test the Python Worker/Durable Object control plane, port readiness, trusted-origin forwarding, ingress JWT enforcement, secret injection, rollout/restart behavior and state persistence. There is no production-ready controller included in v0.6; do not deploy an unauthenticated quick-start proxy as a shortcut.

`python scripts/cloudflare_preflight.py --target containers-production` deliberately fails in this release. Removing that gate is a reviewed code change requiring evidence, not an environment toggle. Native-host deployment remains the first practical option.

Cloudflare documents that `wrangler deploy` activates Worker code before image processing and rollout is not transactional. A failed image build may leave new Worker code live. Use separate staging, pin images, retain rollback assets and verify the running Container image rather than trusting only command exit status.

## 10. Rollback and incident handling

- Disable new feature/AI flags and close the public route if confidentiality is uncertain; do not disable authentication to keep the site apparently working.
- Retain the audited prior image, corresponding lock/trust anchor, DB backups and stable key inventory.
- Prefer restore into an isolated environment; prevent new-writer/old-schema split-brain.
- Revoke app device tokens and the correct provider/tunnel/deploy credentials separately when compromised. Never rotate away the only keys that decrypt retained data without a recovery plan.
- Downgrading to v0.5 drops live account-binding enforcement. Review/revoke affected tokens before downgrade.
- Public IPFS data cannot be recalled globally. Unpinning your copy does not prove deletion from other peers. No automatic destructive unpin is included.

## Sources checked for this guide

- [Cloudflare Container filesystem and lifecycle](https://developers.cloudflare.com/containers/faq/)
- [Container deployments and non-transactional rollouts](https://developers.cloudflare.com/containers/guides/deploy/)
- [D1 query REST API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
- [Tunnel origin Access-JWT settings](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/)
- [Tunnel protocol/PQ run settings](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
- [PQC by Cloudflare connection/hop](https://developers.cloudflare.com/ssl/post-quantum-cryptography/pqc-cloudflare-products/)

Pricing, quotas and provider terms must be rechecked for your actual workload. No $5 total-cost promise, zero-egress IPFS entitlement, cryptographic-entropy gain from weather/time/CPU/RAM or measured 50x accuracy is asserted.
