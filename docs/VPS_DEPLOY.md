# CrakHost Control v0.51 — VPS Deployment

Target: Ubuntu 22.04/24.04 or Debian 12 VPS with a public IPv4 address and a DNS name such as `panel.example.com`.

## Before installation

1. Point the panel domain's A record to the VPS public IPv4 address.
2. Ensure inbound TCP 22, 80 and 443 are allowed by the VPS/provider firewall.
3. Use a fresh server or a server where `/opt/crakhost` is not already an active installation.
4. Have an admin email and a strong 12+ character admin password ready.

## One-command installation

```bash
curl -fsSL https://raw.githubusercontent.com/navindusasmitha/crakhost-control/main/install.sh | sudo bash
```

The installer asks for the panel domain, ACME email, admin login email and admin password. It then:

- installs Docker, Nginx and Certbot
- generates unique PostgreSQL, session, CrakNode, registration and maintenance secrets
- builds the panel and CrakNode stack
- runs all database migrations
- removes development seed access from the production database
- creates/updates the real initial ADMIN account and marks its email verified
- registers the local CrakNode
- verifies `/api/health` and CrakNode connectivity
- requests a Let's Encrypt certificate when DNS is ready

To run non-interactively, export `PANEL_DOMAIN`, `ACME_EMAIL`, `CRAKHOST_ADMIN_EMAIL`, `CRAKHOST_ADMIN_PASSWORD` and optionally `CRAKHOST_ADMIN_NAME` before starting the installer. Do not persist the admin password in the repository or `.env` file.

## Verify after installation

```bash
cd /opt/crakhost
sudo docker compose -f docker-compose.yml -f docker-compose.production.yml ps
curl -fsS http://127.0.0.1:4310/api/health
```

The public panel should be available at `https://<your-domain>` once the TLS certificate is issued.

## Production updates

```bash
sudo /opt/crakhost/scripts/update-production.sh
```

The updater refuses tracked local source changes, stores a copy of `.env`, creates a compressed PostgreSQL dump under `/var/backups/crakhost/<timestamp>/`, fast-forwards to `origin/main`, runs migrations, rebuilds the stack and verifies panel plus CrakNode health. If application verification fails it restores the previous application commit; database migrations are not automatically reversed, so keep the generated database backup.

## Useful diagnostics

```bash
cd /opt/crakhost
sudo docker compose -f docker-compose.yml -f docker-compose.production.yml logs panel --tail=200
sudo docker compose -f docker-compose.yml -f docker-compose.production.yml logs craknode --tail=200
sudo nginx -t
sudo certbot certificates
```
