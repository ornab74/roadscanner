# Advanced Docker Installer

`install-docker.sh` deploys Roadscanner as a hardened **rootless Docker** service on Ubuntu/Debian-family hosts while preserving the app's strict post-quantum runtime.

## Quick start

```bash
git clone https://github.com/ornab74/roadscanner.git
cd roadscanner
sudo ./install-docker.sh
```

By default Roadscanner binds only to `http://127.0.0.1:3000`. Keep that loopback bind and put Caddy, Nginx, or a cloud TLS load balancer in front for public deployment.

The installer:

- installs Docker CE plus rootless extras and Compose;
- creates a dedicated unprivileged `roadscanner` service account;
- removes that account from `sudo`, `wheel`, and `docker` groups;
- enables linger for its user systemd instance;
- clones or fast-forwards the application source;
- generates persistent application/admin secrets in a mode-0600 env file;
- builds the existing Dockerfile, retaining its pinned liboqs source SHA-256 verification and hash-locked Python dependencies;
- performs a one-time application bootstrap to persist generated X25519, ML-KEM, and signature keys without printing them into installer logs;
- persists `/var/data` through the `roadscanner-data` named volume;
- uses a read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, bounded CPU/RAM/PIDs/logs, and a hardened tmpfs;
- installs health-check helper commands and a five-minute systemd timer;
- records a deployment manifest and installer log.

## Overrides

```bash
sudo \
  SERVICE_USER=qrs \
  APP_DIR=/srv/qrs \
  BIND_ADDR=127.0.0.1 \
  PORT=3000 \
  MEMORY_LIMIT=4g \
  CPU_LIMIT=4.0 \
  PIDS_LIMIT=768 \
  REF=main \
  ./install-docker.sh
```

Set `INSTALL_DOCKER=0` when Docker CE/rootless extras are already installed. The installer stops on a dirty existing checkout unless `FORCE_UPDATE=1` is explicitly supplied.

## Operations

```bash
roadscanner-docker ps
roadscanner-docker logs -f roadscanner
roadscanner-compose ps
roadscanner-compose restart roadscanner
sudo roadscanner-health
systemctl status roadscanner-health.timer
```

Persistent application data lives in Docker volume `roadscanner-data` at container path `/var/data`.

Persistent secrets default to `/srv/roadscanner/roadscanner.env`. Do not commit or serve this file.

## Manual Compose mode

```bash
cp roadscanner.env.example roadscanner.env
# replace all placeholder values
docker compose -f compose.yaml up -d --build
```

For production, prefer the installer-generated secret file or a dedicated secret manager.
