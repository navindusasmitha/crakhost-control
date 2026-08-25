# CrakHost Control v0.51

CrakHost Control is a self-hosted hosting control plane for game servers and VPS-style services. It combines a Next.js customer/admin panel, PostgreSQL billing data, Redis, and the CrakNode Docker runtime agent.

## Current capabilities

- Customer accounts, email verification, sessions and staff roles
- Plans, wallet billing, invoices and protected order lifecycle
- Idempotent checkout and resumable provisioning
- Minecraft/game server provisioning through CrakNode
- Server console/actions, backups, databases, allocations and schedules
- Admin users, plans, orders, invoices, nodes and support tooling
- Support tickets, API keys, webhooks and notifications
- CrakMail self-hosted mail stack
- Production Docker Compose, Nginx reverse proxy and optional Let's Encrypt TLS
- Backup-first production updater and health checks

External payment gateways are intentionally disabled for now. The active checkout methods are CrakHost Wallet and the development test-card simulator.

## Production VPS install

Point your panel domain to the VPS first, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/navindusasmitha/crakhost-control/main/install.sh | sudo bash
```

The v0.51 installer generates production secrets, creates the real initial admin account, removes development seed access, starts the stack, verifies panel/CrakNode health and attempts HTTPS setup.

Detailed deployment guide: [`docs/VPS_DEPLOY.md`](docs/VPS_DEPLOY.md)

## Update an existing VPS

```bash
sudo /opt/crakhost/scripts/update-production.sh
```

The updater creates an `.env` copy and compressed PostgreSQL backup before changing the running release.

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

Panel: `http://127.0.0.1:4310`

## Main services

- `panel` — Next.js control panel
- `postgres` — primary application database
- `redis` — application cache/session support
- `craknode` — Docker runtime/provisioning agent
- `commerce-cleanup` — expires stale unpaid orders
- optional CrakMail services via `docker-compose.mail.yml`

## Repository

`navindusasmitha/crakhost-control`
