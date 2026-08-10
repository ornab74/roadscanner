FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OQS_INSTALL_PATH=/usr/local \
    LD_LIBRARY_PATH=/usr/local/lib

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl cmake ninja-build build-essential pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt lock.manifest.json lock.manifest.pqsig pq_pubkey.b64 ./

ARG LIBOQS_VERSION=0.16.0
ARG LIBOQS_TARBALL_SHA256=162d5b510518ee5f285f82fa1f16402a885176e818bf1b1a4c3c91c9a2f01eae

RUN curl --proto '=https' --tlsv1.2 -fsSL --retry 5 -o /tmp/liboqs.tar.gz \
      "https://github.com/open-quantum-safe/liboqs/archive/refs/tags/${LIBOQS_VERSION}.tar.gz" \
 && echo "${LIBOQS_TARBALL_SHA256}  /tmp/liboqs.tar.gz" | sha256sum -c - \
 && mkdir -p /tmp/liboqs \
 && tar -xzf /tmp/liboqs.tar.gz -C /tmp/liboqs --strip-components=1 \
 && cmake -S /tmp/liboqs -B /tmp/liboqs/build \
      -DCMAKE_INSTALL_PREFIX=/usr/local \
      -DBUILD_SHARED_LIBS=ON \
      -DOQS_USE_OPENSSL=OFF \
      -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
      -G Ninja \
 && cmake --build /tmp/liboqs/build --parallel \
 && cmake --install /tmp/liboqs/build \
 && ldconfig \
 && rm -rf /tmp/liboqs /tmp/liboqs.tar.gz

RUN python -m pip install --upgrade pip \
 && python -m pip install --no-cache-dir liboqs-python==0.16.0

COPY verify.py /app/verify.py
RUN python /app/verify.py

RUN python -m pip install --no-cache-dir --require-hashes -r requirements.txt

COPY . .

# Persistent application state lives under /var/data.  Create the mountpoint in
# the image and give it to the unprivileged runtime user so a freshly-created
# named volume inherits usable ownership instead of becoming root-only.
RUN useradd -ms /bin/bash appuser \
 && mkdir -p /app/static /var/data /var/data/models \
 && chown -R appuser:appuser /app /var/data \
 && chmod 0700 /var/data \
 && chmod 0750 /var/data/models

USER appuser
EXPOSE 3000

CMD ["gunicorn","main:app","-b","0.0.0.0:3000","-w","4","-k","gthread","--threads","4","--timeout","180","--graceful-timeout","30","--log-level","info","--preload","--max-requests","1000","--max-requests-jitter","200"]
