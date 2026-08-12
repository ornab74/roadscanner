# DigitalOcean + Cloudflare deployment (8 steps)

1. Create an Ubuntu 24.04 DigitalOcean Droplet, point a Cloudflare DNS record such as `app.example.com` to its public IPv4 address, and allow TCP ports 80 and 443 in both firewalls.
2. SSH to the Droplet and install Docker and Compose from Ubuntu’s packages: `sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git && sudo systemctl enable --now docker`.
3. Clone this repository and enter it: `git clone https://github.com/ornab74/roadscanner.git /srv/roadscanner && cd /srv/roadscanner`.
4. Create the deployment environment: copy `.env.example` to `.env` if present, then set `CERTBOT_DOMAIN=app.example.com`, `CERTBOT_EMAIL=you@example.com`, `INVITE_CODE_SECRET_KEY`, `ENCRYPTION_PASSPHRASE`, `admin_username`, and `admin_pass`. Keep `.env` mode `0600`; do not commit it. For production key persistence, use the hardened `install-docker.sh` installer, which materializes generated QRS keys into encrypted host credentials.
5. Build and start the stack: `docker compose --env-file .env up -d --build`.
6. Allow the first ACME challenge to complete, then verify HTTPS with `curl -I https://app.example.com`; the Nginx container uses a temporary self-signed certificate only until Let’s Encrypt succeeds.
7. In Cloudflare, set SSL/TLS mode to **Full (strict)**, enable proxying, keep minimum TLS 1.2, and enable HSTS only after HTTPS works end-to-end.
8. Verify operations with `docker compose ps`, `docker compose logs --tail=100 nginx certbot`, and schedule updates with `docker compose pull && docker compose up -d --build`.

The application is bound only to the internal Compose network; Nginx is the only public service. Certificate data is persisted in the `letsencrypt` volume, renewal runs automatically, and Nginx reloads periodically so renewed certificates are picked up.
