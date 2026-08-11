FROM python:3.12-slim

ENV PIP_NO_CACHE_DIR=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OQS_INSTALL_PATH=/usr/local LD_LIBRARY_PATH=/usr/local/lib

WORKDIR /app

COPY . /app

RUN set -eux; \
    test -f /app/binaryandwheel/SHA256SUMS; \
    cd /app/binaryandwheel; sha256sum -c SHA256SUMS; \
    tar -xzf liboqs-0.16.0-linux-x86_64-py312-slim.tar.gz -C /; \
    ldconfig; \
    python -m pip install --no-cache-dir ./liboqs_python-0.16.0-*.whl ./llama_cpp_python-0.3.16-*.whl; \
    grep -vE '^(llama-cpp-python|liboqs-python)==' /app/requirements.txt > /tmp/requirements-runtime.txt; \
    python -m pip install --no-cache-dir --require-hashes -r /tmp/requirements-runtime.txt; \
    python /app/verify.py; \
    useradd -ms /bin/bash appuser; \
    mkdir -p /app/static /var/data /var/data/models; \
    chown -R appuser:appuser /app /var/data; \
    chmod 0700 /var/data; chmod 0750 /var/data/models; \
    rm -rf /root/.cache /tmp/*

USER appuser

EXPOSE 3000

CMD ["gunicorn","main:app","-b","0.0.0.0:3000","-w","2","-k","gthread","--threads","2","--timeout","180","--graceful-timeout","30","--log-level","info","--preload","--max-requests","1000","--max-requests-jitter","200"]
