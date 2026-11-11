# Cloudflare Worker and scanner

The Worker implements account sessions, hashed API keys, metered scan requests,
atomic D1 credit reservations/refunds, and AES-GCM encrypted reports in private
R2 storage. Its private Durable Object starts a checksum-verified TinyLlama
Container and signs each request after readiness. Scanner responses are verified
before settlement. Direct OpenAI GPT-5.5 inference is also available with the Worker’s
`OPENAI_API_KEY` secret. The public homepage uses direct Grok with `GROK_API_KEY`, the original
guess-mode prompt, percentage/color/confidence fields, and uncached refreshes.
It loads without login or location permission and is explicitly a simulation.
The original model alias currently resolves to grok-4.3 at xAI.
The dashboard is now a single-page GPT-6 Luna visual route planner. It supports
start/destination selection, satellite screenshots, endpoint/site-plan images,
weather inputs, an automatic endpoint/corridor image atlas, chromographic
section ribbons, saved reports and full-screen GPS preview. Tracking stops
on exit/background; route directions remain unverified proposals. It uses no routing engine; its directions are proposals requiring review.
The existing OpenAI/TinyLlama scene-scan APIs remain available.
Cloudflare inference credits are not used.
The browser workspace includes a location map, supplied
weather/traffic/obstacle observations, timestamped radar imagery, and report history.

Payments are disabled for the initial launch. New accounts start with zero
credits. The initial model supports English and has not been validated for
driving-safety accuracy. The original Flask application remains separately
available; its legacy features and stored accounts have not all been migrated.

See [DEPLOYMENT.md](DEPLOYMENT.md) for components, credentials, supported features,
remaining migration work, model provenance, storage retention, and validation.
The UI uses the original `main.py` templates and shared styles. Regenerate it
with `python build_frontend.py` after installing `requirements-ui.txt`.
Run `npm ci`, `bash fetch-model.sh`, and `npm test` from this directory to prepare
the development tools, verified model, and Worker tests.

The Python security-boundary and credit-invariant tests remain available with
`python -m unittest discover -s tests -v` from the repository root. Local SQLite
and protocol tests supplement staging checks; they do not substitute for running
the real Container and testing Cloudflare D1/R2 bindings.
