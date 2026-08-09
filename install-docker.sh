#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

SERVICE_USER="${SERVICE_USER:-roadscanner}"
REPO_URL="${REPO_URL:-https://github.com/ornab74/roadscanner.git}"
REF="${REF:-main}"
APP_DIR="${APP_DIR:-/srv/roadscanner}"
ENV_FILE="${ENV_FILE:-$APP_DIR/roadscanner.env}"
BIND_ADDR="${BIND_ADDR:-127.0.0.1}"
PORT="${PORT:-3000}"
MEMORY_LIMIT="${MEMORY_LIMIT:-2g}"
CPU_LIMIT="${CPU_LIMIT:-2.0}"
PIDS_LIMIT="${PIDS_LIMIT:-512}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
INSTALL_DOCKER="${INSTALL_DOCKER:-1}"
FORCE_UPDATE="${FORCE_UPDATE:-0}"
STATE_DIR="${STATE_DIR:-/var/lib/roadscanner-installer}"
LOG_DIR="${LOG_DIR:-/var/log/roadscanner}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_FILE="$LOG_DIR/install-$STAMP.log"
MANIFEST="$STATE_DIR/manifest-$STAMP.txt"

log(){ printf '\n\033[1;36m[ROADSCANNER] %s\033[0m\n' "$*"; }
ok(){ printf '\033[1;32m[ OK ] %s\033[0m\n' "$*"; }
warn(){ printf '\033[1;33m[WARN] %s\033[0m\n' "$*" >&2; }
die(){ printf '\033[1;31m[FAIL] %s\033[0m\n' "$*" >&2; exit 1; }

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "Run as root: sudo ./install-docker.sh"
mkdir -p "$STATE_DIR" "$LOG_DIR"
chmod 0700 "$STATE_DIR"; chmod 0750 "$LOG_DIR"
touch "$LOG_FILE"; chmod 0640 "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1
trap 'rc=$?; echo "install failed: rc=$rc line=${BASH_LINENO[0]:-?} cmd=${BASH_COMMAND:-?}" >&2; echo "log=$LOG_FILE" >&2; exit "$rc"' ERR

log "1/10 host prerequisites"
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) warn "Primarily tested on Ubuntu/Debian; detected ${ID:-unknown}.";; esac
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg git openssl uidmap dbus-user-session slirp4netns fuse-overlayfs iproute2 procps jq

if [[ "$INSTALL_DOCKER" == "1" ]]; then
  install -m 0755 -d /etc/apt/keyrings
  [[ "${ID:-}" == "debian" ]] && DIST=debian || DIST=ubuntu
  curl -fsSL "https://download.docker.com/linux/$DIST/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  ARCH="$(dpkg --print-architecture)"; CODENAME="${VERSION_CODENAME:-}"
  [[ -n "$CODENAME" ]] || die "Unable to determine OS codename."
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' "$ARCH" "$DIST" "$CODENAME" >/etc/apt/sources.list.d/roadscanner-docker.list
  for p in docker.io docker-doc docker-compose podman-docker; do dpkg -s "$p" >/dev/null 2>&1 && die "Conflicting package installed: $p" || true; done
  ROOTFUL_DOCKER_WAS_ACTIVE="$(systemctl is-active docker.service 2>/dev/null || true)"
  ROOTFUL_CONTAINERD_WAS_ACTIVE="$(systemctl is-active containerd.service 2>/dev/null || true)"
  apt-get update
  apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-ce-rootless-extras docker-buildx-plugin docker-compose-plugin
  [[ "$ROOTFUL_DOCKER_WAS_ACTIVE" == active ]] || { systemctl stop docker.service docker.socket 2>/dev/null || true; systemctl disable docker.service docker.socket 2>/dev/null || true; }
  [[ "$ROOTFUL_CONTAINERD_WAS_ACTIVE" == active ]] || { systemctl stop containerd.service 2>/dev/null || true; systemctl disable containerd.service 2>/dev/null || true; }
fi
command -v docker >/dev/null || die "docker CLI missing"
command -v dockerd-rootless-setuptool.sh >/dev/null || die "docker rootless extras missing"

log "2/10 dedicated service account"
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

log "3/10 rootless Docker"
[[ -f "$HOME_DIR/.config/systemd/user/docker.service" ]] || runu dockerd-rootless-setuptool.sh install
runu systemctl --user daemon-reload; runu systemctl --user enable docker.service; runu systemctl --user restart docker.service
for _ in $(seq 1 60); do dkr info >/dev/null 2>&1 && break; sleep 2; done
dkr info >/dev/null 2>&1 || die "Rootless Docker did not become ready"
dkr info --format '{{json .SecurityOptions}}' | grep -q rootless || die "Docker is not rootless"

log "4/10 source checkout"
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

log "5/10 persistent secrets"
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
cat >"$APP_DIR/.roadscanner-deploy.env" <<EOF
ROADSCANNER_ENV_FILE=$ENV_FILE
ROADSCANNER_IMAGE=roadscanner:$SHORT
ROADSCANNER_CONTAINER=roadscanner
ROADSCANNER_BIND_ADDR=$BIND_ADDR
ROADSCANNER_PORT=$PORT
ROADSCANNER_MEMORY_LIMIT=$MEMORY_LIMIT
ROADSCANNER_CPU_LIMIT=$CPU_LIMIT
ROADSCANNER_PIDS_LIMIT=$PIDS_LIMIT
EOF
chown "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/.roadscanner-deploy.env"; chmod 0600 "$APP_DIR/.roadscanner-deploy.env"
compose(){ runu env DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker compose --project-directory "$APP_DIR" --env-file "$APP_DIR/.roadscanner-deploy.env" -f "$APP_DIR/compose.yaml" "$@"; }

