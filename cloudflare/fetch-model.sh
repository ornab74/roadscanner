#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p model-artifacts
model_file=model-artifacts/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
model_sha=9fecc3b3cd76bba89d504f29b616eedf7da85b96540e490ca5824d3f7d2776a0
if [ -f "$model_file" ] && echo "$model_sha  $model_file" | sha256sum --check --status; then exit 0; fi
temporary_file=$(mktemp model-artifacts/.model.XXXXXX)
trap 'rm -f "$temporary_file"' EXIT
curl --proto '=https' --tlsv1.2 --fail --location --retry 2 \
  https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf \
  -o "$temporary_file"
echo "$model_sha  $temporary_file" | sha256sum --check
mv "$temporary_file" "$model_file"
