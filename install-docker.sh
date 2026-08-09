#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

SERVICE_USER="${SERVICE_USER:-roadscanner}"
REPO_URL="${REPO_URL:-https://github.com/ornab74/roadscanner.git}"
REF="${REF:-main}"
APP_DIR="${APP_DIR:-/srv/roadscanner}"
CONFIG_DIR="${CONFIG_DIR:-/etc/roadscanner}"
ENV_FILE="${ENV_FILE:-$CONFIG_DIR/roadscanner.env}"
BIND_ADDR="${BIND_ADDR:-127.0.0.1}"
PORT="${PORT:-3000}"
MEMORY_LIMIT="${MEMORY_LIMIT:-2g}"
CPU_LIMIT="${CPU_LIMIT:-2.0}"
PIDS_LIMIT="${PIDS_LIMIT:-384}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
INSTALL_DOCKER="${INSTALL_DOCKER:-1}"
FORCE_UPDATE="${FORCE_UPDATE:-0}"
HARDEN_HOST="${HARDEN_HOST:-1}"
REQUIRE_APPARMOR="${REQUIRE_APPARMOR:-auto}"
PYTHON_IMAGE_TAG="${PYTHON_IMAGE_TAG:-python:3.12-slim}"
STATE_DIR="${STATE_DIR:-/var/lib/roadscanner-installer}"
LOG_DIR="${LOG_DIR:-/var/log/roadscanner}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="$LOG_DIR/install-$STAMP.log"
MANIFEST="$STATE_DIR/manifest-$STAMP.txt"
BOOT_TMP=""

log(){ printf '\n\033[1;36m[ROADSCANNER] %s\033[0m\n' "$*"; }
ok(){ printf '\033[1;32m[ OK ] %s\033[0m\n' "$*"; }
warn(){ printf '\033[1;33m[WARN] %s\033[0m\n' "$*" >&2; }
die(){ printf '\033[1;31m[FAIL] %s\033[0m\n' "$*" >&2; exit 1; }
cleanup(){ [[ -n "$BOOT_TMP" ]] && rm -f "$BOOT_TMP" 2>/dev/null || true; }
onerr(){ local rc=$?; printf 'install failed: rc=%s line=%s cmd=%s\nlog=%s\n' "$rc" "${BASH_LINENO[0]:-?}" "${BASH_COMMAND:-?}" "$LOG_FILE" >&2; exit "$rc"; }
trap cleanup EXIT
trap onerr ERR

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "Run as root: sudo ./install-docker.sh"
[[ "$BIND_ADDR" == "127.0.0.1" || "$BIND_ADDR" == "::1" || "$BIND_ADDR" == "localhost" ]] || warn "Non-loopback bind requested: $BIND_ADDR"
mkdir -p "$STATE_DIR" "$LOG_DIR" "$CONFIG_DIR"
chmod 0700 "$STATE_DIR" "$CONFIG_DIR"; chmod 0750 "$LOG_DIR"
touch "$LOG_FILE"; chmod 0640 "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

log "1/12 host prerequisites"
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) warn "Primarily tested on Ubuntu/Debian; detected ${ID:-unknown}.";; esac
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg git openssl uidmap dbus-user-session slirp4netns fuse-overlayfs iproute2 procps jq apparmor apparmor-utils