log "6/10 verified image build"
compose build --pull roadscanner
IMAGE_ID="$(dkr image inspect -f '{{.Id}}' "roadscanner:$SHORT")"

log "7/10 persist app-generated PQ keys"
if ! grep -q '^QRS_X25519_PRIV_ENC_B64=' "$ENV_FILE"; then
  BOOT_TMP="/run/roadscanner-pq-bootstrap.$$"; : >"$BOOT_TMP"; chmod 0600 "$BOOT_TMP"
  set +e; compose run --rm -e QRS_BOOTSTRAP_SHOW=1 roadscanner python -c 'import main; print("ROADSCANNER_BOOTSTRAP_COMPLETE")' >"$BOOT_TMP" 2>&1; rc=$?; set -e
  [[ $rc -eq 0 ]] || { sed -E 's/(export [A-Z0-9_]+=).*/\1<redacted>/' "$BOOT_TMP" | tail -80 >&2; rm -f "$BOOT_TMP"; die "PQ bootstrap failed"; }
  while IFS='=' read -r key value; do [[ "$key" =~ ^QRS_[A-Z0-9_]+$ ]] || continue; sed -i "/^${key}=/d" "$ENV_FILE"; printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"; done < <(grep '^export QRS_' "$BOOT_TMP" | sed -E "s/^export ([A-Z0-9_]+)='(.*)'$/\1=\2/")
  rm -f "$BOOT_TMP"; chmod 0600 "$ENV_FILE"
fi
for k in QRS_X25519_PRIV_ENC_B64 QRS_PQ_PRIV_ENC_B64 QRS_SIG_PRIV_ENC_B64; do grep -q "^${k}=" "$ENV_FILE" || die "PQ bootstrap missing $k"; done

log "8/10 hardened container start"
compose up -d --remove-orphans roadscanner
for _ in $(seq 1 90); do h="$(dkr inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' roadscanner 2>/dev/null || true)"; [[ "$h" == healthy ]] && break; [[ "$h" == unhealthy ]] && { dkr logs --tail 120 roadscanner || true; die "container unhealthy"; }; sleep 2; done
h="$(dkr inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' roadscanner)"; [[ "$h" == healthy ]] || die "container failed health check"

log "9/10 helper commands + health timer"
cat >/usr/local/bin/roadscanner-docker <<EOF
#!/usr/bin/env bash
exec runuser -u "$SERVICE_USER" -- env HOME="$HOME_DIR" USER="$SERVICE_USER" LOGNAME="$SERVICE_USER" XDG_RUNTIME_DIR="/run/user/$UIDN" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UIDN/bus" DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker "\$@"
EOF
chmod 0755 /usr/local/bin/roadscanner-docker
cat >/usr/local/bin/roadscanner-compose <<EOF
#!/usr/bin/env bash
exec runuser -u "$SERVICE_USER" -- env HOME="$HOME_DIR" USER="$SERVICE_USER" LOGNAME="$SERVICE_USER" XDG_RUNTIME_DIR="/run/user/$UIDN" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$UIDN/bus" DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker compose --project-directory "$APP_DIR" --env-file "$APP_DIR/.roadscanner-deploy.env" -f "$APP_DIR/compose.yaml" "\$@"
EOF
chmod 0755 /usr/local/bin/roadscanner-compose
cat >/usr/local/sbin/roadscanner-health <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="$(roadscanner-docker inspect -f '{{.State.Status}}' roadscanner 2>/dev/null || true)"
health="$(roadscanner-docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' roadscanner 2>/dev/null || true)"
echo "state=$state health=$health"
[[ "$state" == running && "$health" == healthy ]]
EOF
chmod 0755 /usr/local/sbin/roadscanner-health
cat >/etc/systemd/system/roadscanner-health.service <<'EOF'
[Unit]
Description=Roadscanner container health check
After=network-online.target
[Service]
Type=oneshot
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

log "10/10 deployment manifest"
cat >"$MANIFEST" <<EOF
ROADSCANNER DEPLOYMENT MANIFEST
Generated: $(date -u --iso-8601=seconds)
Repository: $REPO_URL
Ref: $REF
Commit: $COMMIT
Image: roadscanner:$SHORT
Image ID: $IMAGE_ID
Service user: $SERVICE_USER
App dir: $APP_DIR
Env file: $ENV_FILE
Bind: $BIND_ADDR:$PORT
Memory limit: $MEMORY_LIMIT
CPU limit: $CPU_LIMIT
PID limit: $PIDS_LIMIT
Health: $h
Log: $LOG_FILE
EOF
chmod 0600 "$MANIFEST"
cat <<EOF

ROADSCANNER READY
URL:      http://$BIND_ADDR:$PORT
Commit:   $COMMIT
Image:    roadscanner:$SHORT
Secrets:  $ENV_FILE
Manifest: $MANIFEST
Log:      $LOG_FILE

Commands:
  roadscanner-docker ps
  roadscanner-docker logs -f roadscanner
  roadscanner-compose restart roadscanner
  roadscanner-health

Keep the default loopback bind and place a TLS reverse proxy/load balancer in front for public access.
EOF
