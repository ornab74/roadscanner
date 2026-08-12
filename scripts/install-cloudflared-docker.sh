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
CRED_DIR="${CRED_DIR:-/etc/roadscanner/credentials}"
TOKEN_CRED="$CRED_DIR/CLOUDFLARE_TUNNEL_TOKEN.cred"
SERVICE_UID="$(id -u "$SERVICE_USER")"
RUNTIME_TOKEN_FILE="${RUNTIME_TOKEN_FILE:-/run/user/$SERVICE_UID/roadscanner-private/secrets/CLOUDFLARE_TUNNEL_TOKEN}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "run this script with sudo"
id "$SERVICE_USER" >/dev/null 2>&1 || die "service user '$SERVICE_USER' does not exist"

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

install -d -m 0700 -o root -g root "$CRED_DIR"

CRED_KEY_MODE=host
if [[ -c /dev/tpmrm0 || -c /dev/tpm0 ]]; then
  TPM_IN="$(mktemp)"
  TPM_OUT="$(mktemp)"
  printf probe >"$TPM_IN"
  if systemd-creds encrypt --with-key=tpm2 "$TPM_IN" "$TPM_OUT" >/dev/null 2>&1; then
    CRED_KEY_MODE=tpm2
  fi
  rm -f "$TPM_IN" "$TPM_OUT"
fi

encrypt_token() {
  local value="$1" tmp
  tmp="$(mktemp /run/roadscanner-cloudflare-token.XXXXXX)"
  chmod 0600 "$tmp"
  printf '%s' "$value" >"$tmp"
  if ! systemd-creds encrypt --with-key="$CRED_KEY_MODE" \
    --name=CLOUDFLARE_TUNNEL_TOKEN "$tmp" "$TOKEN_CRED" >/dev/null; then
    rm -f "$tmp"
    die "failed to encrypt the Cloudflare tunnel token"
  fi
  rm -f "$tmp"
  chown root:root "$TOKEN_CRED"
  chmod 0600 "$TOKEN_CRED"
}

if [[ ! -s "$TOKEN_CRED" ]]; then
  if [[ -s "$TOKEN_FILE" ]]; then
    printf 'Migrating the legacy Cloudflare token into encrypted credential storage.\n'
    TUNNEL_TOKEN="$(<"$TOKEN_FILE")"
  else
    printf 'Cloudflare tunnel token: ' >/dev/tty
    IFS= read -r -s TUNNEL_TOKEN </dev/tty
    printf '\n' >/dev/tty
  fi

  [[ -n "$TUNNEL_TOKEN" ]] || die "token cannot be empty"
  [[ "$TUNNEL_TOKEN" != *[[:space:]]* ]] || die "token must not contain whitespace"
  encrypt_token "$TUNNEL_TOKEN"
  unset TUNNEL_TOKEN
fi

# Remove the old plaintext token after successful encryption.
if [[ -e "$TOKEN_FILE" ]]; then
  if command -v shred >/dev/null 2>&1; then
    shred -u "$TOKEN_FILE" 2>/dev/null || rm -f "$TOKEN_FILE"
  else
    rm -f "$TOKEN_FILE"
  fi
fi

if systemctl list-unit-files roadscanner-secrets.service --no-legend 2>/dev/null | grep -q roadscanner-secrets; then
  systemctl restart roadscanner-secrets.service
else
  /usr/local/sbin/roadscanner-materialize-secrets
fi
[[ -s "$RUNTIME_TOKEN_FILE" ]] || die "encrypted tunnel token was not materialized"
printf 'Using encrypted Cloudflare credential (%s at rest).\n' "$CRED_KEY_MODE"

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
  --mount "type=bind,src=$RUNTIME_TOKEN_FILE,dst=/run/secrets/cloudflare-tunnel-token,readonly" \
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
