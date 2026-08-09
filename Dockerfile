# syntax=docker/dockerfile:1.7
ARG PYTHON_IMAGE=python:3.12-slim

FROM ${PYTHON_IMAGE} AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OQS_INSTALL_PATH=/usr/local \
    LD_LIBRARY_PATH=/usr/local/lib:${LD_LIBRARY_PATH}

WORKDIR /build

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      cmake \
      ninja-build \
      build-essential \
      pkg-config \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt lock.manifest.json lock.manifest.pqsig pq_pubkey.b64 verify.py ./

ARG LIBOQS_VERSION=0.14.0
ARG LIBOQS_TARBALL_SHA256=5b0df6138763b3fc4e385d58dbb2ee7c7c508a64a413d76a917529e3a9a207ea
ARG LIBOQS_PYTHON_VERSION=0.14.1
ARG LIBOQS_PYTHON_SHA256=e3c81e632d02122dda3734edc4ba83bd457eefa3fdb266d33ea908a77a17642f

# Build liboqs from the expected source archive and verify the archive before
# extraction. Build-only toolchains never enter the runtime stage.
RUN curl --proto '=https' --tlsv1.2 -fsSL --retry 5 --retry-all-errors \
      -o /tmp/liboqs.tar.gz \
      "https://github.com/open-quantum-safe/liboqs/archive/refs/tags/${LIBOQS_VERSION}.tar.gz" \
 && echo "${LIBOQS_TARBALL_SHA256}  /tmp/liboqs.tar.gz" | sha256sum -c - \
 && mkdir -p /tmp/liboqs \
 && tar -xzf /tmp/liboqs.tar.gz -C /tmp/liboqs --strip-components=1 \
 && cmake -S /tmp/liboqs -B /tmp/liboqs/build \
      -DCMAKE_INSTALL_PREFIX=/usr/local \
      -DBUILD_SHARED_LIBS=ON \
      -DOQS_USE_OPENSSL=OFF \
      -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
      -DCMAKE_BUILD_TYPE=Release \
      -G Ninja \
 && cmake --build /tmp/liboqs/build --parallel \
 && cmake --install /tmp/liboqs/build \
 && ldconfig \
 && rm -rf /tmp/liboqs /tmp/liboqs.tar.gz

# verify.py needs the oqs Python binding. Bootstrap exactly the artifact already
# present in requirements.txt and require its SHA-256 before importing it.
RUN printf 'liboqs-python==%s --hash=sha256:%s\n' \
      "$LIBOQS_PYTHON_VERSION" "$LIBOQS_PYTHON_SHA256" >/tmp/oqs-bootstrap.txt \
 && python -m pip install --no-cache-dir --require-hashes -r /tmp/oqs-bootstrap.txt \
 && rm -f /tmp/oqs-bootstrap.txt

# Verify the PQ-signed lock manifest and the requirements.txt digest before any
# remaining application dependency is installed.
RUN python /build/verify.py

# Every dependency must match a hash in requirements.txt.
RUN python -m pip install --no-cache-dir --require-hashes -r requirements.txt \
 && python -m pip check

FROM ${PYTHON_IMAGE} AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1 \
    OQS_INSTALL_PATH=/usr/local \
    LD_LIBRARY_PATH=/usr/local/lib:${LD_LIBRARY_PATH} \
    HOME=/tmp/roadscanner-home \
    XDG_CACHE_HOME=/tmp/roadscanner-cache

ARG APP_UID=10001
ARG APP_GID=10001
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="Roadscanner" \
      org.opencontainers.image.source="https://github.com/ornab74/roadscanner" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.created="$BUILD_DATE"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid "$APP_GID" appuser \
 && useradd --uid "$APP_UID" --gid "$APP_GID" --no-create-home \
      --home-dir /nonexistent --shell /usr/sbin/nologin appuser \
 && install -d -m 0750 -o "$APP_UID" -g "$APP_GID" /app /var/data

# /usr/local contains the Python runtime installed by the official base image,
# the hash-locked Python environment, and liboqs. Compiler/build packages remain
# only in the builder stage.
COPY --from=builder /usr/local /usr/local

WORKDIR /app
COPY --chown=${APP_UID}:${APP_GID} . /app

# Application code is immutable at runtime; only /var/data and tmpfs locations
# supplied by Compose are writable.
RUN chmod 0555 /app \
 && find /app -xdev -type d -exec chmod go-w {} + \
 && find /app -xdev -type f -exec chmod go-w {} +

USER ${APP_UID}:${APP_GID}

EXPOSE 3000

CMD ["gunicorn","main:app","-b","0.0.0.0:3000","-w","4","-k","gthread","--threads","4","--timeout","180","--graceful-timeout","30","--log-level","info","--preload","--max-requests","1000","--max-requests-jitter","200"]
