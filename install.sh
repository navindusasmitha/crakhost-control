#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }

REPO="${CRAKHOST_REPO:-navindusasmitha/crakhost-control}"
DIR="${CRAKHOST_DIR:-/opt/crakhost}"

apt-get update
apt-get install -y ca-certificates curl git openssl
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
docker compose version >/dev/null

rm -rf "$DIR"
git clone --depth 1 "https://github.com/$REPO.git" "$DIR"
cd "$DIR"

cp .env.example .env
DBPASS="$(openssl rand -hex 20)"
SESSION="$(openssl rand -hex 32)"
NODE="$(openssl rand -hex 32)"
sed -i "s/change-me-now/$DBPASS/g;s/replace-with-a-long-random-node-token/$NODE/g;s/replace-with-a-long-random-session-secret/$SESSION/g" .env
# Container-to-container service URLs for production compose
sed -i "s#@localhost:5432#@postgres:5432#g;s#redis://localhost:6379#redis://redis:6379#g;s#http://localhost:8088#http://craknode:8088#g" .env

read -rp "Panel domain (panel.example.com): " DOMAIN
read -rp "ACME email: " EMAIL
printf '\nPANEL_DOMAIN=%s\nACME_EMAIL=%s\nCRAKHOST_GITHUB_REPO=%s\n' "$DOMAIN" "$EMAIL" "$REPO" >> .env

# Fresh VPS volumes: create if missing, preserve if already present.
source .env || true
docker volume create "${CRAKHOST_PGDATA_VOLUME:-crakhost-pgdata}" >/dev/null
docker volume create "${CRAKHOST_MINECRAFT_VOLUME:-crakhost-minecraft-data}" >/dev/null
docker volume create "${CRAKHOST_BACKUPS_VOLUME:-crakhost-node-backups}" >/dev/null

echo "Starting CrakHost services..."
if ! docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build; then
  echo "Docker Compose failed. Current service state:"
  docker compose -f docker-compose.yml -f docker-compose.production.yml ps -a || true
  exit 1
fi

echo "Waiting for PostgreSQL health..."
READY=0
for i in $(seq 1 60); do
  if docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T postgres pg_isready -U crakhost -d crakhost >/dev/null 2>&1; then READY=1; break; fi
  sleep 2
done
if [ "$READY" -ne 1 ]; then
  echo "PostgreSQL did not become healthy. Logs:"
  docker compose -f docker-compose.yml -f docker-compose.production.yml logs postgres --tail=120 || true
  exit 1
fi

cat database/migrations/v0.13.sql | docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost
# Production panel runs in Docker, so LOCAL-DEV-01 must point to the service DNS name.
docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T postgres psql -U crakhost -d crakhost -c "UPDATE nodes SET base_url='http://craknode:8088' WHERE name='LOCAL-DEV-01';" >/dev/null

echo
 echo "CrakHost installation complete."
echo "Panel: https://$DOMAIN"
echo "Check: cd $DIR && docker compose -f docker-compose.yml -f docker-compose.production.yml ps"
