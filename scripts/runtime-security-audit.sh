#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

CONTAINER="${ROADSCANNER_CONTAINER:-roadscanner}"
IMAGE="${ROADSCANNER_IMAGE:-}"
EXPECT_BIND="${ROADSCANNER_BIND_ADDR:-127.0.0.1}"
fail=0

pass(){ printf '[PASS] %s\n' "$*"; }
warn(){ printf '[WARN] %s\n' "$*" >&2; }
bad(){ printf '[FAIL] %s\n' "$*" >&2; fail=1; }

if command -v roadscanner-docker >/dev/null 2>&1; then
  DOCKER=(roadscanner-docker)
else
  DOCKER=(docker)
fi
command -v "${DOCKER[0]}" >/dev/null || { bad "docker CLI unavailable"; exit 1; }

info="$("${DOCKER[@]}" info --format '{{json .SecurityOptions}}' 2>/dev/null || true)"
grep -qi 'rootless' <<<"$info" && pass "rootless Docker" || bad "daemon is not rootless"
grep -qi 'seccomp' <<<"$info" && pass "Docker seccomp enabled" || bad "seccomp not reported by Docker"

running="$("${DOCKER[@]}" inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)"
[[ "$running" == true ]] && pass "container running" || bad "container not running"

user="$("${DOCKER[@]}" inspect -f '{{.Config.User}}' "$CONTAINER" 2>/dev/null || true)"
[[ "$user" == "10001:10001" || "$user" == "10001" ]] && pass "numeric non-root runtime user ($user)" || bad "unexpected runtime user: ${user:-unset}"

priv="$("${DOCKER[@]}" inspect -f '{{.HostConfig.Privileged}}' "$CONTAINER" 2>/dev/null || true)"
[[ "$priv" == false ]] && pass "privileged mode disabled" || bad "privileged mode enabled"

readonly="$("${DOCKER[@]}" inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$CONTAINER" 2>/dev/null || true)"
[[ "$readonly" == true ]] && pass "read-only root filesystem" || bad "root filesystem is writable"

capdrop="$("${DOCKER[@]}" inspect -f '{{json .HostConfig.CapDrop}}' "$CONTAINER" 2>/dev/null || true)"
grep -q 'ALL' <<<"$capdrop" && pass "all Linux capabilities dropped" || bad "CapDrop=ALL missing"

secopts="$("${DOCKER[@]}" inspect -f '{{json .HostConfig.SecurityOpt}}' "$CONTAINER" 2>/dev/null || true)"
grep -q 'no-new-privileges' <<<"$secopts" && pass "no-new-privileges enabled" || bad "no-new-privileges missing"

apparmor="$("${DOCKER[@]}" inspect -f '{{.AppArmorProfile}}' "$CONTAINER" 2>/dev/null || true)"
if grep -qi apparmor <<<"$info"; then
  [[ -n "$apparmor" && "$apparmor" != unconfined ]] && pass "AppArmor profile: $apparmor" || bad "AppArmor is available but container is unconfined"
else
  warn "AppArmor not reported by Docker; relying on seccomp + rootless isolation"
fi

ports="$("${DOCKER[@]}" port "$CONTAINER" 3000/tcp 2>/dev/null || true)"
if [[ "$EXPECT_BIND" == "127.0.0.1" || "$EXPECT_BIND" == "::1" || "$EXPECT_BIND" == "localhost" ]]; then
  if grep -Eq '^(127\.0\.0\.1|\[::1\]):' <<<"$ports" && ! grep -Eq '^(0\.0\.0\.0|\[::\]):' <<<"$ports"; then
    pass "port 3000 loopback-only: $ports"
  else
    bad "port 3000 is not loopback-only: ${ports:-unpublished}"
  fi
else
  warn "non-loopback bind explicitly configured: $EXPECT_BIND"
fi

mounts="$("${DOCKER[@]}" inspect -f '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}' "$CONTAINER" 2>/dev/null || true)"
if grep -Eq 'docker\.sock|/run/containerd|/var/run' <<<"$mounts"; then
  bad "sensitive host runtime socket/path mounted into container"
else
  pass "no Docker/containerd socket mounts"
fi

pidlimit="$("${DOCKER[@]}" inspect -f '{{.HostConfig.PidsLimit}}' "$CONTAINER" 2>/dev/null || true)"
[[ "$pidlimit" =~ ^[0-9]+$ && "$pidlimit" -gt 0 && "$pidlimit" -le 512 ]] && pass "PID limit enforced: $pidlimit" || bad "unexpected PID limit: ${pidlimit:-unset}"

health="$("${DOCKER[@]}" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || true)"
[[ "$health" == healthy ]] && pass "container health check healthy" || bad "health state: ${health:-unknown}"

[[ -n "$IMAGE" ]] || IMAGE="$("${DOCKER[@]}" inspect -f '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)"
if [[ -n "$IMAGE" ]]; then
  if "${DOCKER[@]}" run --rm --network none --entrypoint /bin/sh "$IMAGE" -c \
    'test ! -e /app/roadscanner.env && test ! -e /app/.env && test ! -e /app/.roadscanner-deploy.env' >/dev/null 2>&1; then
    pass "deployment env/secrets absent from image filesystem"
  else
    bad "deployment env/secrets detected in image filesystem or image audit failed"
  fi
fi

exit "$fail"
