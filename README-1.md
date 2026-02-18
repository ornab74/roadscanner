# QRoadScan (QRS) — Single‑file Flask App

This repo contains a **single-file** Flask application (`main.py`) for QRoadScan, including:

- Web UI (mobile-first)
- Google OAuth login (optional)
- Username/password auth + password reset
- Captcha protection (Turnstile/hCaptcha)
- API keys (HMAC signed requests — **no JWT**)
- Credits + quota system (free + paid)
- Stripe billing (Pro + Corporate)
- Admin console (user management, banning, analytics, cache/tools, audits)
- Weather Intelligence for paid users (Open‑Meteo + LLM report)
- Email delivery with optional one-container internal mailer + DKIM rotation + PQ (OQS) headers

> This README documents **environment variables**, **pip dependencies**, and **deployment**.

---

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export FLASK_APP=main.py
python main.py
```

Open: `http://127.0.0.1:5000`

---

## Requirements

### Python
- **Python 3.11+** recommended (3.10 may work but isn’t the target).

### Pip packages (core)

These are required for the core web server, DB, crypto, forms, and HTTP:

```txt
Flask>=3.0,<4
Werkzeug>=3.0,<4
flask-wtf>=1.2,<2
WTForms>=3.1,<4
httpx>=0.27,<1
cryptography>=42,<45
argon2-cffi>=23.1,<24
markdown2>=2.4,<3
bleach>=6.1,<7
geonamescache>=2.0,<3
psutil>=5.9,<6
typing_extensions>=4.9,<5
zstandard>=0.22,<1
dnspython>=2.6,<3
```

### Optional pip packages (feature flags)

Install these only if you use those features:

```txt
stripe>=10,<12                 # billing
dkimpy>=1.1,<2                  # DKIM signing (DKIM_ENABLED)
oqs-python>=0.10,<1             # PQ email system (PQ_OQS_ENABLED) – if your environment has it preinstalled, you can skip
llama-cpp-python>=0.2.80,<1     # local Llama manager (optional)
pennylane>=0.36,<1              # quantum simulation features (optional)
secure-email>=1.2,<2            # SMTP wrapper (optional; internal mailer is default)
```

> Version ranges are **recommended pins**. If you need reproducible builds, generate an exact lockfile with `pip-compile` (pip-tools).

---

## Deployment (Docker)

### 1) Build + run
Typical approach (you said you’ll adjust Dockerfile later):

- Run behind a reverse proxy (Caddy/Nginx/Traefik) with TLS.
- Set `PROXYFIX_ENABLED=true` so Flask correctly sees HTTPS headers.

Example runtime env:

```bash
FLASK_ENV=production
PROXYFIX_ENABLED=true
ENFORCE_HTTPS=true
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAMESITE=Lax
```

### 2) Production server
Use Gunicorn:

```bash
gunicorn -w 2 -k gthread -t 120 -b 0.0.0.0:5000 main:app
```

---

## Environment variables

Below are all env vars referenced in `main.py`, grouped by function.

### Core / Security

| Variable | Default | What it does |
|---|---:|---|
| `SECRET_KEY` | auto/generated | Flask secret. **Set in prod.** |
| `DB_FILE` | `qrs.db` | SQLite DB file path (if overridden in code). |
| `DB_TIMEOUT_SECONDS` | `10` | SQLite busy timeout. |
| `MAX_CONTENT_LENGTH_BYTES` | `2097152` | Request body size limit (bytes). |
| `PROXYFIX_ENABLED` | `false` | Enable werkzeug ProxyFix when behind proxy. |
| `ENFORCE_HTTPS` | `false` | Redirect http→https (except localhost). |
| `SESSION_COOKIE_SECURE` | `true` in prod | Secure cookies over HTTPS only. |
| `SESSION_COOKIE_SAMESITE` | `Lax` | CSRF mitigation. |
| `CSP_STRICT_REPORT_ONLY` | `true` | Enables strict CSP in report-only mode. |

### Registration / Auth

| Variable | Default | Notes |
|---|---:|---|
| `REGISTRATION_ENABLED` | `true/false` (config) | Whether signups are open. |
| `INVITE_CODE_SECRET_KEY` | none | Optional secret for invite codes. |

### Google OAuth (optional)

