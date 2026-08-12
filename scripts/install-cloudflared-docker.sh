#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

SERVICE_USER="${SERVICE_USER:-roadscanner}"
APP_CONTAINER="${APP_CONTAINER:-roadscanner}"
TUNNEL_CONTAINER="${TUNNEL_CONTAINER:-cloudflared}"
CLOUDFLARED_IMAGE="${CLOUDFLARED_IMAGE:-cloudflare/cloudflared:latest}"
SECRET_DIR="${SECRET_DIR:-/home/$SERVICE_USER/.config/roadscanner/cloudflared}"
TOKEN_FILE="$SECRET_DIR/tunnel-token"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "run this script with sudo"
id "$SERVICE_USER" >/dev/null 2>&1 || die "service user '$SERVICE_USER' does not exist"

SERVICE_UID="$(id -u "$SERVICE_USER")"
SERVICE_GID="$(id -g "$SERVICE_USER")"
DOCKER_HOST="unix:///run/user/$SERVICE_UID/docker.sock"

dkr() {
  runuser -u "$SERVICE_USER" -- env \
    HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)" \
    XDG_RUNTIME_DIR="/run/user/$SERVICE_UID" \
    DOCKER_HOST="$DOCKER_HOST" \
    docker "$@"
}

dkr info >/dev/null 2>&1 || die "rootless Docker is not running for '$SERVICE_USER'"
dkr inspect "$APP_CONTAINER" >/dev/null 2>&1 || die "container '$APP_CONTAINER' is not running"

APP_NETWORK="$(dkr inspect "$APP_CONTAINER" \
  --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{println}}{{end}}' \
  | sed -n '1p')"
[[ -n "$APP_NETWORK" ]] || die "could not determine the Roadscanner Docker network"

install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$SECRET_DIR"
if [[ -s "$TOKEN_FILE" ]]; then
  printf 'Reusing existing Cloudflare tunnel token.\n'
  chown "$SERVICE_USER:$SERVICE_GID" "$TOKEN_FILE"
  chmod 0400 "$TOKEN_FILE"
else
  TMP_TOKEN="$(mktemp "$SECRET_DIR/.tunnel-token.XXXXXX")"
  trap 'rm -f "$TMP_TOKEN"' EXIT

  printf 'Cloudflare tunnel token: ' >/dev/tty
  IFS= read -r -s TUNNEL_TOKEN </dev/tty
  printf '\n' >/dev/tty
  [[ -n "$TUNNEL_TOKEN" ]] || die "token cannot be empty"
  [[ "$TUNNEL_TOKEN" != *[[:space:]]* ]] || die "token must not contain whitespace"

  printf '%s' "$TUNNEL_TOKEN" >"$TMP_TOKEN"
  unset TUNNEL_TOKEN
  chown "$SERVICE_USER:$SERVICE_GID" "$TMP_TOKEN"
  chmod 0400 "$TMP_TOKEN"
  mv -f "$TMP_TOKEN" "$TOKEN_FILE"
  trap - EXIT
fi

dkr pull "$CLOUDFLARED_IMAGE"
if dkr inspect "$TUNNEL_CONTAINER" >/dev/null 2>&1; then
  dkr rm -f "$TUNNEL_CONTAINER" >/dev/null
fi

dkr run -d \
  --name "$TUNNEL_CONTAINER" \
  --restart unless-stopped \
  --network "$APP_NETWORK" \
  --user 0:0 \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
  --mount "type=bind,src=$TOKEN_FILE,dst=/run/secrets/cloudflare-tunnel-token,readonly" \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 128 \
  --memory 128m \
  "$CLOUDFLARED_IMAGE" \
  tunnel --no-autoupdate --protocol quic run --post-quantum \
  --token-file /run/secrets/cloudflare-tunnel-token

printf '\nCloudflared is running on Docker network %s.\n' "$APP_NETWORK"
printf 'Tunnel transport: strict post-quantum QUIC (outbound UDP port 7844 required).\n'
printf 'Set the Cloudflare public-hostname service URL to: http://%s:3000\n' "$APP_CONTAINER"
printf 'Check status with: sudo -iu %s env DOCKER_HOST=%s docker logs --tail 100 %s\n' \
  "$SERVICE_USER" "$DOCKER_HOST" "$TUNNEL_CONTAINER"
