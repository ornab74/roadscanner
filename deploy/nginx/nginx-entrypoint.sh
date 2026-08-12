#!/bin/sh
set -eu
cert="/etc/letsencrypt/live/${CERTBOT_DOMAIN}"
if [ ! -s "$cert/fullchain.pem" ] || [ ! -s "$cert/privkey.pem" ]; then
  mkdir -p "$cert"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "$cert/privkey.pem" -out "$cert/fullchain.pem" \
    -subj "/CN=${CERTBOT_DOMAIN}" >/dev/null 2>&1
fi
/docker-entrypoint.sh nginx -g 'daemon off;' &
pid="$!"
while kill -0 "$pid" 2>/dev/null; do
  sleep 300
  nginx -s reload >/dev/null 2>&1 || true
done
wait "$pid"
