#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

# Roadscanner hardened installer - main branch edition
#
# Design goals:
#   * rootless Docker under a dedicated non-sudo service account
#   * immutable source checkout under /srv, never /root
#   * main-branch-only deployment pinned to the fetched origin/main commit
#   * secrets never echoed or written to installer logs
#   * credentials encrypted at rest with systemd-creds
#       - TPM2 when available and usable
#       - otherwise host-bound systemd credential encryption
#   * decrypted secrets exist only under /run (tmpfs) and are removed on stop
#   * Docker receives secrets as read-only files, not Compose environment values
#   * app entrypoint converts secret files to process environment only inside
#     the container; docker inspect therefore does not contain the secret values
#   * source, configuration and runtime permissions are explicit and repeatable

SERVICE_USER="${SERVICE_USER:-roadscanner}"
REPO_URL="${REPO_URL:-https://github.com/ornab74/roadscanner.git}"
REF="${REF:-main}"
APP_DIR="${APP_DIR:-/srv/roadscanner}"
CONFIG_DIR="${CONFIG_DIR:-/etc/roadscanner}"
CRED_DIR="${CRED_DIR:-$CONFIG_DIR/credentials}"
PUBLIC_ENV="${PUBLIC_ENV:-$CONFIG_DIR/public.env}"
DEPLOY_ENV="${DEPLOY_ENV:-$CONFIG_DIR/deploy.env}"
# Resolved after the dedicated rootless Docker UID exists.
RUNTIME_SECRET_PARENT=""
RUNTIME_SECRET_DIR=""
STATE_DIR="${STATE_DIR:-/var/lib/roadscanner-installer}"
LOG_DIR="${LOG_DIR:-/var/log/roadscanner}"
BIND_ADDR="${BIND_ADDR:-127.0.0.1}"
PORT="${PORT:-3000}"

# 1 GiB VPS-friendly defaults. Override if you upgrade the Droplet.
MEMORY_LIMIT="${MEMORY_LIMIT:-768m}"
CPU_LIMIT="${CPU_LIMIT:-1.0}"
PIDS_LIMIT="${PIDS_LIMIT:-256}"

PYTHON_IMAGE_TAG="${PYTHON_IMAGE_TAG:-python:3.12-slim}"
INSTALL_DOCKER="${INSTALL_DOCKER:-1}"
HARDEN_HOST="${HARDEN_HOST:-1}"
REQUIRE_APPARMOR="${REQUIRE_APPARMOR:-auto}"
FORCE_SOURCE_RESET="${FORCE_SOURCE_RESET:-0}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="$LOG_DIR/install-$STAMP.log"
MANIFEST="$STATE_DIR/manifest-$STAMP.txt"
BOOT_TMP=""

log(){ printf '\n\033[1;36m[ROADSCANNER] %s\033[0m\n' "$*"; }
ok(){ printf '\033[1;32m[ OK ] %s\033[0m\n' "$*"; }
warn(){ printf '\033[1;33m[WARN] %s\033[0m\n' "$*" >&2; }
die(){ printf '\033[1;31m[FAIL] %s\033[0m\n' "$*" >&2; exit 1; }

