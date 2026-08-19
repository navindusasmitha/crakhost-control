# CrakHost Control v0.13 — Production VPS Edition

Production-focused release: Caddy domain/HTTPS overlay, Dockerized panel, Minecraft and FiveM production templates, GitHub release workflow, one-command Linux installer, backup-first updater, and in-panel update checker.

## VPS
```bash
curl -fsSL https://raw.githubusercontent.com/navindusasmitha/crakhost-control/main/install.sh | sudo bash
```

FiveM provisioning requires a valid Cfx.re server license key. The panel records this requirement and does not fabricate credentials.

The web panel intentionally does not receive root or Docker-socket access. `scripts/update.sh` is the privileged update boundary and creates a PostgreSQL backup before changing releases.
