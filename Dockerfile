# syntax=docker/dockerfile:1
ARG PYTHON_IMAGE=python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
FROM ${PYTHON_IMAGE} AS builder

ARG INCLUDE_LLAMA_RUNTIME=0
ARG LIBOQS_VERSION=0.14.0
ARG LIBOQS_SHA256=5b0df6138763b3fc4e385d58dbb2ee7c7c508a64a413d76a917529e3a9a207ea
ARG BUILD_JOBS=1

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CMAKE_BUILD_PARALLEL_LEVEL=${BUILD_JOBS} \
    MAKEFLAGS=-j${BUILD_JOBS} \
    MAX_JOBS=${BUILD_JOBS} \
    OQS_INSTALL_PATH=/usr/local \
    LD_LIBRARY_PATH=/usr/local/lib \
    QRS_DATA_DIR=/var/data

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates cmake curl ninja-build pkg-config \
 && rm -rf /var/lib/apt/lists/*

RUN --mount=type=secret,id=proxy_ca \
    set -eu; \
    build_ca=/etc/ssl/certs/ca-certificates.crt; \
    if [ -s /run/secrets/proxy_ca ]; then \
      cp "$build_ca" /tmp/build-ca.pem; \
      cat /run/secrets/proxy_ca >>/tmp/build-ca.pem; \
      build_ca=/tmp/build-ca.pem; \
    fi; \
    curl --cacert "$build_ca" --proto '=https' --tlsv1.2 --fail --location --retry 5 \
      "https://github.com/open-quantum-safe/liboqs/archive/refs/tags/${LIBOQS_VERSION}.tar.gz" \
      -o /tmp/liboqs.tar.gz \
 && echo "${LIBOQS_SHA256}  /tmp/liboqs.tar.gz" | sha256sum --check \
 && mkdir /tmp/liboqs-src \
 && tar -xzf /tmp/liboqs.tar.gz -C /tmp/liboqs-src --strip-components=1 \
 && cmake -S /tmp/liboqs-src -B /tmp/liboqs-build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/usr/local \
      -DBUILD_SHARED_LIBS=ON \
      -DOQS_USE_OPENSSL=OFF \
      -DOQS_BUILD_ONLY_LIB=ON \
      -DOQS_MINIMAL_BUILD="KEM_ml_kem_768;SIG_ml_dsa_44;SIG_ml_dsa_87" \
      -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
 && cmake --build /tmp/liboqs-build --parallel "${BUILD_JOBS}" \
 && cmake --install /tmp/liboqs-build \
 && rm -rf /tmp/liboqs.tar.gz /tmp/liboqs-src /tmp/liboqs-build /tmp/build-ca.pem

WORKDIR /app

COPY requirements.txt lock.manifest.json lock.manifest.pqsig pq_pubkey.b64 verify.py ./
COPY scripts/patch-diskcache-pysec-2026-2447.py ./scripts/
RUN --mount=type=secret,id=proxy_ca \
    set -eu; \
    build_ca=/etc/ssl/certs/ca-certificates.crt; \
    if [ -s /run/secrets/proxy_ca ]; then \
      cp "$build_ca" /tmp/build-ca.pem; \
      cat /run/secrets/proxy_ca >>/tmp/build-ca.pem; \
      build_ca=/tmp/build-ca.pem; \
    fi; \
    install_requirements=/app/requirements.txt; \
    if [ "$INCLUDE_LLAMA_RUNTIME" != "1" ]; then \
      awk 'BEGIN { skip=0 } /^[a-z0-9][a-z0-9._-]*==/ { skip=($0 ~ /^(diskcache|llama-cpp-python)==/) } !skip { print }' \
        /app/requirements.txt >/tmp/requirements-web.txt; \
      install_requirements=/tmp/requirements-web.txt; \
    fi; \
    PIP_CERT="$build_ca" python -m pip install --no-cache-dir --require-hashes -r "$install_requirements"; \
    python /app/verify.py; \
    if [ "$INCLUDE_LLAMA_RUNTIME" = "1" ]; then \
      python /app/scripts/patch-diskcache-pysec-2026-2447.py; \
    fi; \
    rm -f /tmp/build-ca.pem

FROM ${PYTHON_IMAGE} AS runtime

ARG INCLUDE_LLAMA_RUNTIME=0

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OQS_INSTALL_PATH=/usr/local \
    LD_LIBRARY_PATH=/usr/local/lib \
    QRS_DATA_DIR=/var/data

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libgomp1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local /usr/local

# Native llama bindings live only in the dedicated scanner image variant.
RUN if [ "$INCLUDE_LLAMA_RUNTIME" != "1" ]; then \
      python -m pip uninstall --yes llama-cpp-python diskcache; \
    fi

WORKDIR /app

COPY . .

RUN useradd -ms /bin/bash appuser \
 && mkdir -p /app/static /var/data /var/data/models \
 && chown -R appuser:appuser /app /var/data \
 && chmod 0700 /var/data \
 && chmod 0750 /var/data/models

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3000/healthz', timeout=4)" || exit 1

CMD ["gunicorn","main:app","-b","0.0.0.0:3000","-w","4","-k","gthread","--threads","4","--timeout","180","--graceful-timeout","30","--log-level","info","--preload","--max-requests","1000","--max-requests-jitter","200"]