cleanup() {
  [[ -n "${BOOT_TMP:-}" ]] && rm -f "$BOOT_TMP" 2>/dev/null || true
}
onerr() {
  local rc=$?
  printf 'install failed: rc=%s line=%s cmd=%s\nlog=%s\n' \
    "$rc" "${BASH_LINENO[0]:-?}" "${BASH_COMMAND:-?}" "$LOG_FILE" >&2
  exit "$rc"
}
trap cleanup EXIT
trap onerr ERR

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "Run as root."
case "$APP_DIR" in /root|/root/*) die "APP_DIR must not be under /root; use /srv/roadscanner." ;; esac
case "$BIND_ADDR" in
  127.0.0.1|::1|localhost) ;;
  *) die "Refusing non-loopback bind ($BIND_ADDR). Put Cloudflare Tunnel in front." ;;
esac

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
touch "$LOG_FILE"
chmod 0600 "$LOG_FILE"

# Log only non-secret installer output.
exec > >(tee -a "$LOG_FILE") 2>&1

log "1/14 host prerequisites"
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) warn "Installer is designed for Ubuntu/Debian; detected ${ID:-unknown}." ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git openssl jq \
  uidmap dbus-user-session slirp4netns fuse-overlayfs \
  iproute2 procps apparmor apparmor-utils acl systemd

if [[ "$INSTALL_DOCKER" == "1" ]]; then
  install -m 0755 -d /etc/apt/keyrings
  [[ "${ID:-}" == "debian" ]] && DIST=debian || DIST=ubuntu
  if [[ ! -s /etc/apt/keyrings/docker.asc ]]; then
    curl --proto '=https' --tlsv1.2 -fsSL --retry 5 \
      "https://download.docker.com/linux/$DIST/gpg" \
      -o /etc/apt/keyrings/docker.asc
  fi
  chmod a+r /etc/apt/keyrings/docker.asc
  ARCH="$(dpkg --print-architecture)"
  CODENAME="${VERSION_CODENAME:-}"
  [[ -n "$CODENAME" ]] || die "Unable to determine OS codename."
  printf 'deb [arch=%s signed-by=%s] https://download.docker.com/linux/%s %s stable\n' \
    "$ARCH" /etc/apt/keyrings/docker.asc "$DIST" "$CODENAME" \
    >/etc/apt/sources.list.d/roadscanner-docker.list
  apt-get update
  apt-get install -y --no-install-recommends \
    docker-ce docker-ce-cli containerd.io docker-ce-rootless-extras \
    docker-buildx-plugin docker-compose-plugin
fi

command -v docker >/dev/null || die "docker CLI missing"
command -v dockerd-rootless-setuptool.sh >/dev/null || die "docker rootless extras missing"
command -v systemd-creds >/dev/null || die "systemd-creds is required"

log "2/14 dedicated service account + namespaces"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$SERVICE_USER"
fi
for g in sudo wheel docker; do
  if getent group "$g" >/dev/null 2>&1; then
    gpasswd -d "$SERVICE_USER" "$g" >/dev/null 2>&1 || true
  fi
done

for spec in "/etc/subuid:--add-subuids" "/etc/subgid:--add-subgids"; do
  f="${spec%%:*}"
  flag="${spec##*:}"
  if ! grep -q "^${SERVICE_USER}:" "$f" 2>/dev/null; then
    start="$(awk -F: '{e=$2+$3;if(e>m)m=e} END{print (m<100000?100000:m)}' "$f" 2>/dev/null || echo 100000)"
    usermod "$flag" "$start-$((start+65535))" "$SERVICE_USER"
  fi
done

UIDN="$(id -u "$SERVICE_USER")"
GIDN="$(id -g "$SERVICE_USER")"
HOME_DIR="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
RUNTIME_SECRET_PARENT="/run/user/$UIDN/roadscanner-private"
RUNTIME_SECRET_DIR="$RUNTIME_SECRET_PARENT/secrets"

loginctl enable-linger "$SERVICE_USER"
systemctl start "user@${UIDN}.service" || true

runu() {
  runuser -u "$SERVICE_USER" -- env \
    HOME="$HOME_DIR" USER="$SERVICE_USER" LOGNAME="$SERVICE_USER" \
    XDG_RUNTIME_DIR="/run/user/$UIDN" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UIDN/bus" \
    PATH="/usr/local/bin:/usr/bin:/bin:$HOME_DIR/.local/bin" "$@"
}
dkr() {
  runu env DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker "$@"
}

log "3/14 configuration permissions"
install -d -m 0750 -o root -g "$SERVICE_USER" "$CONFIG_DIR"
install -d -m 0700 -o root -g root "$CRED_DIR"
# Service account may traverse CONFIG_DIR but not encrypted credential storage.
# public.env/deploy.env are non-secret and group-readable.
touch "$PUBLIC_ENV" "$DEPLOY_ENV"
chown root:"$SERVICE_USER" "$PUBLIC_ENV" "$DEPLOY_ENV"
chmod 0640 "$PUBLIC_ENV" "$DEPLOY_ENV"

log "4/14 conservative host hardening"
if [[ "$HARDEN_HOST" == "1" ]]; then
  cat >/etc/sysctl.d/99-roadscanner-container-hardening.conf <<'SYSCTL'
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
SYSCTL
  sysctl --system >/dev/null || warn "Some hardening sysctls were unsupported."
fi

if [[ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]]; then
  sysctl -w kernel.apparmor_restrict_unprivileged_userns=1 >/dev/null
  cat >/etc/apparmor.d/usr.bin.rootlesskit <<'AA'
abi <abi/4.0>,
include <tunables/global>
/usr/bin/rootlesskit flags=(unconfined) {
  userns,
  include if exists <local/usr.bin.rootlesskit>
}
AA
  apparmor_parser -r /etc/apparmor.d/usr.bin.rootlesskit \
    || die "Failed to load RootlessKit AppArmor profile"
fi

log "5/14 rootless Docker"
if [[ ! -f "$HOME_DIR/.config/systemd/user/docker.service" ]]; then
  runu dockerd-rootless-setuptool.sh install
fi
DROPIN="$HOME_DIR/.config/systemd/user/docker.service.d"
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DROPIN"
cat >"$DROPIN/90-roadscanner-network.conf" <<'DROP'
[Service]
Environment="DOCKERD_ROOTLESS_ROOTLESSKIT_NET=slirp4netns"
Environment="DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=slirp4netns"
DROP
chown "$SERVICE_USER:$SERVICE_USER" "$DROPIN/90-roadscanner-network.conf"

runu systemctl --user daemon-reload
runu systemctl --user enable docker.service
runu systemctl --user restart docker.service

for _ in $(seq 1 60); do
  dkr info >/dev/null 2>&1 && break
  sleep 2
done
dkr info >/dev/null 2>&1 || die "Rootless Docker did not become ready"

SECURITY="$(dkr info --format '{{json .SecurityOptions}}')"
grep -qi rootless <<<"$SECURITY" || die "Docker is not rootless"
grep -qi seccomp <<<"$SECURITY" || die "Docker seccomp is unavailable"

if [[ "$REQUIRE_APPARMOR" == auto ]]; then
  if command -v aa-enabled >/dev/null 2>&1 && aa-enabled >/dev/null 2>&1; then
    REQUIRE_APPARMOR=1
  else
    REQUIRE_APPARMOR=0
  fi
fi

log "6/14 immutable source checkout"
install -d -m 0755 /srv

# The installer itself is expected to live on the repository's main branch.
# Deployment never builds from the caller's working tree. Instead, it fetches
# origin/main into /srv/roadscanner and checks out the exact fetched commit in
# detached-HEAD mode. This prevents local edits in ~/roadscanner from affecting
# the production image.
if [[ "$REF" != "main" ]]; then
  die "This installer is main-branch-only. REF must be 'main'."
fi

if [[ -d "$APP_DIR/.git" && "$FORCE_SOURCE_RESET" != "1" ]]; then
  chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
  # Discard deployment-tree modifications only. The user's source checkout
  # containing this installer is never touched.
  runu git -C "$APP_DIR" reset --hard >/dev/null 2>&1 || true
  runu git -C "$APP_DIR" clean -ffd >/dev/null 2>&1 || true
else
  rm -rf "$APP_DIR"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$APP_DIR"
  runu git clone --no-checkout "$REPO_URL" "$APP_DIR"
fi

runu git -C "$APP_DIR" remote set-url origin "$REPO_URL"
runu git -C "$APP_DIR" fetch --force --tags --prune origin main

TARGET="$(runu git -C "$APP_DIR" rev-parse origin/main)"
runu git -C "$APP_DIR" checkout --detach --force "$TARGET"
runu git -C "$APP_DIR" reset --hard "$TARGET"
runu git -C "$APP_DIR" clean -ffd

COMMIT="$(runu git -C "$APP_DIR" rev-parse HEAD)"
SHORT="${COMMIT:0:12}"
SOURCE_ARCHIVE_SHA256="$(
  runu git -C "$APP_DIR" archive --format=tar HEAD |
  sha256sum | awk '{print $1}'
)"

# Normalize readability explicitly for rootless Docker/Compose.
chown -R root:root "$APP_DIR"
find "$APP_DIR" -xdev -type d -exec chmod 0755 {} +
find "$APP_DIR" -xdev -type f -exec chmod 0644 {} +
chmod 0755 "$APP_DIR"
[[ -f "$APP_DIR/install-docker.sh" ]] && chmod 0755 "$APP_DIR/install-docker.sh"
[[ -f "$APP_DIR/install-roadscanner-secure-main.sh" ]] && chmod 0755 "$APP_DIR/install-roadscanner-secure-main.sh"
[[ -f "$APP_DIR/scripts/runtime-security-audit.sh" ]] && chmod 0755 "$APP_DIR/scripts/runtime-security-audit.sh"
[[ -f "$APP_DIR/scripts/install-cloudflared-docker.sh" ]] && chmod 0755 "$APP_DIR/scripts/install-cloudflared-docker.sh"

runu test -r "$APP_DIR/compose.yaml" || die "Service user cannot read compose.yaml"
runu test -r "$APP_DIR/Dockerfile" || die "Service user cannot read Dockerfile"

ok "Pinned origin/main commit: $COMMIT"

log "7/14 encrypted secret provisioning"

# Keep secret input off stdout/stderr so tee/logging never receives it.
prompt_secret() {
  local label="$1"
  local value=""
  while [[ -z "$value" ]]; do
    printf '%s: ' "$label" >/dev/tty
    IFS= read -r -s value </dev/tty
    printf '\n' >/dev/tty
  done
  printf '%s' "$value"
}

generate_b64url() {
  local bytes="${1:-48}"
  openssl rand -base64 "$bytes" | tr -d '\n=' | tr '+/' '-_'
}

generate_hex() {
  openssl rand -hex "${1:-64}"
}

# Detect strongest local systemd credential protection.
CRED_KEY_MODE="host"
if [[ -c /dev/tpmrm0 || -c /dev/tpm0 ]]; then
  # Test TPM-backed encryption without retaining the test blob.
  TEST_IN="$(mktemp)"
  TEST_OUT="$(mktemp)"
  printf 'roadscanner-tpm-probe' >"$TEST_IN"
  if systemd-creds encrypt --with-key=tpm2 "$TEST_IN" "$TEST_OUT" >/dev/null 2>&1; then
    CRED_KEY_MODE="tpm2"
  fi
  rm -f "$TEST_IN" "$TEST_OUT"
fi
ok "Credential-at-rest mode: $CRED_KEY_MODE"

encrypt_credential() {
  local name="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  chmod 0600 "$tmp"
  printf '%s' "$value" >"$tmp"
  systemd-creds encrypt --with-key="$CRED_KEY_MODE" \
    --name="$name" "$tmp" "$CRED_DIR/$name.cred" >/dev/null
  rm -f "$tmp"
  chmod 0600 "$CRED_DIR/$name.cred"
  chown root:root "$CRED_DIR/$name.cred"
}

credential_exists() {
  [[ -s "$CRED_DIR/$1.cred" ]]
}

# Migrate the legacy plaintext env created by installer v1, preserving PQ keys
# so existing encrypted application data remains decryptable. Then remove the
# plaintext source. Values are never printed.
LEGACY_ENV="$CONFIG_DIR/roadscanner.env"
if [[ -f "$LEGACY_ENV" ]]; then
  warn "Migrating legacy plaintext roadscanner.env into encrypted credentials."
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ -n "$value" ]] || continue
    case "$key" in
      STRICT_PQ2_ONLY|QRS_BOOTSTRAP_SHOW|QRS_ROTATE_SESSION_KEY|QRS_SESSION_KEY_ROTATION_PERIOD_SECONDS|QRS_SESSION_KEY_ROTATION_LOOKBACK)
        continue
        ;;
    esac
    if ! credential_exists "$key"; then
      encrypt_credential "$key" "$value"
    fi
    unset value
  done <"$LEGACY_ENV"
  if command -v shred >/dev/null 2>&1; then
    shred -u "$LEGACY_ENV" 2>/dev/null || rm -f "$LEGACY_ENV"
  else
    rm -f "$LEGACY_ENV"
  fi
fi

store_if_missing_generated() {
  local name="$1"
  local generator="$2"
  if ! credential_exists "$name"; then
    local value
    value="$(eval "$generator")"
    encrypt_credential "$name" "$value"
    unset value
  fi
}

# User-supplied provider keys. Never echo them.
if ! credential_exists OPENAI_API_KEY; then
  OPENAI_API_KEY="$(prompt_secret 'Enter OPENAI_API_KEY')"
  encrypt_credential OPENAI_API_KEY "$OPENAI_API_KEY"
  unset OPENAI_API_KEY
fi

if ! credential_exists XAI_API_KEY; then
  XAI_API_KEY="$(prompt_secret 'Enter xAI/Grok API key')"
  encrypt_credential XAI_API_KEY "$XAI_API_KEY"
  # Alias for code that expects GROK_API_KEY.
  encrypt_credential GROK_API_KEY "$XAI_API_KEY"
  unset XAI_API_KEY
fi

# Generate all local secrets with the kernel/OpenSSL CSPRNG.
if ! credential_exists admin_username; then
  ADMIN_USERNAME="qrs_$(openssl rand -hex 6)"
  encrypt_credential admin_username "$ADMIN_USERNAME"
  unset ADMIN_USERNAME
fi
if ! credential_exists admin_pass; then
  ADMIN_PASSWORD="$(generate_b64url 48)"
  encrypt_credential admin_pass "$ADMIN_PASSWORD"
  unset ADMIN_PASSWORD
fi
if ! credential_exists INVITE_CODE_SECRET_KEY; then
  encrypt_credential INVITE_CODE_SECRET_KEY "$(generate_hex 64)"
fi
if ! credential_exists ENCRYPTION_PASSPHRASE; then
  encrypt_credential ENCRYPTION_PASSPHRASE "$(generate_b64url 64)"
fi

# Non-secret runtime configuration only.
cat >"$PUBLIC_ENV" <<EOF
STRICT_PQ2_ONLY=1
QRS_BOOTSTRAP_SHOW=0
QRS_ROTATE_SESSION_KEY=1
QRS_SESSION_KEY_ROTATION_PERIOD_SECONDS=1800
QRS_SESSION_KEY_ROTATION_LOOKBACK=8
EOF
chown root:"$SERVICE_USER" "$PUBLIC_ENV"
chmod 0640 "$PUBLIC_ENV"

log "8/14 secret materialization service"

cat >/usr/local/sbin/roadscanner-materialize-secrets <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
CRED_DIR='$CRED_DIR'
RUNTIME_DIR='$RUNTIME_SECRET_DIR'
RUNTIME_PARENT='$RUNTIME_SECRET_PARENT'
SERVICE_USER='$SERVICE_USER'
install -d -m 0700 -o "\$SERVICE_USER" -g "\$SERVICE_USER" "\$RUNTIME_PARENT"
install -d -m 0755 -o "\$SERVICE_USER" -g "\$SERVICE_USER" "\$RUNTIME_DIR"
find "\$RUNTIME_DIR" -mindepth 1 -maxdepth 1 -type f -delete
shopt -s nullglob
for cred in "\$CRED_DIR"/*.cred; do
  name="\$(basename "\$cred" .cred)"
  tmp="\$(mktemp "\$RUNTIME_DIR/.tmp.XXXXXX")"
  systemd-creds decrypt --name="\$name" "\$cred" "\$tmp" >/dev/null
  chown root:"\$SERVICE_USER" "\$tmp"
  # Host access is blocked by the private parent. 0444 allows remapped container UID 10001 to read.
  chmod 0444 "\$tmp"
  mv -f "\$tmp" "\$RUNTIME_DIR/\$name"
done
EOF
chmod 0700 /usr/local/sbin/roadscanner-materialize-secrets

cat >/usr/local/sbin/roadscanner-clear-secrets <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
rm -rf '$RUNTIME_SECRET_PARENT'
EOF
chmod 0700 /usr/local/sbin/roadscanner-clear-secrets

cat >/etc/systemd/system/roadscanner-secrets.service <<EOF
[Unit]
Description=Materialize Roadscanner encrypted credentials into volatile runtime storage
Before=roadscanner-container.service
After=local-fs.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/roadscanner-materialize-secrets
ExecStop=/usr/local/sbin/roadscanner-clear-secrets
RemainAfterExit=yes
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=-$RUNTIME_SECRET_PARENT
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable roadscanner-secrets.service
systemctl restart roadscanner-secrets.service
for required in INVITE_CODE_SECRET_KEY ENCRYPTION_PASSPHRASE admin_username admin_pass; do
  [[ -s "$RUNTIME_SECRET_DIR/$required" ]] || die "Required runtime secret missing: $required"
done

log "9/14 secure in-container entrypoint"

# Secret values never appear in Compose environment or docker inspect.
cat >"$CONFIG_DIR/container-entrypoint.sh" <<'ENTRY'
#!/bin/sh
set -eu

for required in INVITE_CODE_SECRET_KEY ENCRYPTION_PASSPHRASE admin_username admin_pass; do
  file="/run/roadscanner-secrets/$required"
  [ -s "$file" ] || { echo "fatal: required secret file missing: $required" >&2; exit 78; }
done

for f in /run/roadscanner-secrets/*; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  case "$name" in
    *[!A-Za-z0-9_]*|'') echo "invalid secret filename" >&2; exit 70 ;;
  esac
  value="$(cat "$f")"
  export "$name=$value"
  unset value
done

exec gunicorn main:app \
  -b 0.0.0.0:3000 \
  -w "${GUNICORN_WORKERS:-2}" \
  -k gthread \
  --threads "${GUNICORN_THREADS:-2}" \
  --timeout 180 \
  --graceful-timeout 30 \
  --log-level info \
  --preload \
  --max-requests 1000 \
  --max-requests-jitter 200
ENTRY
chown root:"$SERVICE_USER" "$CONFIG_DIR/container-entrypoint.sh"
chmod 0555 "$CONFIG_DIR/container-entrypoint.sh"

cat >"$CONFIG_DIR/compose.secure.yaml" <<EOF
services:
  roadscanner:
    env_file:
      - $PUBLIC_ENV
    environment:
      HOME: /tmp/roadscanner-home
      XDG_CACHE_HOME: /tmp/roadscanner-cache
      PYTHONDONTWRITEBYTECODE: "1"
      PYTHONUNBUFFERED: "1"
      STRICT_PQ2_ONLY: "1"
      QRS_BOOTSTRAP_SHOW: "0"
      GUNICORN_WORKERS: "2"
      GUNICORN_THREADS: "2"
    entrypoint:
      - /bin/sh
      - /run/roadscanner-entrypoint.sh
    volumes:
      - type: volume
        source: roadscanner-data
        target: /var/data
      - type: bind
        source: $RUNTIME_SECRET_DIR
        target: /run/roadscanner-secrets
        read_only: true
      - type: bind
        source: $CONFIG_DIR/container-entrypoint.sh
        target: /run/roadscanner-entrypoint.sh
        read_only: true
EOF
chown root:"$SERVICE_USER" "$CONFIG_DIR/compose.secure.yaml"
chmod 0640 "$CONFIG_DIR/compose.secure.yaml"

log "10/14 immutable base-image resolution + image build"
dkr pull "$PYTHON_IMAGE_TAG"
PYTHON_IMAGE_DIGEST="$(
  dkr image inspect "$PYTHON_IMAGE_TAG" \
    --format '{{index .RepoDigests 0}}' 2>/dev/null || true
)"
[[ "$PYTHON_IMAGE_DIGEST" == *@sha256:* ]] \
  || die "Could not resolve immutable digest for $PYTHON_IMAGE_TAG"

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
chown root:"$SERVICE_USER" "$DEPLOY_ENV"
chmod 0640 "$DEPLOY_ENV"

compose() {
  runu env DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" \
    docker compose \
      --project-directory "$APP_DIR" \
      --env-file "$DEPLOY_ENV" \
      -f "$APP_DIR/compose.yaml" \
      -f "$CONFIG_DIR/compose.secure.yaml" "$@"
}

# Prove the exact files needed by rootless Compose are readable.
runu test -r "$APP_DIR/compose.yaml" || die "compose.yaml unreadable"
runu test -r "$CONFIG_DIR/compose.secure.yaml" || die "secure compose override unreadable"
runu test -r "$DEPLOY_ENV" || die "deploy.env unreadable"

compose build --pull roadscanner
IMAGE_ID="$(dkr image inspect -f '{{.Id}}' "roadscanner:$SHORT")"

dkr run --rm --network none \
  --entrypoint /bin/sh \
  -v "$RUNTIME_SECRET_DIR:/run/roadscanner-secrets:ro" \
  "roadscanner:$SHORT" -c '
    set -eu
    for required in INVITE_CODE_SECRET_KEY ENCRYPTION_PASSPHRASE admin_username admin_pass; do
      test -s "/run/roadscanner-secrets/$required" || exit 78
    done
  ' || die "Final image cannot read required runtime secrets"

log "11/14 application PQ bootstrap"
# Existing encrypted QRS credentials are materialized automatically. If this is
# first boot, run bootstrap without network and capture only QRS export lines.
if [[ ! -s "$CRED_DIR/QRS_X25519_PRIV_ENC_B64.cred" ]]; then
  BOOT_TMP="$(mktemp /run/roadscanner-pq-bootstrap.XXXXXX)"
  chmod 0600 "$BOOT_TMP"

  set +e
  dkr run --rm --network none \
    -v "$RUNTIME_SECRET_DIR:/run/roadscanner-secrets:ro" \
    -v "$CONFIG_DIR/container-entrypoint.sh:/run/roadscanner-entrypoint.sh:ro" \
    --env-file "$PUBLIC_ENV" \
    -e QRS_BOOTSTRAP_SHOW=1 \
    --entrypoint /bin/sh \
    "roadscanner:$SHORT" \
    -c '
      set -eu
      for f in /run/roadscanner-secrets/*; do
        [ -f "$f" ] || continue
        n="$(basename "$f")"
        v="$(cat "$f")"
        export "$n=$v"
        unset v
      done
      python -c "import main; print(\"ROADSCANNER_BOOTSTRAP_COMPLETE\")"
    ' >"$BOOT_TMP" 2>&1
  rc=$?
  set -e

  if [[ $rc -ne 0 ]]; then
    sed -E 's/(export [A-Z0-9_]+=).*/\1<redacted>/' "$BOOT_TMP" | tail -100 >&2
    die "PQ bootstrap failed"
  fi

  # Encrypt each generated QRS value immediately. Never write a persistent
  # plaintext env file.
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^QRS_[A-Z0-9_]+$ ]] || continue
    encrypt_credential "$key" "$value"
  done < <(
    grep '^export QRS_' "$BOOT_TMP" |
      sed -E "s/^export ([A-Z0-9_]+)='(.*)'$/\1=\2/"
  )

  rm -f "$BOOT_TMP"
  BOOT_TMP=""
  systemctl restart roadscanner-secrets.service