if [[ "$INSTALL_DOCKER" == "1" ]]; then
  install -m 0755 -d /etc/apt/keyrings
  [[ "${ID:-}" == "debian" ]] && DIST=debian || DIST=ubuntu
  curl --proto '=https' --tlsv1.2 -fsSL --retry 5 "https://download.docker.com/linux/$DIST/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  ARCH="$(dpkg --print-architecture)"; CODENAME="${VERSION_CODENAME:-}"
  [[ -n "$CODENAME" ]] || die "Unable to determine OS codename."
  printf 'deb [arch=%s signed-by=%s] https://download.docker.com/linux/%s %s stable\n' "$ARCH" /etc/apt/keyrings/docker.asc "$DIST" "$CODENAME" >/etc/apt/sources.list.d/roadscanner-docker.list
  ROOTFUL_DOCKER_WAS_ACTIVE="$(systemctl is-active docker.service 2>/dev/null || true)"
  ROOTFUL_CONTAINERD_WAS_ACTIVE="$(systemctl is-active containerd.service 2>/dev/null || true)"
  apt-get update
  apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-ce-rootless-extras docker-buildx-plugin docker-compose-plugin
  if [[ "$ROOTFUL_DOCKER_WAS_ACTIVE" != active ]]; then systemctl stop docker.service docker.socket 2>/dev/null || true; systemctl disable docker.service docker.socket 2>/dev/null || true; systemctl mask docker.service docker.socket 2>/dev/null || true; fi
  if [[ "$ROOTFUL_CONTAINERD_WAS_ACTIVE" != active ]]; then systemctl stop containerd.service 2>/dev/null || true; systemctl disable containerd.service 2>/dev/null || true; systemctl mask containerd.service 2>/dev/null || true; fi
fi
command -v docker >/dev/null || die "docker CLI missing"
command -v dockerd-rootless-setuptool.sh >/dev/null || die "docker rootless extras missing"

log "2/12 dedicated service account + namespaces"
id "$SERVICE_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$SERVICE_USER"
for g in sudo wheel docker; do getent group "$g" >/dev/null 2>&1 && gpasswd -d "$SERVICE_USER" "$g" >/dev/null 2>&1 || true; done
for spec in "/etc/subuid:--add-subuids" "/etc/subgid:--add-subgids"; do
  f="${spec%%:*}"; flag="${spec##*:}"
  if ! grep -q "^${SERVICE_USER}:" "$f" 2>/dev/null; then
    start="$(awk -F: '{e=$2+$3;if(e>m)m=e} END{print (m<100000?100000:m)}' "$f" 2>/dev/null || echo 100000)"
    usermod "$flag" "$start-$((start+65535))" "$SERVICE_USER"
  fi
