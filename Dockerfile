FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OQS_INSTALL_PATH=/usr/local \
    LD_LIBRARY_PATH=/usr/local/lib

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt lock.manifest.json lock.manifest.pqsig pq_pubkey.b64 verify.py ./
COPY binaryandwheel/ /opt/roadscanner-native/

# SECURITY PIN: only the manually-reviewed liboqs 0.14.0 native bundle is accepted.
# SHA256SUMS must cover the exact tarball and wheels copied into this build context.
RUN cd /opt/roadscanner-native \
 && test -f liboqs-0.14.0-debian-py312-x86_64.tar.gz \
 && test ! -e liboqs-0.16.0-debian-py312-x86_64.tar.gz \
 && sha256sum -c SHA256SUMS \
 && tar -xzf liboqs-0.14.0-debian-py312-x86_64.tar.gz -C / \
 && ldconfig \
 && python -m pip install --no-cache-dir ./liboqs_python-0.14.0-*.whl \
 && python /app/verify.py \
 && python -m pip install --no-cache-dir ./llama_cpp_python-0.3.16-*.whl \
 && python -m pip install --no-cache-dir --require-hashes -r /app/requirements.txt \
 && rm -rf /opt/roadscanner-native

COPY . .

RUN useradd -ms /bin/bash appuser \
 && mkdir -p /app/static /var/data /var/data/models \
 && chown -R appuser:appuser /app /var/data \
 && chmod 0700 /var/data \
 && chmod 0750 /var/data/models

USER appuser
EXPOSE 3000

CMD ["gunicorn","main:app","-b","0.0.0.0:3000","-w","4","-k","gthread","--threads","4","--timeout","180","--graceful-timeout","30","--log-level","info","--preload","--max-requests","1000","--max-requests-jitter","200"]