fi

for k in QRS_X25519_PRIV_ENC_B64 QRS_PQ_PRIV_ENC_B64 QRS_SIG_PRIV_ENC_B64; do
  [[ -s "$CRED_DIR/$k.cred" ]] || die "PQ bootstrap missing encrypted credential: $k"
done

log "12/14 persistent data volume"
dkr volume create roadscanner-data >/dev/null
dkr run --rm --network none --read-only \
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE \
  -v roadscanner-data:/var/data \
  "$PYTHON_IMAGE_DIGEST" \
  /bin/chown -R 10001:10001 /var/data

log "13/14 hardened container service"
cat >/usr/local/bin/roadscanner-compose <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
exec runuser -u '$SERVICE_USER' -- env \
  HOME='$HOME_DIR' USER='$SERVICE_USER' LOGNAME='$SERVICE_USER' \
  XDG_RUNTIME_DIR='/run/user/$UIDN' \
  DBUS_SESSION_BUS_ADDRESS='unix:path=/run/user/$UIDN/bus' \
  DOCKER_HOST='unix:///run/user/$UIDN/docker.sock' \
  docker compose \
    --project-directory '$APP_DIR' \
    --env-file '$DEPLOY_ENV' \
    -f '$APP_DIR/compose.yaml' \
    -f '$CONFIG_DIR/compose.secure.yaml' "\$@"
