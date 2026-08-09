# Advanced Hardened Docker Installer

`install-docker.sh` deploys Roadscanner as a hardened **rootless Docker** service on Ubuntu/Debian-family hosts while preserving the application's strict post-quantum runtime.

## Quick start

```bash
git clone https://github.com/ornab74/roadscanner.git
cd roadscanner
sudo ./install-docker.sh
```

Roadscanner binds to `http://127.0.0.1:3000` by default. Keep the loopback bind and place a TLS reverse proxy or cloud load balancer in front for public traffic.

## Security model

The hardened installer now:

- uses a dedicated rootless Docker daemon under a locked, non-sudo service account;
- changes the service account to `/usr/sbin/nologin` after deployment while preserving systemd linger;
- explicitly uses RootlessKit + `slirp4netns` networking and verifies the running process arguments;
- keeps Ubuntu's `kernel.apparmor_restrict_unprivileged_userns=1` posture where available and installs the RootlessKit userns exception needed for rootless Docker;
- requires Docker seccomp and, when AppArmor is enabled on the host, requires the container to be AppArmor-confined;
- masks rootful Docker/containerd services on dedicated hosts when they were not already intentionally active;
- applies conservative host hardening for BPF, kernel pointer exposure, dmesg, ptrace, hardlinks, symlinks, FIFOs, and regular-file protections;
- freezes the checked-out source to a concrete Git commit and records a SHA-256 of `git archive HEAD`;
- resolves `python:3.12-slim` to an immutable registry digest before building and records that digest in the deployment manifest;
- builds liboqs only after SHA-256 verification of its source archive;
- installs the bootstrap `liboqs-python` binding with its exact requirements hash before PQ lock verification;
- removes the previous unpinned `pip --upgrade` step and installs all application dependencies with `--require-hashes` plus `pip check`;
- uses a multi-stage Dockerfile so compilers, CMake, Ninja, curl, and build headers never enter the runtime image;
- runs the image and Compose service as numeric UID/GID `10001:10001` with a `nologin` image account;
- stores application secrets outside the source/build context at `/etc/roadscanner/roadscanner.env` by default;
- automatically migrates the previous `/srv/roadscanner/roadscanner.env` location without regenerating encryption secrets;
- captures first-boot X25519, ML-KEM, and signature exports only in a mode-0600 file under `/run` and deletes it immediately after import;
- performs that PQ bootstrap with `--network none`;
- verifies deployment env files did not enter the built image;
- persists `/var/data` in the `roadscanner-data` volume and safely migrates an older volume to UID/GID 10001 using a one-shot, network-disabled namespaced container with only CHOWN/DAC_OVERRIDE capabilities;
- runs the service with a read-only root filesystem, no privileged mode, all capabilities dropped, `no-new-privileges`, bounded CPU/RAM/PIDs/nproc/file descriptors/logs, and a `noexec,nosuid,nodev` tmpfs;
- exposes port 3000 only on loopback by default;
- installs root-only Docker/Compose/health/audit helpers so unrelated local users cannot control the service daemon through convenience wrappers;
- runs a runtime security audit after deployment and a hardened systemd health timer every five minutes;
- records the source commit, source archive SHA-256, immutable base image digest, image ID, security options, AppArmor profile, limits, and health state in a root-only manifest.

## Overrides

```bash
sudo \
  SERVICE_USER=qrs \
  APP_DIR=/srv/qrs \
  CONFIG_DIR=/etc/qrs \
  BIND_ADDR=127.0.0.1 \
  PORT=3000 \
  MEMORY_LIMIT=4g \
  CPU_LIMIT=4.0 \
  PIDS_LIMIT=512 \
  REF=main \
  ./install-docker.sh
```

Useful switches:

```text
INSTALL_DOCKER=0      Docker CE/rootless extras are already installed
FORCE_UPDATE=1        discard local source changes and reset to origin/REF
HARDEN_HOST=0         do not install the conservative sysctl hardening file
REQUIRE_APPARMOR=0    do not fail if AppArmor is unavailable
PYTHON_IMAGE_TAG=...  base image tag to resolve and lock to a digest
```

`REQUIRE_APPARMOR=auto` is the default: AppArmor becomes mandatory when the host reports that it is enabled.

## Root-only operations

The helper commands are intentionally mode `0700`; use `sudo`:

```bash
sudo roadscanner-docker ps
sudo roadscanner-docker logs -f roadscanner
sudo roadscanner-compose ps
sudo roadscanner-compose restart roadscanner
sudo roadscanner-health
sudo roadscanner-security-audit
systemctl status roadscanner-health.timer
```

Persistent application data lives in Docker volume `roadscanner-data` at container path `/var/data`.

Persistent secrets default to `/etc/roadscanner/roadscanner.env`. The service account can read this file because its rootless Docker daemon must inject the environment, but unrelated local users cannot read it through the installer helpers.

## Manual Compose mode

```bash
cp roadscanner.env.example roadscanner.env
# replace every placeholder value
docker compose -f compose.yaml up -d --build
```

Manual Compose mode does **not** perform the installer's host hardening, immutable base-image resolution, rootless-daemon verification, secret migration, volume UID migration, or post-deploy runtime audit. For production, prefer the installer.

## Operational boundary

This deployment substantially reduces host and container attack surface, but it is not a substitute for host patching, a TLS reverse proxy, off-host encrypted backups, a real secret manager/HSM where available, and monitoring. The service account remains part of the trust boundary because it owns the rootless Docker daemon and therefore can inspect containers it launches.
