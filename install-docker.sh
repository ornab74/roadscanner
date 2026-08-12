#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

# Roadscanner hardened installer - main branch edition
#
# This installer intentionally deploys a clean origin/main checkout into /srv,
# uses a dedicated rootless Docker account, keeps provider secrets encrypted at
# rest, and materializes decrypted values only into volatile /run storage.

SERVICE_USER="${SERVICE_USER:-roadscanner}"
REPO_URL="${REPO_URL:-https://github.com/ornab74/roadscanner.git}"
REF="${REF:-main}"
APP_DIR="${APP_DIR:-/srv/roadscanner}"
CONFIG_DIR="${CONFIG_DIR:-/etc/roadscanner}"
CRED_DIR="${CRED_DIR:-$CONFIG_DIR/credentials}"
PUBLIC_ENV="${PUBLIC_ENV:-$CONFIG_DIR/public.env}"
DEPLOY_ENV="${DEPLOY_ENV:-$CONFIG_DIR/deploy.env}"
RUNTIME_SECRET_PARENT="${RUNTIME_SECRET_PARENT:-/run/roadscanner-private}"
RUNTIME_SECRET_DIR="${RUNTIME_SECRET_DIR:-$RUNTIME_SECRET_PARENT/secrets}"
STATE_DIR="${STATE_DIR:-/var/lib/roadscanner-installer}"
LOG_DIR="${LOG_DIR:-/var/log/roadscanner}"
BIND_ADDR="${BIND_ADDR:-127.0.0.1}"
PORT="${PORT:-3000}"
MEMORY_LIMIT="${MEMORY_LIMIT:-768m}"
CPU_LIMIT="${CPU_LIMIT:-1.0}"
PIDS_LIMIT="${PIDS_LIMIT:-256}"
PYTHON_IMAGE_TAG="${PYTHON_IMAGE_TAG:-python:3.12-slim}"
INSTALL_DOCKER="${INSTALL_DOCKER:-1}"
HARDEN_HOST="${HARDEN_HOST:-1}"
FORCE_SOURCE_RESET="${FORCE_SOURCE_RESET:-0}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="$LOG_DIR/install-$STAMP.log"

