#!/usr/bin/env bash
set -Eeuo pipefail

# Backward-compatible name for the canonical source-build installer.
# Keeping all installation logic in docker-install.sh prevents security and
# permission behavior from drifting between duplicate implementations.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

printf 'install-docker.sh is a compatibility alias for docker-install.sh.\n'
exec bash "$SCRIPT_DIR/docker-install.sh" "$@"
