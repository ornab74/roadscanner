# Roadscanner production deployment

The maintained production instructions are in the
[README installation guides](README.md#production-installation-guides).

Choose one path:

- [Prebuilt Docker image (recommended)](README.md#guide-1--prebuilt-docker-image-recommended)
- [Complete source build](README.md#guide-2--build-everything-from-source)

Both paths use rootless Docker, encrypted `systemd-creds` storage, strict
ML-KEM/ML-DSA application mode, and strict post-quantum Cloudflare QUIC. Do not
create a plaintext production `.env` file or expose ports 80/443 for the
Cloudflare Tunnel deployment.