log(){ printf '\n\033[1;36m[ROADSCANNER] %s\033[0m\n' "$*"; }
ok(){ printf '\033[1;32m[ OK ] %s\033[0m\n' "$*"; }
warn(){ printf '\033[1;33m[WARN] %s\033[0m\n' "$*" >&2; }
die(){ printf '\033[1;31m[FAIL] %s\033[0m\n' "$*" >&2; exit 1; }
onerr(){ local rc=$?; printf 'install failed: rc=%s line=%s cmd=%s\nlog=%s\n' "$rc" "${BASH_LINENO[0]:-?}" "${BASH_COMMAND:-?}" "$LOG_FILE" >&2; exit "$rc"; }
trap onerr ERR

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "Run as root."
[[ "$REF" == "main" ]] || die "This installer deploys origin/main only."
case "$APP_DIR" in /root|/root/*) die "APP_DIR must not be under /root; use /srv/roadscanner." ;; esac
case "$BIND_ADDR" in 127.0.0.1|::1|localhost) ;; *) die "Refusing public application bind. Put a hardened TLS reverse proxy in front." ;; esac

prompt_certbot_config() {
  CERTBOT_DOMAIN="${CERTBOT_DOMAIN:-}"
  CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
  while [[ ! "$CERTBOT_DOMAIN" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]]; do
    printf 'Public hostname (for example, scan.example.com): ' >/dev/tty
    IFS= read -r CERTBOT_DOMAIN </dev/tty
  done
  while [[ ! "$CERTBOT_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]]; do
    printf 'Certbot renewal email: ' >/dev/tty
    IFS= read -r CERTBOT_EMAIL </dev/tty
  done
}
prompt_certbot_config

mkdir -p "$STATE_DIR" "$LOG_DIR"
chmod 0700 "$STATE_DIR"
chmod 0750 "$LOG_DIR"
touch "$LOG_FILE" && chmod 0600 "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

log "1/14 host prerequisites"
. /etc/os-release
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg git openssl jq uidmap dbus-user-session slirp4netns fuse-overlayfs iproute2 procps apparmor apparmor-utils acl systemd

if [[ "$INSTALL_DOCKER" == "1" ]]; then
  install -m 0755 -d /etc/apt/keyrings
  [[ "${ID:-}" == "debian" ]] && DIST=debian || DIST=ubuntu
  curl --proto '=https' --tlsv1.2 -fsSL --retry 5 "https://download.docker.com/linux/$DIST/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  ARCH="$(dpkg --print-architecture)"; CODENAME="${VERSION_CODENAME:-}"
  [[ -n "$CODENAME" ]] || die "Unable to determine OS codename."
  printf 'deb [arch=%s signed-by=%s] https://download.docker.com/linux/%s %s stable\n' "$ARCH" /etc/apt/keyrings/docker.asc "$DIST" "$CODENAME" >/etc/apt/sources.list.d/roadscanner-docker.list
  apt-get update
  apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-ce-rootless-extras docker-buildx-plugin docker-compose-plugin
fi

command -v docker >/dev/null || die "docker CLI missing"
command -v dockerd-rootless-setuptool.sh >/dev/null || die "docker rootless extras missing"
command -v systemd-creds >/dev/null || die "systemd-creds required"

log "2/14 dedicated service account + namespaces"
id "$SERVICE_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$SERVICE_USER"
for g in sudo wheel docker; do getent group "$g" >/dev/null 2>&1 && gpasswd -d "$SERVICE_USER" "$g" >/dev/null 2>&1 || true; done
for f in /etc/subuid /etc/subgid; do
  if ! grep -q "^${SERVICE_USER}:" "$f" 2>/dev/null; then
    start="$(awk -F: '{e=$2+$3;if(e>m)m=e} END{print (m<100000?100000:m)}' "$f" 2>/dev/null || echo 100000)"
    [[ "$f" == /etc/subuid ]] && usermod --add-subuids "$start-$((start+65535))" "$SERVICE_USER" || usermod --add-subgids "$start-$((start+65535))" "$SERVICE_USER"
  fi
done
UIDN="$(id -u "$SERVICE_USER")"; HOME_DIR="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
loginctl enable-linger "$SERVICE_USER"
systemctl start "user@${UIDN}.service" || true

runu(){ runuser -u "$SERVICE_USER" -- env HOME="$HOME_DIR" USER="$SERVICE_USER" LOGNAME="$SERVICE_USER" XDG_RUNTIME_DIR="/run/user/$UIDN" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UIDN/bus" PATH="/usr/local/bin:/usr/bin:/bin:$HOME_DIR/.local/bin" "$@"; }
dkr(){ runu env DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker "$@"; }

log "3/14 configuration permissions"
install -d -m 0750 -o root -g "$SERVICE_USER" "$CONFIG_DIR"
install -d -m 0700 -o root -g root "$CRED_DIR"
touch "$PUBLIC_ENV" "$DEPLOY_ENV"
chown root:"$SERVICE_USER" "$PUBLIC_ENV" "$DEPLOY_ENV"; chmod 0640 "$PUBLIC_ENV" "$DEPLOY_ENV"

log "4/14 conservative host hardening"
if [[ "$HARDEN_HOST" == 1 ]]; then
cat >/etc/sysctl.d/99-roadscanner-container-hardening.conf <<'EOF'
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2
kernel.dmesg_restrict = 1
kernel.kptr_restrict = 2
kernel.perf_event_paranoid = 3
kernel.yama.ptrace_scope = 1
kernel.unprivileged_bpf_disabled = 1
net.core.bpf_jit_harden = 2
EOF
sysctl --system >/dev/null || warn "Some hardening sysctls unsupported"
fi

log "5/14 rootless Docker"
if [[ ! -f "$HOME_DIR/.config/systemd/user/docker.service" ]]; then runu dockerd-rootless-setuptool.sh install; fi
runu systemctl --user daemon-reload
runu systemctl --user enable --now docker.service
for _ in $(seq 1 60); do dkr info >/dev/null 2>&1 && break; sleep 2; done
dkr info >/dev/null 2>&1 || die "Rootless Docker did not become ready"
dkr info --format '{{json .SecurityOptions}}' | grep -qi rootless || die "Docker is not rootless"

log "6/14 immutable source checkout"
install -d -m 0755 /srv
[[ "$FORCE_SOURCE_RESET" == 1 ]] && rm -rf "$APP_DIR"
if [[ ! -d "$APP_DIR/.git" ]]; then
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$APP_DIR"
  runu git clone --no-checkout "$REPO_URL" "$APP_DIR"
else
  chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
  setfacl -Rb "$APP_DIR" 2>/dev/null || true
fi
runu git -C "$APP_DIR" remote set-url origin "$REPO_URL"
runu git -C "$APP_DIR" fetch --force --tags --prune origin main
TARGET="$(runu git -C "$APP_DIR" rev-parse origin/main)"
runu git -C "$APP_DIR" checkout --detach --force "$TARGET"
runu git -C "$APP_DIR" reset --hard "$TARGET"
runu git -C "$APP_DIR" clean -ffd
COMMIT="$(runu git -C "$APP_DIR" rev-parse HEAD)"; SHORT="${COMMIT:0:12}"

chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
chmod 0755 /srv
find "$APP_DIR" -xdev -type d -exec chmod 0750 {} +
find "$APP_DIR" -xdev -type f -exec chmod 0640 {} +
chmod 0750 "$APP_DIR"
[[ -f "$APP_DIR/install-docker.sh" ]] && chmod 0750 "$APP_DIR/install-docker.sh"
[[ -f "$APP_DIR/scripts/runtime-security-audit.sh" ]] && chmod 0750 "$APP_DIR/scripts/runtime-security-audit.sh"
setfacl -m "u:${SERVICE_USER}:rx" /srv "$APP_DIR"
for f in compose.yaml Dockerfile requirements.txt verify.py; do
  [[ -f "$APP_DIR/$f" ]] || die "Required deployment file missing: $f"
  setfacl -m "u:${SERVICE_USER}:r" "$APP_DIR/$f"
  runu test -r "$APP_DIR/$f" || { namei -l "$APP_DIR/$f" >&2 || true; die "Service user cannot read $f"; }
done
runu test "$(runu git -C "$APP_DIR" rev-parse --show-toplevel)" = "$APP_DIR" || die "Production checkout path mismatch"
ok "Pinned origin/main commit: $COMMIT"

log "7/14 encrypted secret provisioning"
prompt_secret(){ local label="$1" value=""; while [[ -z "$value" ]]; do printf '%s: ' "$label" >/dev/tty; IFS= read -r -s value </dev/tty; printf '\n' >/dev/tty; done; printf '%s' "$value"; }
generate_b64url(){ openssl rand -base64 "${1:-48}" | tr -d '\n=' | tr '+/' '-_'; }
generate_hex(){ openssl rand -hex "${1:-64}"; }
CRED_KEY_MODE=host
if [[ -c /dev/tpmrm0 || -c /dev/tpm0 ]]; then
  ti="$(mktemp)"; to="$(mktemp)"; printf probe >"$ti"
  systemd-creds encrypt --with-key=tpm2 "$ti" "$to" >/dev/null 2>&1 && CRED_KEY_MODE=tpm2 || true
  rm -f "$ti" "$to"
fi
ok "Credential-at-rest mode: $CRED_KEY_MODE"
encrypt_credential(){ local name="$1" value="$2" tmp; tmp="$(mktemp)"; chmod 0600 "$tmp"; printf '%s' "$value" >"$tmp"; systemd-creds encrypt --with-key="$CRED_KEY_MODE" --name="$name" "$tmp" "$CRED_DIR/$name.cred" >/dev/null; rm -f "$tmp"; chmod 0600 "$CRED_DIR/$name.cred"; }
credential_exists(){ [[ -s "$CRED_DIR/$1.cred" ]]; }
if ! credential_exists OPENAI_API_KEY; then v="$(prompt_secret 'Enter OPENAI_API_KEY')"; encrypt_credential OPENAI_API_KEY "$v"; unset v; fi
if ! credential_exists XAI_API_KEY; then v="$(prompt_secret 'Enter xAI/Grok API key')"; encrypt_credential XAI_API_KEY "$v"; encrypt_credential GROK_API_KEY "$v"; unset v; fi
credential_exists admin_username || encrypt_credential admin_username "qrs_$(openssl rand -hex 6)"
credential_exists admin_pass || encrypt_credential admin_pass "$(generate_b64url 48)"
credential_exists INVITE_CODE_SECRET_KEY || encrypt_credential INVITE_CODE_SECRET_KEY "$(generate_hex 64)"
credential_exists ENCRYPTION_PASSPHRASE || encrypt_credential ENCRYPTION_PASSPHRASE "$(generate_b64url 64)"
cat >"$PUBLIC_ENV" <<EOF
STRICT_PQ2_ONLY=1
QRS_BOOTSTRAP_SHOW=0
QRS_ROTATE_SESSION_KEY=1
QRS_SESSION_KEY_ROTATION_PERIOD_SECONDS=1800
QRS_SESSION_KEY_ROTATION_LOOKBACK=8
EOF
chown root:"$SERVICE_USER" "$PUBLIC_ENV"; chmod 0640 "$PUBLIC_ENV"

log "8/14 volatile secret materialization"
cat >/usr/local/sbin/roadscanner-materialize-secrets <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
install -d -m 0710 -o root -g '$SERVICE_USER' '$RUNTIME_SECRET_PARENT'
install -d -m 0710 -o root -g '$SERVICE_USER' '$RUNTIME_SECRET_DIR'
find '$RUNTIME_SECRET_DIR' -mindepth 1 -maxdepth 1 -type f -delete
for cred in '$CRED_DIR'/*.cred; do
  [ -f "\$cred" ] || continue
  name="\$(basename "\$cred" .cred)"; tmp="\$(mktemp '$RUNTIME_SECRET_DIR/.tmp.XXXXXX')"
  systemd-creds decrypt --name="\$name" "\$cred" "\$tmp" >/dev/null
  # The private parent blocks ordinary host traversal. World-read permission on
  # the file itself is required for the rootless container's remapped app UID.
  chown 'root:$SERVICE_USER' "\$tmp"; chmod 0444 "\$tmp"; mv -f "\$tmp" '$RUNTIME_SECRET_DIR/'"\$name"
done
EOF
chmod 0700 /usr/local/sbin/roadscanner-materialize-secrets
/usr/local/sbin/roadscanner-materialize-secrets
for required in INVITE_CODE_SECRET_KEY ENCRYPTION_PASSPHRASE admin_username admin_pass; do
  [[ -s "$RUNTIME_SECRET_DIR/$required" ]] || die "Required runtime secret missing: $required"
done

log "9/14 secure container override"
cat >"$CONFIG_DIR/container-entrypoint.sh" <<'EOF'
#!/bin/sh
set -eu
for f in /run/roadscanner-secrets/*; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"; case "$name" in *[!A-Za-z0-9_]*|'') exit 70;; esac
  value="$(cat "$f")"; export "$name=$value"; unset value
done
exec gunicorn main:app -b 0.0.0.0:3000 -w "${GUNICORN_WORKERS:-2}" -k gthread --threads "${GUNICORN_THREADS:-2}" --timeout 180 --graceful-timeout 30 --log-level info --preload
EOF
chown root:"$SERVICE_USER" "$CONFIG_DIR/container-entrypoint.sh"; chmod 0555 "$CONFIG_DIR/container-entrypoint.sh"
cat >"$CONFIG_DIR/compose.secure.yaml" <<EOF
services:
  roadscanner:
    env_file: [$PUBLIC_ENV]
    environment:
      HOME: /tmp/roadscanner-home
      XDG_CACHE_HOME: /tmp/roadscanner-cache
      STRICT_PQ2_ONLY: "1"
      GUNICORN_WORKERS: "2"
      GUNICORN_THREADS: "2"
    entrypoint: ["/bin/sh", "/run/roadscanner-entrypoint.sh"]
    volumes:
      - roadscanner-data:/var/data
      - $RUNTIME_SECRET_DIR:/run/roadscanner-secrets:ro
      - $CONFIG_DIR/container-entrypoint.sh:/run/roadscanner-entrypoint.sh:ro
EOF
chown root:"$SERVICE_USER" "$CONFIG_DIR/compose.secure.yaml"; chmod 0640 "$CONFIG_DIR/compose.secure.yaml"

log "10/14 immutable base image + verified build"
dkr pull "$PYTHON_IMAGE_TAG"
PYTHON_IMAGE_DIGEST="$(dkr image inspect "$PYTHON_IMAGE_TAG" --format '{{index .RepoDigests 0}}')"
[[ "$PYTHON_IMAGE_DIGEST" == *@sha256:* ]] || die "Could not resolve base-image digest"
BUILD_DATE="$(date -u --iso-8601=seconds)"
cat >"$DEPLOY_ENV" <<EOF
ROADSCANNER_ENV_FILE=$PUBLIC_ENV
ROADSCANNER_BUILD_CONTEXT=$APP_DIR
ROADSCANNER_IMAGE=roadscanner:$SHORT
ROADSCANNER_CONTAINER=roadscanner
ROADSCANNER_BIND_ADDR=$BIND_ADDR
ROADSCANNER_PORT=$PORT
ROADSCANNER_MEMORY_LIMIT=$MEMORY_LIMIT
ROADSCANNER_CPU_LIMIT=$CPU_LIMIT
ROADSCANNER_PIDS_LIMIT=$PIDS_LIMIT
ROADSCANNER_VCS_REF=$COMMIT
ROADSCANNER_BUILD_DATE=$BUILD_DATE
PYTHON_IMAGE=$PYTHON_IMAGE_DIGEST
CERTBOT_DOMAIN=$CERTBOT_DOMAIN
CERTBOT_EMAIL=$CERTBOT_EMAIL
EOF
chown root:"$SERVICE_USER" "$DEPLOY_ENV"; chmod 0640 "$DEPLOY_ENV"
compose(){ runu env DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker compose --project-directory "$APP_DIR" --env-file "$DEPLOY_ENV" -f "$APP_DIR/compose.yaml" -f "$CONFIG_DIR/compose.secure.yaml" "$@"; }
runu test -r "$DEPLOY_ENV" || die "deploy.env unreadable"
compose config >/dev/null || die "Compose configuration invalid"
compose build --pull roadscanner
IMAGE_ID="$(dkr image inspect -f '{{.Id}}' "roadscanner:$SHORT")"

log "11/14 application PQ bootstrap"
# PQ dependency-lock verification occurs in the Dockerfile. Legacy Dilithium
# manifests intentionally fail with instructions to re-sign using ML-DSA.

log "12/14 start container"
compose up -d --remove-orphans roadscanner

log "13/14 local health check"
for _ in $(seq 1 60); do curl -fsS "http://$BIND_ADDR:$PORT/" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS "http://$BIND_ADDR:$PORT/" >/dev/null || { compose logs --tail=100 roadscanner >&2 || true; die "Roadscanner health check failed"; }

log "14/14 final security checks"
dkr inspect roadscanner --format '{{json .HostConfig.SecurityOpt}}' | grep -q no-new-privileges || die "no-new-privileges missing"
dkr inspect roadscanner --format '{{json .HostConfig.CapDrop}}' | grep -q ALL || die "cap-drop ALL missing"
ok "Roadscanner installed from $COMMIT"
ok "Image: $IMAGE_ID"
ok "Listening only on $BIND_ADDR:$PORT"
printf '\nNext: create a Cloudflare Tunnel, then run:\n'
printf '  sudo %s/scripts/install-cloudflared-docker.sh\n' "$APP_DIR"
printf 'Set its public-hostname service URL to http://roadscanner:3000.\n'
