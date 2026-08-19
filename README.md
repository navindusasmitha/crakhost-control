# CrakHost Control v0.13 — Production VPS Edition

Production-focused release: Caddy domain/HTTPS overlay, Dockerized panel, Minecraft and FiveM production templates, GitHub release workflow, one-command Linux installer, backup-first updater, and in-panel update checker.

## VPS
```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install.sh | sudo bash
```

FiveM provisioning requires a valid Cfx.re server license key. The panel records this requirement and does not fabricate credentials.

The web panel intentionally does not receive root or Docker-socket access. `scripts/update.sh` is the privileged update boundary and creates a PostgreSQL backup before changing releases.

# CrakHost Control v0.12

Major infrastructure/security milestone based on v0.11.

## v0.12 additions
- Infrastructure Center for node capacity, DB host registry, and migration jobs
- Database-host registry schema
- Server migration job/progress schema
- Reseller ownership foundation
- TOTP/2FA-ready user schema and Security Center
- SFTP credential schema (transport disabled by default until securely configured)
- SMTP settings foundation
- Conflict-safe Windows upgrade script that preserves persistent volumes
- Existing v0.11 operations, API, billing, server controls, backups, schedules and support retained

## Upgrade from v0.11
```powershell
cd C:\Users\admin\Desktop\crakhost-control-v0.12
powershell -ExecutionPolicy Bypass -File .\upgrade-v012.ps1
npm install
npm run dev
```
Run `npm run worker` in a second terminal.

> Security note: v0.12 intentionally does not expose an unauthenticated SFTP daemon or store plaintext TOTP secrets through a public enrollment endpoint. Those transports must be configured with TLS/secret protection before public deployment.

# CrakHost Control v0.12 — Infrastructure & Operations

v0.11 focuses on upgrade reliability and day-2 hosting operations.

## New in v0.11

- Fixes Docker Compose persistent-volume ownership warnings by explicitly using external volumes.
- Upgrade script safely removes an existing `crakhost-minecraft-production` container before recreating the demo service, fixing the v0.10 name-conflict failure.
- New Operations Center with panel/database health, per-node latency, Docker version, managed/running container counts, disk-free diagnostics, and operational settings.
- CrakNode `/diagnostics` protected endpoint and agent version `0.11.0`.
- Node health snapshot history foundation.
- Admin server ownership transfer with transfer audit/history.
- Maintenance-mode operational flag and configurable maintenance message.
- Keeps v0.10 API, billing, support, webhooks, scheduler, backups, files, managed databases, node routing and server controls.

## Upgrade from v0.10

```powershell
cd C:\Users\admin\Desktop\crakhost-control-v0.10
docker compose down
```

Do **not** use `-v`.

Extract v0.11, copy the environment file, then run:

```powershell
copy C:\Users\admin\Desktop\crakhost-control-v0.10\.env C:\Users\admin\Desktop\crakhost-control-v0.11\.env
cd C:\Users\admin\Desktop\crakhost-control-v0.11
powershell -ExecutionPolicy Bypass -File .\upgrade-v011.ps1
npm install
npm run dev
```

Worker in a second terminal:

```powershell
cd C:\Users\admin\Desktop\crakhost-control-v0.11
npm run worker
```

Open `http://localhost:4310/operations` as an ADMIN/SUPPORT account to run node diagnostics.

## Notes

The persistent volumes deliberately keep their old v0.4 names so existing local data survives upgrades. v0.11 marks them as external instead of allowing Compose to treat them as volumes owned by each new project name.
