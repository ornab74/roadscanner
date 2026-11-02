#!/usr/bin/env bash
# Roadscanner security audit. Read-only: does not change packages, containers,
# firewall rules, credentials, or application data.
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="${REPORT_DIR:-$ROOT/security-reports}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/audit-$STAMP.txt"
exec > >(tee "$REPORT") 2>&1

log(){ printf '\n[%s] %s\n' "$(date -Is)" "$*"; }
warn(){ printf '[WARN] %s\n' "$*" >&2; }
fail(){ printf '[FAIL] %s\n' "$*" >&2; }

log "Roadscanner security audit (read-only)"
printf 'Repository: %s\n' "$ROOT"
printf 'Host: %s\n' "$(hostname -f 2>/dev/null || hostname)"
printf 'Kernel: %s\n' "$(uname -r)"
printf 'OS: '
. /etc/os-release
printf '%s\n' "${PRETTY_NAME:-unknown}"

cd "$ROOT"
log "1. Repository hygiene and tracked secret patterns"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git status --short
  git log -1 --format='HEAD: %h %cs %s'
  if git ls-files | grep -Ei '(^|/)(\.env|id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|.*\.pfx)$'; then
    warn "Review tracked credential/key-like filenames above; names alone do not prove a secret."
  else
    echo "No obvious private-key or .env filenames in tracked paths."
  fi
else
  warn "Not a git checkout; git-history checks skipped."
fi

log "2. Python dependency vulnerability audit"
if command -v python3 >/dev/null 2>&1 && [[ -f requirements.txt ]]; then
  VENV="$(mktemp -d)"
  trap 'rm -rf "${VENV:-}"' EXIT
  python3 -m venv "$VENV/venv"
  "$VENV/venv/bin/python" -m pip install --disable-pip-version-check --quiet pip-audit
  set +e
  "$VENV/venv/bin/pip-audit" --requirement requirements.txt --strict
  rc=$?
  set -e
  if (( rc != 0 )); then
    fail "pip-audit reported vulnerable/unresolved packages (exit $rc). Review findings; do not bulk-upgrade the signed lock."
    AUDIT_FAILED=1
  else
    echo "pip-audit: no known vulnerable dependencies reported."
  fi
else
  warn "python3 or requirements.txt missing; dependency audit skipped."
  AUDIT_FAILED=1
fi

log "3. Trivy filesystem / Dockerfile / IaC / secret scan"
if command -v trivy >/dev/null 2>&1; then
  set +e
  trivy fs --scanners vuln,misconfig,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 "$ROOT"
  rc=$?
  set -e
  if (( rc != 0 )); then
    fail "Trivy reported HIGH/CRITICAL findings or a scan error (exit $rc)."
    AUDIT_FAILED=1
  else
    echo "Trivy filesystem scan: no HIGH/CRITICAL findings reported."
  fi
else
  warn "Trivy is not installed; filesystem, Dockerfile, IaC and secret scanning skipped."
  echo "Install Trivy from https://trivy.dev/latest/getting-started/installation/ and rerun."
  AUDIT_FAILED=1
fi

log "4. Host AppArmor and rootless Docker posture"
if command -v aa-status >/dev/null 2>&1; then
  aa-status --enabled && aa-status | sed -n '1,35p' || warn "AppArmor is not enabled."
else
  warn "apparmor-utils/aa-status not installed."
fi

if id roadscanner >/dev/null 2>&1; then
  UIDN="$(id -u roadscanner)"
  if [[ -S "/run/user/$UIDN/docker.sock" ]]; then
    if command -v runuser >/dev/null 2>&1 && command -v docker >/dev/null 2>&1; then
      DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" runuser -u roadscanner -- env \
        HOME="$(getent passwd roadscanner | cut -d: -f6)" \
        XDG_RUNTIME_DIR="/run/user/$UIDN" \
        DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker info --format 'SecurityOptions={{json .SecurityOptions}}'
      DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" runuser -u roadscanner -- env \
        HOME="$(getent passwd roadscanner | cut -d: -f6)" \
        XDG_RUNTIME_DIR="/run/user/$UIDN" \
        DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
      for name in roadscanner cloudflared; do
        if DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" runuser -u roadscanner -- env \
          HOME="$(getent passwd roadscanner | cut -d: -f6)" \
          XDG_RUNTIME_DIR="/run/user/$UIDN" \
          DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker inspect "$name" >/dev/null 2>&1; then
          echo "--- container $name security settings ---"
          DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" runuser -u roadscanner -- env \
            HOME="$(getent passwd roadscanner | cut -d: -f6)" \
            XDG_RUNTIME_DIR="/run/user/$UIDN" \
            DOCKER_HOST="unix:///run/user/$UIDN/docker.sock" docker inspect "$name" \
            --format 'Image={{.Config.Image}} User={{.Config.User}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} CapDrop={{json .HostConfig.CapDrop}} SecurityOpt={{json .HostConfig.SecurityOpt}} Ports={{json .HostConfig.PortBindings}}'
        fi
      done
    else
      warn "runuser/docker CLI unavailable; rootless Docker inspection skipped."
    fi
  else
    warn "Rootless Docker socket not found at /run/user/$UIDN/docker.sock."
  fi
else
  warn "roadscanner service account not found; container posture checks skipped."
fi

log "5. Ubuntu security update status"
if command -v apt-get >/dev/null 2>&1; then
  apt list --upgradable 2>/dev/null || true
  if [[ -e /var/run/reboot-required ]]; then
    warn "Host reboot is required by package manager."
  fi
fi

log "6. CVE-2026-98432 status"
if [[ -r /proc/sys/net/ipv4/tcp_migrate_req ]]; then
  printf 'net.ipv4.tcp_migrate_req=%s (this is not a complete fix)\n' "$(cat /proc/sys/net/ipv4/tcp_migrate_req)"
fi
printf 'Running kernel: %s\n' "$(uname -r)"
printf 'Canonical tracker: https://ubuntu.com/security/CVE-2026-98432\n'
echo "A fixed Ubuntu kernel must be installed AND booted; this script does not claim livepatching."

log "Audit report: $REPORT"
if [[ "${AUDIT_FAILED:-0}" == 1 ]]; then
  fail "Audit completed with missing scanners or findings. See report above."
  exit 1
fi
log "Audit completed without HIGH/CRITICAL findings from the enabled scanners."