| Variable | Required | Notes |
|---|---:|---|
| `GOOGLE_OAUTH_ENABLED` | no | Set `true` to enable Google sign-in. |
| `GOOGLE_CLIENT_ID` | yes | OAuth client id. |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client secret. |
| `GOOGLE_OAUTH_REDIRECT_URI` | no | If omitted, uses `url_for(..., _external=True)` |

### Captcha (recommended)

| Variable | Required | Notes |
|---|---:|---|
| `CAPTCHA_ENABLED` | no | Set `true` to require captcha. |
| `CAPTCHA_PROVIDER` | yes if enabled | `turnstile` or `hcaptcha`. |
| `CAPTCHA_SITE_KEY` | yes if enabled | Public site key. |
| `CAPTCHA_SECRET_KEY` | yes if enabled | Secret key for verification. |

### API Keys (HMAC auth, no JWT)

| Variable | Default | Notes |
|---|---:|---|
| `API_FREE_CREDITS` | `1000` | Starting credit balance. |
| `API_DAILY_QUOTA` | `200` | Daily quota baseline (free). |
| `API_SIG_TTL_SECONDS` | `300` | Signature timestamp window. |
| `API_NONCE_TTL_SECONDS` | `900` | Replay window for nonces. |
| `API_CACHE_TTL_SCAN_SECONDS` | `60` | Cache TTL for scan endpoint results. |

Tier rate limiting:

| Variable | Default |
|---|---:|
| `RATE_FREE_PER_MIN` | `60` |
| `RATE_FREE_PER_DAY` | `200` |
| `RATE_PRO_PER_MIN` | `240` |
| `RATE_PRO_PER_DAY` | `2000` |
| `RATE_CORP_PER_MIN` | `1200` |
| `RATE_CORP_PER_DAY` | `10000` |

Context length tiering:

| Variable | Default |
|---|---:|
| `CTX_FREE_MAX_TOKENS` | `2048` |
| `CTX_PRO_MAX_TOKENS` | `4096` |
| `CTX_CORP_MAX_TOKENS` | `8192` |

### Stripe Billing (optional)

| Variable | Required | Notes |
|---|---:|---|
| `STRIPE_ENABLED` | no | Set `true` to enable billing. |
| `STRIPE_SECRET_KEY` | yes if enabled | Stripe API key. |
| `STRIPE_WEBHOOK_SECRET` | yes if enabled | Webhook signing secret. |
| `STRIPE_PRICE_PRO_MONTHLY` | yes if enabled | Price ID for Pro ($14/mo). |
| `STRIPE_PRICE_CORP_MONTHLY` | yes if enabled | Price ID for Corp ($500/mo, seats via quantity). |
| `STRIPE_CREDIT_PACKS_JSON` | no | JSON defining credit packs. |

### Email (three modes)

**Mode A: Internal one-container mailer** (default)
- The app attempts to deliver mail directly to recipient MX (port 25) and can DKIM-sign.
- Requires outbound TCP/25 allowed by your host/network.
- For deliverability, set SPF/DKIM/DMARC on your domain.

| Variable | Default | Notes |
|---|---:|---|
| `EMAIL_ENABLED` | `true` | Master email enable switch. |
| `EMAIL_FROM` | `noreply@qroadscan.com` | From address. |
| `EMAIL_INTERNAL_SERVER` | `true` | Use internal mailer. |
| `EMAIL_OUTBOUND_SMTP_PORT` | `25` | Port for direct-to-MX delivery. |
| `EMAIL_OUTBOUND_TIMEOUT_SECONDS` | `12` | Socket timeout. |
| `EMAIL_MIN_INTERVAL_PER_RECIPIENT_SECONDS` | `30` | Per-recipient send throttle. |

**Mode B: SMTP via secure-email** (optional)
If you set `EMAIL_INTERNAL_SERVER=false`, the app uses `secure-email` with these vars:

| Variable | Notes |
|---|---|
| `EMAIL_SMTP_HOST` | SMTP host |
| `EMAIL_SMTP_PORT` | typically 465 |
| `EMAIL_SMTP_USER` | username |
| `EMAIL_SMTP_PASS` | password |

**Mode C: Legacy SMTP env compatibility** (supported)
These are read for compatibility if present:

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

### DKIM (recommended for production email)

