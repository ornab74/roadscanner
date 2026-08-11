# Prebuilt Linux native artifacts

This directory is populated from the **Build Linux native artifacts** GitHub Actions artifact before producing the Roadscanner Docker image.

Expected files for the DigitalOcean Linux x86_64 / `python:3.12-slim` target:

- `liboqs-0.16.0-linux-x86_64-py312-slim.tar.gz`
- `liboqs_python-0.16.0-*.whl`
- `llama_cpp_python-0.3.16-*.whl`
- `SHA256SUMS`

The workflow deliberately builds inside `python:3.12-slim`, matching the Docker runtime instead of linking against the GitHub runner's Ubuntu userspace. The llama wheel disables host-specific AVX/AVX2/FMA/BMI2 tuning so a wheel built on GitHub-hosted hardware is not accidentally tied to that runner CPU.

The Docker build verifies `SHA256SUMS` before installing any native artifact. Do not add unverified binaries to this directory.
