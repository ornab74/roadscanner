FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OQS_INSTALL_PATH=/usr/local \
    LD_LIBRARY_PATH=/usr/local/lib:${LD_LIBRARY_PATH}

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    cmake \
    ninja-build \
    build-essential \
    pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy required files first
COPY requirements.txt lock.manifest.json lock.manifest.pqsig pq_pubkey.b64 ./

ARG LIBOQS_VERSION=0.14.0
ARG LIBOQS_TARBALL_SHA256=5b0df6138763b3fc4e385d58dbb2ee7c7c508a64a413d76a917529e3a9a207ea

# Build liboqs
RUN curl -fsSL -o /tmp/liboqs.tar.gz \
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

# Upgrade pip
RUN python -m pip install --upgrade pip

# Install oqs bindings
RUN python -m pip install --no-cache-dir liboqs-python==0.14.1

# -------------------------------
# PQ verification (FIXED: no heredoc)
# -------------------------------
COPY verify.py /app/verify.py

RUN python /app/verify.py

# Install dependencies (locked)
RUN python -m pip install --no-cache-dir --require-hashes -r requirements.txt

# Copy app
COPY . .

# Create user
RUN useradd -ms /bin/bash appuser \
 && mkdir -p /app/static \
 && chown -R appuser:appuser /app

USER appuser

EXPOSE 3000

CMD ["gunicorn","main:app","-b","0.0.0.0:3000","-w","4","-k","gthread","--threads","4","--timeout","180","--graceful-timeout","30","--log-level","info","--preload","--max-requests","1000","--max-requests-jitter","200"]