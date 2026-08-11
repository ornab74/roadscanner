#!/usr/bin/env bash
set -euo pipefail

REPO="${NATIVE_RELEASE_REPO:-ornab74/roadscanner}"
TAG="${NATIVE_RELEASE_TAG:?set NATIVE_RELEASE_TAG to the immutable GitHub release tag}"
DEST="${NATIVE_RELEASE_DEST:-/srv/roadscanner/binaryandwheel}"
MANIFEST_SHA256="${NATIVE_MANIFEST_SHA256:?set NATIVE_MANIFEST_SHA256 to the trusted SHA-256 of SHA256SUMS}"
BASE="https://github.com/${REPO}/releases/download/${TAG}"

umask 077
mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl --proto '=https' --tlsv1.2 -fsSL --retry 5 -o "$TMP/SHA256SUMS" "$BASE/SHA256SUMS"
printf '%s  %s\n' "$MANIFEST_SHA256" "$TMP/SHA256SUMS" | sha256sum -c -

mapfile -t ASSETS < <(awk '{print $2}' "$TMP/SHA256SUMS")
((${#ASSETS[@]} >= 3)) || { echo "native manifest has too few assets" >&2; exit 1; }

for asset in "${ASSETS[@]}"; do
  case "$asset" in
    liboqs-0.16.0-debian-py312-x86_64.tar.gz|llama_cpp_python-0.3.16-*.whl|liboqs_python-0.16.0-*.whl) ;;
    *) echo "unexpected native asset in manifest: $asset" >&2; exit 1 ;;
  esac
  curl --proto '=https' --tlsv1.2 -fsSL --retry 5 -o "$TMP/$asset" "$BASE/$asset"
done

(
  cd "$TMP"
  sha256sum -c SHA256SUMS
)

rm -rf "$DEST"
mkdir -p "$DEST"
install -m 0600 "$TMP/SHA256SUMS" "$DEST/SHA256SUMS"
for asset in "${ASSETS[@]}"; do
  install -m 0600 "$TMP/$asset" "$DEST/$asset"
done

echo "Verified native release ${TAG} -> ${DEST}"
