#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
REPO="${CRAKHOST_REPO:-navindusasmitha/crakhost-control}"; DIR="${CRAKHOST_DIR:-/opt/crakhost}"
apt-get update && apt-get install -y ca-certificates curl git openssl
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
rm -rf "$DIR"; git clone --depth 1 "https://github.com/$REPO.git" "$DIR"; cd "$DIR"
cp .env.example .env
DBPASS="$(openssl rand -hex 20)"; SESSION="$(openssl rand -hex 32)"; NODE="$(openssl rand -hex 32)"
sed -i "s/change-me-now/$DBPASS/g;s/replace-with-a-long-random-node-token/$NODE/g;s/replace-with-a-long-random-session-secret/$SESSION/g" .env
read -rp "Panel domain (panel.example.com): " DOMAIN; read -rp "ACME email: " EMAIL
echo "PANEL_DOMAIN=$DOMAIN" >> .env; echo "ACME_EMAIL=$EMAIL" >> .env; echo "CRAKHOST_GITHUB_REPO=$REPO" >> .env
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
for i in $(seq 1 40);do docker compose exec -T postgres pg_isready -U crakhost -d crakhost >/dev/null 2>&1&&break;sleep 2;done
cat database/migrations/v0.13.sql|docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost
echo "Installed: https://$DOMAIN"