EOF
chmod 0700 /usr/local/bin/roadscanner-compose

cat >/usr/local/bin/roadscanner-docker <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
exec runuser -u '$SERVICE_USER' -- env \
  HOME='$HOME_DIR' USER='$SERVICE_USER' LOGNAME='$SERVICE_USER' \
  XDG_RUNTIME_DIR='/run/user/$UIDN' \
  DBUS_SESSION_BUS_ADDRESS='unix:path=/run/user/$UIDN/bus' \
  DOCKER_HOST='unix:///run/user/$UIDN/docker.sock' docker "\$@"
EOF
chmod 0700 /usr/local/bin/roadscanner-docker

cat >/etc/systemd/system/roadscanner-container.service <<EOF
[Unit]
Description=Roadscanner rootless hardened container
Requires=roadscanner-secrets.service
After=roadscanner-secrets.service network-online.target user@${UIDN}.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/roadscanner-compose up -d --remove-orphans roadscanner
ExecStop=/usr/local/bin/roadscanner-compose down
TimeoutStartSec=300
TimeoutStopSec=90
NoNewPrivileges=yes
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable roadscanner-container.service
systemctl restart roadscanner-secrets.service
systemctl restart roadscanner-container.service

for _ in $(seq 1 90); do
  h="$(dkr inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' roadscanner 2>/dev/null || true)"
  [[ "$h" == healthy ]] && break
  if [[ "$h" == unhealthy ]]; then
    dkr logs --tail 150 roadscanner || true
    die "Container unhealthy"
  fi
  sleep 2
