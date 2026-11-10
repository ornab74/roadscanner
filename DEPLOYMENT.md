# Roadscanner production deployment

The maintained production instructions are in the
[README installation guides](README.md#production-installation-guides).

Choose one path:

- [Prebuilt Docker image (recommended)](README.md#guide-1--prebuilt-docker-image-recommended)
- [Complete source build](README.md#guide-2--build-everything-from-source)

Both paths use rootless Docker, encrypted `systemd-creds` storage, strict
ML-KEM/ML-DSA application mode, and strict post-quantum Cloudflare QUIC. Do not
create a plaintext production `.env` file or expose ports 80/443 for the
Cloudflare Tunnel deployment.

The maintained stack also starts a private `llama-scanner` container and a
separate static `docs` container. Only Roadscanner joins the scanner's
internal-only network; the model service publishes no host port. Provision its
pinned GGUF artifact with the `llama-model-init` profile before starting the
long-running services. Keep Cloudflare routes pointed to
`http://roadscanner:3000` and, for a separate documentation hostname,
`http://docs:8080`.

Stripe Checkout and the paid API are disabled until the operator configures
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CREDITS`, and
`STRIPE_PRICE_PRO`. Credits are fulfilled only through the signed webhook at
`/billing/webhook`; do not grant access from a success redirect.

Set `ENABLE_STRIPE_SETUP=1` when running `docker-install.sh` to enter the two
Stripe secrets at a hidden prompt and configure the one-time and recurring
Price IDs. Use Stripe test mode first; the application never accepts an amount
or Price ID from a browser request.
