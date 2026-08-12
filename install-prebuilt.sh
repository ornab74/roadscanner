#!/usr/bin/env bash
set -Eeuo pipefail

# Recommended production path: use the published, already-built Roadscanner
# image while retaining the full hardened host, secret, PQ, and Cloudflare
# setup implemented by docker-install.sh.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PREBUILT_IMAGE="${PREBUILT_IMAGE:-graylanjanulis/roadscanner:latest}"

printf 'Roadscanner prebuilt-image installer\n'
printf 'Image requested: %s\n' "$PREBUILT_IMAGE"
printf 'The installer will pull it and pin this deployment to its resolved digest.\n\n'

exec bash "$SCRIPT_DIR/docker-install.sh" "$@"