done
h="$(dkr inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' roadscanner)"
[[ "$h" == healthy ]] || die "Container failed health check: $h"

APPARMOR_PROFILE="$(dkr inspect -f '{{.AppArmorProfile}}' roadscanner 2>/dev/null || true)"
if [[ "$REQUIRE_APPARMOR" == 1 ]]; then
  [[ -n "$APPARMOR_PROFILE" && "$APPARMOR_PROFILE" != unconfined ]] \
    || die "AppArmor required but container is unconfined"
fi

# Verify no sensitive values are stored in Docker's configured environment.
DOCKER_ENV="$(dkr inspect -f '{{range .Config.Env}}{{println .}}{{end}}' roadscanner)"
for k in OPENAI_API_KEY XAI_API_KEY GROK_API_KEY admin_pass INVITE_CODE_SECRET_KEY ENCRYPTION_PASSPHRASE; do
  if grep -q "^${k}=" <<<"$DOCKER_ENV"; then
    die "Secret $k leaked into Docker Config.Env"
  fi
done
unset DOCKER_ENV

log "14/14 manifest + final checks"
if [[ -x "$APP_DIR/scripts/runtime-security-audit.sh" ]]; then
  install -m 0700 "$APP_DIR/scripts/runtime-security-audit.sh" \
    /usr/local/sbin/roadscanner-security-audit
