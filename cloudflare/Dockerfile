# syntax=docker/dockerfile:1
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b AS builder
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake ninja-build && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY requirements.txt ./
RUN python - <<'PY'
import pathlib,re
names={'flask','asgiref','gunicorn','llama-cpp-python','numpy','diskcache','typing-extensions','jinja2','markupsafe','werkzeug','blinker','click','itsdangerous','packaging'}
output=[]; keep=False
for line in pathlib.Path('requirements.txt').read_text().splitlines(True):
    match=re.match(r'^([a-z0-9][a-z0-9._-]*)(?:\[[^\]]+\])?==',line)
    if match: keep=match[1] in names
    if keep: output.append(line)
pathlib.Path('scanner-requirements.txt').write_text(''.join(output))
PY
ENV CC=gcc CXX=g++ CMAKE_BUILD_PARALLEL_LEVEL=2 CMAKE_ARGS="-DGGML_NATIVE=OFF -DGGML_OPENMP=OFF"
RUN --mount=type=secret,id=proxy_ca \
    if [ -s /run/secrets/proxy_ca ]; then cat /etc/ssl/certs/ca-certificates.crt /run/secrets/proxy_ca > /tmp/ca.pem; export PIP_CERT=/tmp/ca.pem; fi; \
    python -m pip install --require-hashes -r scanner-requirements.txt && rm -f /tmp/ca.pem
COPY scripts/patch-diskcache-pysec-2026-2447.py ./
RUN python patch-diskcache-pysec-2026-2447.py
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
COPY --from=builder /usr/local /usr/local
WORKDIR /app
COPY qrs_internal_auth.py ./
COPY services/llama_scanner ./services/llama_scanner
COPY cloudflare/model-artifacts/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf /models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
COPY cloudflare/MODEL.md cloudflare/MODEL-LICENSE.txt /models/
RUN echo '9fecc3b3cd76bba89d504f29b616eedf7da85b96540e490ca5824d3f7d2776a0  /models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf' | sha256sum --check \
 && useradd --uid 10001 --create-home scanner && chown -R scanner:scanner /app \
 && chmod 0555 /models && chmod 0444 /models/*
USER scanner
EXPOSE 8080
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    QRS_LLAMA_STRUCTURED_CHAT=1 \
    QRS_LLAMA_MODEL_PATH=/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf \
    QRS_LLAMA_MODEL_SHA256=9fecc3b3cd76bba89d504f29b616eedf7da85b96540e490ca5824d3f7d2776a0
CMD ["gunicorn","--no-control-socket","--config","/app/services/llama_scanner/gunicorn.conf.py","services.llama_scanner.app:app"]
