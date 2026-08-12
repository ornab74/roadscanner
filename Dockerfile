ARG PYTHON_IMAGE=python:3.12-slim
FROM ${PYTHON_IMAGE} AS builder

ARG LIBOQS_VERSION=0.14.0
ARG LIBOQS_SHA256=5b0df6138763b3fc4e385d58dbb2ee7c7c508a64a413d76a917529e3a9a207ea

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OQS_INSTALL_PATH=/usr/local \
    LD_LIBRARY_PATH=/usr/local/lib

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates cmake curl ninja-build pkg-config \
 && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 --fail --location --retry 5 \
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
      -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
 && cmake --build /tmp/liboqs-build --parallel \
 && cmake --install /tmp/liboqs-build \
 && rm -rf /tmp/liboqs.tar.gz /tmp/liboqs-src /tmp/liboqs-build

WORKDIR /app

COPY requirements.txt lock.manifest.json lock.manifest.pqsig pq_pubkey.b64 verify.py ./
RUN python -m pip install --no-cache-dir --require-hashes -r /app/requirements.txt \
 && python /app/verify.py

FROM ${PYTHON_IMAGE} AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OQS_INSTALL_PATH=/usr/local \
    LD_LIBRARY_PATH=/usr/local/lib

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libgomp1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local /usr/local

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