fi

cat >/usr/local/sbin/roadscanner-health <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
state="$(roadscanner-docker inspect -f '{{.State.Status}}' roadscanner 2>/dev/null || true)"
health="$(roadscanner-docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' roadscanner 2>/dev/null || true)"
printf 'state=%s health=%s\n' "$state" "$health"
[[ "$state" == running && "$health" == healthy ]]
EOF
chmod 0700 /usr/local/sbin/roadscanner-health

cat >"$MANIFEST" <<EOF
ROADSCANNER HARDENED DEPLOYMENT
Generated: $(date -u --iso-8601=seconds)
Repository: $REPO_URL
Ref: origin/main (detached at fetched commit)
Commit: $COMMIT
Source archive SHA256: $SOURCE_ARCHIVE_SHA256
Base image: $PYTHON_IMAGE_DIGEST
Image: roadscanner:$SHORT
Image ID: $IMAGE_ID
Service user: $SERVICE_USER
Application directory: $APP_DIR
Encrypted credential directory: $CRED_DIR
Credential protection: $CRED_KEY_MODE
Volatile secret directory: $RUNTIME_SECRET_DIR
Bind: $BIND_ADDR:$PORT
Memory limit: $MEMORY_LIMIT
CPU limit: $CPU_LIMIT
PID limit: $PIDS_LIMIT
Docker security options: $SECURITY
AppArmor profile: ${APPARMOR_PROFILE:-none}
Health: $h
Log: $LOG_FILE
EOF
chmod 0600 "$MANIFEST"

