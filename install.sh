#!/usr/bin/env bash
set -Eeuo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
cd /

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
sed -i "s#@localhost:5432#@postgres:5432#g;s#redis://localhost:6379#redis://redis:6379#g;s#http://localhost:8088#http://craknode:8088#g" .env

DOMAIN="${PANEL_DOMAIN:-}"
EMAIL="${ACME_EMAIL:-}"
if [ -z "$DOMAIN" ]; then
  printf 'Panel domain (panel.example.com): ' > /dev/tty
  IFS= read -r DOMAIN < /dev/tty || true
fi
if [ -z "$EMAIL" ]; then
  printf 'ACME email: ' > /dev/tty
  IFS= read -r EMAIL < /dev/tty || true
fi
if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Domain and ACME email are required." >&2
  exit 1
fi
printf '\nPANEL_DOMAIN=%s\nACME_EMAIL=%s\nCRAKHOST_GITHUB_REPO=%s\n' "$DOMAIN" "$EMAIL" "$REPO" >> .env

# Fresh or existing persistent volumes.
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

# Apply all idempotent migrations, including removal of legacy demo rows.
for f in database/migrations/v*.sql; do
  cat "$f" | docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost >/dev/null
done

# Register this real VPS CrakNode. The panel and node share the crakhost Docker network.
NODE_NAME="$(hostname -s | tr -cd '[:alnum:]._-')"
[ -n "$NODE_NAME" ] || NODE_NAME="CRAKHOST-VPS-01"
NODE_LOCATION="${CRAKHOST_NODE_LOCATION:-VPS}"
docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost \
  -v node_name="$NODE_NAME" -v node_location="$NODE_LOCATION" -v node_token="$NODE" \
  -c "INSERT INTO nodes(name,location,base_url,enabled,api_token,last_seen_at,agent_version) VALUES (:'node_name',:'node_location','http://craknode:8088',true,:'node_token',now(),'0.14.0') ON CONFLICT(name) DO UPDATE SET location=excluded.location,base_url=excluded.base_url,enabled=true,api_token=excluded.api_token,last_seen_at=now(),agent_version=excluded.agent_version;" >/dev/null

# Verify panel can really reach CrakNode before declaring success.
if ! docker compose -f docker-compose.yml -f docker-compose.production.yml exec -T panel node -e "fetch('http://craknode:8088/health').then(r=>{if(!r.ok)process.exit(2);return r.text()}).then(()=>console.log('CrakNode link OK')).catch(()=>process.exit(3))"; then
  echo "CrakNode connectivity check failed." >&2
  exit 1
fi

echo
echo "CrakHost installation complete."
echo "Panel: https://$DOMAIN"
echo "Node: $NODE_NAME ($NODE_LOCATION)"
echo "Check: cd $DIR && docker compose -f docker-compose.yml -f docker-compose.production.yml ps"