| Variable | Required | Notes |
|---|---:|---|
| `DKIM_ENABLED` | no | Set true to DKIM-sign outbound email. |
| `DKIM_DOMAIN` | yes if enabled | `qroadscan.com` |
| `DKIM_SELECTOR` | no | Single selector (e.g. `default`) |
| `DKIM_SELECTORS` | no | Comma list for rotation (e.g. `s2026a,s2026b`) |
| `DKIM_ROTATE_DAYS` | `30` | Rotation window. |
| `DKIM_PRIVATE_KEY` | key | PEM private key |
| `DKIM_PRIVATE_KEY_PATH` | path | PEM private key path |

Rotation keys can be provided per selector:
- `DKIM_PRIVATE_KEY_S2026A`
- `DKIM_PRIVATE_KEY_PATH_S2026A`
(and similarly for others)

### PQ Email (OQS) — advanced (optional)

> This adds **additional PQ integrity/encryption headers** for your own clients. Standard email providers won’t validate PQ headers as DKIM.

| Variable | Default | Notes |
|---|---:|---|
| `PQ_OQS_ENABLED` | `false` | Enable PQ mail signing headers. |
| `PQ_OQS_SIG_ALG` | `Dilithium2` | OQS signature algorithm. |
| `PQ_OQS_KEM_ALG` | `Kyber512` | KEM algorithm for encryption mode. |
| `PQ_OQS_ENCRYPT_ENABLED` | `false` | Encrypt internal payload as attachment. |
| `PQ_OQS_ROTATE_DAYS` | `30` | PQ key rotation window. |
| `PQE_MAILSIG_ENABLED` | `false` | Adds proprietary rotating HMAC integrity header. |

### Weather Intelligence (Open‑Meteo)

| Variable | Default | Notes |
|---|---:|---|
| `WX_CACHE_TTL` | `600` | Weather fetch cache TTL (seconds). |

### Local Llama model manager (optional)

| Variable | Notes |
|---|---|
| `LLAMA_MODELS_DIR` | local model directory |
| `LLAMA_MODEL_FILE` | model filename |
| `LLAMA_MODEL_REPO` | remote repo/URL |
| `LLAMA_EXPECTED_SHA256` | integrity pin |

### Blog backup/restore (optional)

| Variable | Default |
|---|---:|
| `BLOG_BACKUP_PATH` | `./backups` |

### Alerts / cron dispatch

| Variable | Notes |
|---|---|
| `ADMIN_CRON_TOKEN` | Shared secret for cron endpoint |
| `ALERTS_DISPATCH_MAX` | Max alerts per run |
| `ALERT_MIN_GAP_SECONDS` | Per-user alert cooldown |

### Anomaly throttling (Pass 11)

| Variable | Default |
|---|---:|
| `ANOM_FREE_PER_HOUR` | `120` |
| `ANOM_PRO_PER_HOUR` | `600` |
| `ANOM_CORP_PER_HOUR` | `2400` |
| `ANOM_FREE_THROTTLE_SECONDS` | `900` |
| `ANOM_PRO_THROTTLE_SECONDS` | `600` |
| `ANOM_CORP_THROTTLE_SECONDS` | `300` |

---

## Database

SQLite is used by default. For higher concurrency:
- enable WAL (already configured in code)
- run behind gunicorn with a small number of workers
- consider Postgres if you expect high write concurrency.

---

## API usage (HMAC)

Requests require:

- `X-API-Key-Id`
- `X-API-Timestamp` (unix seconds)
- `X-API-Nonce`
- `X-API-Signature` (HMAC-SHA3-256 over canonical string)

Canonical string format:

```
METHOD \n PATH \n TIMESTAMP \n NONCE \n SHA3_256(body)
```

---

## Production checklist

- Set `SECRET_KEY` and keep it secret.
- Turn on `SESSION_COOKIE_SECURE=true` and TLS.
- Configure DKIM + SPF + DMARC for `qroadscan.com`.
- Enable captcha for public endpoints.
- Keep Stripe webhook secret safe.
- Monitor `audit_log` and `csp_reports`.

---

## Generating a `requirements.txt`

Create a `requirements.txt` by copying the lists above, or run:

```bash
pip freeze > requirements.txt
```

For reproducible builds:
- `pip install pip-tools`
- `pip-compile --generate-hashes -o requirements.lock requirements.in`