# Lock login for service account after setup; lingering user service remains.
usermod --shell /usr/sbin/nologin "$SERVICE_USER"
passwd -l "$SERVICE_USER" >/dev/null 2>&1 || true

printf '\nROADSCANNER HARDENED DEPLOYMENT READY\n'
printf 'URL:       http://%s:%s\n' "$BIND_ADDR" "$PORT"
printf 'Commit:    %s\n' "$COMMIT"
printf 'Image:     roadscanner:%s\n' "$SHORT"
printf 'Secrets:   encrypted at %s (%s)\n' "$CRED_DIR" "$CRED_KEY_MODE"
printf 'Runtime:   %s (volatile)\n' "$RUNTIME_SECRET_DIR"
printf 'Manifest:  %s\n' "$MANIFEST"
printf '\nAdmin credentials were generated but intentionally NOT printed.\n'
printf 'To reveal them once as root, use:\n'
printf '  systemd-creds decrypt --name=admin_username %s/admin_username.cred -\n' "$CRED_DIR"
printf '  systemd-creds decrypt --name=admin_pass %s/admin_pass.cred -\n' "$CRED_DIR"
printf '\nUseful commands:\n'
printf '  roadscanner-health\n'
printf '  roadscanner-docker ps\n'
printf '  roadscanner-docker logs -f roadscanner\n'
printf '  roadscanner-compose restart roadscanner\n'
printf '  ss -lntp | grep :%s\n' "$PORT"
printf '\nCloudflare Tunnel (optional):\n'
printf '  sudo %s/scripts/install-cloudflared-docker.sh\n' "$APP_DIR"
printf 'Set its public-hostname service URL to http://roadscanner:3000.\n'
