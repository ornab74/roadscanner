ARG PYTHON_IMAGE=python:3.12-slim
FROM ${PYTHON_IMAGE}

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
RUN python -m pip install --no-cache-dir --require-hashes -r /app/requirements.txt \
 && python /app/verify.py

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
