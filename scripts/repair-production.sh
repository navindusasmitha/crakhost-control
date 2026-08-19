#!/usr/bin/env bash
set -Eeuo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
cd "${CRAKHOST_DIR:-/opt/crakhost}"
[ -f .env ] || { echo ".env not found"; exit 1; }

set -a
. ./.env
set +a

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.production.yml)

# Remove the legacy demo runtime if it still exists. Its data volume is preserved.
if docker ps -aq --filter 'name=^/crakhost-minecraft-production$' | grep -q .; then
  echo "Removing legacy demo Minecraft container (volume preserved)..."
  docker rm -f crakhost-minecraft-production >/dev/null || true
fi

"${COMPOSE[@]}" up -d postgres redis craknode panel

READY=0
for _ in $(seq 1 40); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U crakhost -d crakhost >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" -ne 1 ]; then
  echo "PostgreSQL did not become ready."
  "${COMPOSE[@]}" logs postgres --tail=100 || true
  exit 1
fi

for f in database/migrations/v0.14.sql database/migrations/v0.15.sql; do
  if [ -f "$f" ]; then
    echo "Applying $f..."
    "${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost < "$f"
  fi
done

NODE_NAME="$(hostname -s | tr -cd '[:alnum:]._-')"
[ -n "$NODE_NAME" ] || NODE_NAME="CRAKHOST-VPS-01"
NODE_LOCATION="${CRAKHOST_NODE_LOCATION:-VPS}"
NODE_TOKEN="${CRAKNODE_TOKEN:?CRAKNODE_TOKEN missing from .env}"
NODE_CPU="$(nproc 2>/dev/null || echo 1)"
NODE_MEMORY_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 1024)"
NODE_DISK_MB="$(df -Pm / | awk 'NR==2 {print $2}')"

# psql variables are expanded reliably when SQL is supplied on stdin.
"${COMPOSE[@]}" exec -T postgres psql \
  -v ON_ERROR_STOP=1 \
  -v node_name="$NODE_NAME" \
  -v node_location="$NODE_LOCATION" \
  -v node_token="$NODE_TOKEN" \
  -v node_cpu="$NODE_CPU" \
  -v node_memory="$NODE_MEMORY_MB" \
  -v node_disk="$NODE_DISK_MB" \
  -U crakhost -d crakhost <<'SQL'
INSERT INTO nodes(
  name,location,base_url,enabled,api_token,last_seen_at,agent_version,
  capacity_cpu,capacity_memory_mb,capacity_disk_mb
)
VALUES (
  :'node_name', :'node_location', 'http://craknode:8088', true,
  :'node_token', now(), '0.15.1',
  CAST(:'node_cpu' AS numeric), CAST(:'node_memory' AS integer), CAST(:'node_disk' AS integer)
)
ON CONFLICT(name) DO UPDATE SET
  location=excluded.location,
  base_url=excluded.base_url,
  enabled=true,
  api_token=excluded.api_token,
  last_seen_at=now(),
  agent_version=excluded.agent_version,
  capacity_cpu=excluded.capacity_cpu,
  capacity_memory_mb=excluded.capacity_memory_mb,
  capacity_disk_mb=excluded.capacity_disk_mb;
SQL

"${COMPOSE[@]}" exec -T postgres psql -U crakhost -d crakhost \
  -c "DELETE FROM allocations a WHERE NOT EXISTS (SELECT 1 FROM servers s WHERE s.id=a.server_id);" >/dev/null

# Verify internal DNS and both public/authenticated node endpoints from the panel container.
"${COMPOSE[@]}" exec -T panel node -e "require('dns').lookup('postgres',(e,a)=>{if(e){console.error(e);process.exit(1)};console.log('postgres:',a)})"
"${COMPOSE[@]}" exec -T panel node -e "fetch('http://craknode:8088/health').then(async r=>{console.log('craknode health:',r.status,await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"
"${COMPOSE[@]}" exec -T panel node -e "fetch('http://craknode:8088/diagnostics',{headers:{authorization:'Bearer '+process.env.CRAKNODE_TOKEN}}).then(async r=>{console.log('craknode auth:',r.status,await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"

echo "Production repair complete."
echo "Real node: $NODE_NAME | CPU: $NODE_CPU | RAM: ${NODE_MEMORY_MB}MB | Disk: ${NODE_DISK_MB}MB"