done
UIDN="$(id -u "$SERVICE_USER")"; HOME_DIR="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
loginctl enable-linger "$SERVICE_USER"; systemctl start "user@${UIDN}.service" || true
runu(){ runuser -u "$SERVICE_USER" -- env HOME="$HOME_DIR" USER="$SERVICE_USER" LOGNAME="$SERVICE_USER" XDG_RUNTIME_DIR="/run/user/$UIDN" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UIDN/bus" PATH="/usr/local/bin:/usr/bin:/bin:$HOME_DIR/.local/bin" "$@"; }
dkr(){ runu env DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker "$@"; }

log "3/12 conservative host hardening"
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
  sysctl --system >/dev/null || warn "Some hardening sysctls were unsupported; review $LOG_FILE"
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
  apparmor_parser -r /etc/apparmor.d/usr.bin.rootlesskit || die "Failed to load RootlessKit AppArmor profile"
fi

log "4/12 rootless Docker + RootlessKit verification"
[[ -f "$HOME_DIR/.config/systemd/user/docker.service" ]] || runu dockerd-rootless-setuptool.sh install
DROPIN="$HOME_DIR/.config/systemd/user/docker.service.d"
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DROPIN"
cat >"$DROPIN/90-roadscanner-network.conf" <<'DROP'
[Service]
Environment="DOCKERD_ROOTLESS_ROOTLESSKIT_NET=slirp4netns"
Environment="DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=slirp4netns"
DROP
chown "$SERVICE_USER:$SERVICE_USER" "$DROPIN/90-roadscanner-network.conf"
runu systemctl --user daemon-reload; runu systemctl --user enable docker.service; runu systemctl --user restart docker.service
for _ in $(seq 1 60); do dkr info >/dev/null 2>&1 && break; sleep 2; done
dkr info >/dev/null 2>&1 || die "Rootless Docker did not become ready"
SECURITY="$(dkr info --format '{{json .SecurityOptions}}')"
grep -qi rootless <<<"$SECURITY" || die "Docker is not rootless"
grep -qi seccomp <<<"$SECURITY" || die "Docker seccomp is not enabled"
ROOTLESS_ARGS="$(ps -u "$SERVICE_USER" -o args= | grep '[r]ootlesskit' | head -1 || true)"
grep -q -- '--net=slirp4netns' <<<"$ROOTLESS_ARGS" || die "RootlessKit is not using slirp4netns"
grep -q -- '--port-driver=slirp4netns' <<<"$ROOTLESS_ARGS" || die "RootlessKit port driver is not slirp4netns"
if [[ "$REQUIRE_APPARMOR" == auto ]]; then
  if command -v aa-enabled >/dev/null 2>&1 && aa-enabled >/dev/null 2>&1; then REQUIRE_APPARMOR=1; else REQUIRE_APPARMOR=0; fi
fi

log "5/12 source checkout + immutable source identity"
if [[ -d "$APP_DIR/.git" ]]; then
  chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
  [[ "$FORCE_UPDATE" == 1 || -z "$(runu git -C "$APP_DIR" status --porcelain)" ]] || die "$APP_DIR has local changes"
  runu git -C "$APP_DIR" fetch --tags --prune origin
  runu git -C "$APP_DIR" checkout "$REF"
  [[ "$FORCE_UPDATE" == 1 ]] && runu git -C "$APP_DIR" reset --hard "origin/$REF" || runu git -C "$APP_DIR" merge --ff-only "origin/$REF"
else
  install -d -m 0755 "$(dirname "$APP_DIR")"; install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$APP_DIR"
  runu git clone --branch "$REF" --depth 1 "$REPO_URL" "$APP_DIR"
fi
COMMIT="$(runu git -C "$APP_DIR" rev-parse HEAD)"; SHORT="${COMMIT:0:12}"
SOURCE_ARCHIVE_SHA256="$(runu git -C "$APP_DIR" archive --format=tar HEAD | sha256sum | awk '{print $1}')"
chown -R root:root "$APP_DIR"; find "$APP_DIR" -xdev -type d -exec chmod go-w {} +; find "$APP_DIR" -xdev -type f -exec chmod go-w {} +; chmod 0755 "$APP_DIR"

log "6/12 persistent secrets outside build context"
OLD_ENV="$APP_DIR/roadscanner.env"
if [[ ! -f "$ENV_FILE" && -f "$OLD_ENV" ]]; then
  install -m 0600 -o "$SERVICE_USER" -g "$SERVICE_USER" "$OLD_ENV" "$ENV_FILE"
  rm -f "$OLD_ENV"
  ok "Migrated existing secrets to $ENV_FILE"
fi
if [[ ! -f "$ENV_FILE" ]]; then
  [[ -n "$ADMIN_PASSWORD" ]] || ADMIN_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')"
  cat >"$ENV_FILE" <<EOF
INVITE_CODE_SECRET_KEY=$(openssl rand -hex 64)
ENCRYPTION_PASSPHRASE=$(openssl rand -base64 64 | tr -d '\n')
admin_username=$ADMIN_USERNAME
admin_pass=$ADMIN_PASSWORD
STRICT_PQ2_ONLY=1
QRS_BOOTSTRAP_SHOW=0
QRS_ROTATE_SESSION_KEY=1
QRS_SESSION_KEY_ROTATION_PERIOD_SECONDS=1800
EOF
  chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"; chmod 0600 "$ENV_FILE"
  if [[ -w /dev/tty ]]; then printf '\nADMIN USER: %s\nADMIN PASSWORD: %s\n\n' "$ADMIN_USERNAME" "$ADMIN_PASSWORD" >/dev/tty; else warn "Generated admin credentials are stored in $ENV_FILE"; fi
fi
chmod 0600 "$ENV_FILE"; chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
for k in INVITE_CODE_SECRET_KEY ENCRYPTION_PASSPHRASE admin_username admin_pass; do grep -q "^${k}=" "$ENV_FILE" || die "$ENV_FILE missing $k"; done
DEPLOY_ENV="$CONFIG_DIR/deploy.env"

log "7/12 immutable base-image resolution + verified image build"
dkr pull "$PYTHON_IMAGE_TAG"
PYTHON_IMAGE_DIGEST="$(dkr image inspect "$PYTHON_IMAGE_TAG" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
[[ "$PYTHON_IMAGE_DIGEST" == *@sha256:* ]] || die "Could not resolve immutable digest for $PYTHON_IMAGE_TAG"
BUILD_DATE="$(date -u --iso-8601=seconds)"
cat >"$DEPLOY_ENV" <<EOF
ROADSCANNER_ENV_FILE=$ENV_FILE
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
EOF
chown "$SERVICE_USER:$SERVICE_USER" "$DEPLOY_ENV"; chmod 0600 "$DEPLOY_ENV"
compose(){ runu env DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker compose --project-directory "$APP_DIR" --env-file "$DEPLOY_ENV" -f "$APP_DIR/compose.yaml" "$@"; }
compose build --pull roadscanner
IMAGE_ID="$(dkr image inspect -f '{{.Id}}' "roadscanner:$SHORT")"
dkr run --rm --network none --entrypoint /bin/sh "roadscanner:$SHORT" -c 'test ! -e /app/roadscanner.env && test ! -e /app/.env && test ! -e /app/.roadscanner-deploy.env' || die "Secret/deployment env detected in image"

log "8/12 persist app-generated PQ keys"
if ! grep -q '^QRS_X25519_PRIV_ENC_B64=' "$ENV_FILE"; then
  BOOT_TMP="/run/roadscanner-pq-bootstrap.$$"; : >"$BOOT_TMP"; chmod 0600 "$BOOT_TMP"
  set +e; dkr run --rm --network none --env-file "$ENV_FILE" -e QRS_BOOTSTRAP_SHOW=1 "roadscanner:$SHORT" python -c 'import main; print("ROADSCANNER_BOOTSTRAP_COMPLETE")' >"$BOOT_TMP" 2>&1; rc=$?; set -e
  [[ $rc -eq 0 ]] || { sed -E 's/(export [A-Z0-9_]+=).*/\1<redacted>/' "$BOOT_TMP" | tail -80 >&2; die "PQ bootstrap failed"; }
  while IFS='=' read -r key value; do [[ "$key" =~ ^QRS_[A-Z0-9_]+$ ]] || continue; sed -i "/^${key}=/d" "$ENV_FILE"; printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"; done < <(grep '^export QRS_' "$BOOT_TMP" | sed -E "s/^export ([A-Z0-9_]+)='(.*)'$/\1=\2/")
  rm -f "$BOOT_TMP"; BOOT_TMP=""; chmod 0600 "$ENV_FILE"
fi
for k in QRS_X25519_PRIV_ENC_B64 QRS_PQ_PRIV_ENC_B64 QRS_SIG_PRIV_ENC_B64; do grep -q "^${k}=" "$ENV_FILE" || die "PQ bootstrap missing $k"; done

log "9/12 persistent volume ownership"
dkr volume create roadscanner-data >/dev/null
dkr run --rm --network none --read-only --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE -v roadscanner-data:/var/data "$PYTHON_IMAGE_DIGEST" /bin/chown -R 10001:10001 /var/data

log "10/12 hardened container start + runtime audit"
compose up -d --remove-orphans roadscanner
for _ in $(seq 1 90); do h="$(dkr inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' roadscanner 2>/dev/null || true)"; [[ "$h" == healthy ]] && break; [[ "$h" == unhealthy ]] && { dkr logs --tail 120 roadscanner || true; die "container unhealthy"; }; sleep 2; done
h="$(dkr inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' roadscanner)"; [[ "$h" == healthy ]] || die "container failed health check"
APPARMOR_PROFILE="$(dkr inspect -f '{{.AppArmorProfile}}' roadscanner 2>/dev/null || true)"
if [[ "$REQUIRE_APPARMOR" == 1 ]]; then [[ -n "$APPARMOR_PROFILE" && "$APPARMOR_PROFILE" != unconfined ]] || die "AppArmor required but container is unconfined"; fi

log "11/12 root-only helpers + health timer"
cat >/usr/local/bin/roadscanner-docker <<EOF
#!/usr/bin/env bash
exec runuser -u "$SERVICE_USER" -- env HOME="$HOME_DIR" USER="$SERVICE_USER" LOGNAME="$SERVICE_USER" XDG_RUNTIME_DIR="/run/user/$UIDN" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UIDN/bus" DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker "\$@"
EOF
chmod 0700 /usr/local/bin/roadscanner-docker
cat >/usr/local/bin/roadscanner-compose <<EOF
#!/usr/bin/env bash
exec runuser -u "$SERVICE_USER" -- env HOME="$HOME_DIR" USER="$SERVICE_USER" LOGNAME="$SERVICE_USER" XDG_RUNTIME_DIR="/run/user/$UIDN" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UIDN/bus" DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker compose --project-directory "$APP_DIR" --env-file "$DEPLOY_ENV" -f "$APP_DIR/compose.yaml" "\$@"
EOF
chmod 0700 /usr/local/bin/roadscanner-compose
install -m 0700 "$APP_DIR/scripts/runtime-security-audit.sh" /usr/local/sbin/roadscanner-security-audit
cat >/usr/local/sbin/roadscanner-health <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
state="$(roadscanner-docker inspect -f '{{.State.Status}}' roadscanner 2>/dev/null || true)"
health="$(roadscanner-docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' roadscanner 2>/dev/null || true)"
echo "state=$state health=$health"
[[ "$state" == running && "$health" == healthy ]]
EOF
chmod 0700 /usr/local/sbin/roadscanner-health
cat >/etc/systemd/system/roadscanner-health.service <<'EOF'
[Unit]
Description=Roadscanner hardened container health check
After=network-online.target
[Service]
Type=oneshot
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
ExecStart=/usr/local/sbin/roadscanner-health
EOF
cat >/etc/systemd/system/roadscanner-health.timer <<'EOF'
[Unit]
Description=Roadscanner health check timer
[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
RandomizedDelaySec=30s
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload; systemctl enable --now roadscanner-health.timer
ROADSCANNER_IMAGE="roadscanner:$SHORT" ROADSCANNER_BIND_ADDR="$BIND_ADDR" /usr/local/sbin/roadscanner-security-audit
usermod --shell /usr/sbin/nologin "$SERVICE_USER"
passwd -l "$SERVICE_USER" >/dev/null 2>&1 || true

log "12/12 deployment manifest"
cat >"$MANIFEST" <<EOF
ROADSCANNER DEPLOYMENT MANIFEST
Generated: $(date -u --iso-8601=seconds)
Repository: $REPO_URL
Ref: $REF
Commit: $COMMIT
Source archive SHA256: $SOURCE_ARCHIVE_SHA256
Base image tag: $PYTHON_IMAGE_TAG
Base image digest: $PYTHON_IMAGE_DIGEST
Image: roadscanner:$SHORT
Image ID: $IMAGE_ID
Service user: $SERVICE_USER
App dir: $APP_DIR
Env file: $ENV_FILE
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
cat <<EOF

ROADSCANNER HARDENED DEPLOYMENT READY
URL:      http://$BIND_ADDR:$PORT
Commit:   $COMMIT
Image:    roadscanner:$SHORT
Secrets:  $ENV_FILE
Manifest: $MANIFEST
Log:      $LOG_FILE

Root-only commands:
  sudo roadscanner-docker ps
  sudo roadscanner-docker logs -f roadscanner
  sudo roadscanner-compose restart roadscanner
  sudo roadscanner-health
  sudo roadscanner-security-audit

Keep the default loopback bind and terminate TLS in a hardened reverse proxy/load balancer.
EOF
