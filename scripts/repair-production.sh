#!/usr/bin/env bash
set -Eeuo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
cd "${CRAKHOST_DIR:-/opt/crakhost}"
[ -f .env ] || { echo ".env not found"; exit 1; }
set -a; . ./.env; set +a
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.production.yml)
if docker ps -aq --filter 'name=^/crakhost-minecraft-production$' | grep -q .; then echo "Removing legacy demo Minecraft container (volume preserved)..."; docker rm -f crakhost-minecraft-production >/dev/null || true; fi
"${COMPOSE[@]}" up -d postgres redis craknode panel
READY=0
for i in $(seq 1 40); do if "${COMPOSE[@]}" exec -T postgres pg_isready -U crakhost -d crakhost >/dev/null 2>&1; then READY=1; break; fi; sleep 2; done
[ "$READY" -eq 1 ] || { "${COMPOSE[@]}" logs postgres --tail=100; exit 1; }
for f in database/migrations/v0.14.sql database/migrations/v0.15.sql; do [ -f "$f" ] && cat "$f" | "${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost; done
NODE_NAME="$(hostname -s | tr -cd '[:alnum:]._-')"; [ -n "$NODE_NAME" ] || NODE_NAME="CRAKHOST-VPS-01"
NODE_LOCATION="${CRAKHOST_NODE_LOCATION:-VPS}"; NODE_TOKEN="${CRAKNODE_TOKEN:?CRAKNODE_TOKEN missing from .env}"; NODE_CPU="$(nproc 2>/dev/null || echo 1)"; NODE_MEMORY_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 1024)"; NODE_DISK_MB="$(df -Pm / | awk 'NR==2 {print $2}')"
"${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost -v node_name="$NODE_NAME" -v node_location="$NODE_LOCATION" -v node_token="$NODE_TOKEN" -v node_cpu="$NODE_CPU" -v node_memory="$NODE_MEMORY_MB" -v node_disk="$NODE_DISK_MB" -c "INSERT INTO nodes(name,location,base_url,enabled,api_token,last_seen_at,agent_version,capacity_cpu,capacity_memory_mb,capacity_disk_mb) VALUES (:'node_name',:'node_location','http://craknode:8088',true,:'node_token',now(),'0.15.0',:'node_cpu',:'node_memory',:'node_disk') ON CONFLICT(name) DO UPDATE SET location=excluded.location,base_url=excluded.base_url,enabled=true,api_token=excluded.api_token,last_seen_at=now(),agent_version=excluded.agent_version,capacity_cpu=excluded.capacity_cpu,capacity_memory_mb=excluded.capacity_memory_mb,capacity_disk_mb=excluded.capacity_disk_mb;"
"${COMPOSE[@]}" exec -T postgres psql -U crakhost -d crakhost -c "DELETE FROM allocations a WHERE NOT EXISTS (SELECT 1 FROM servers s WHERE s.id=a.server_id);" >/dev/null
"${COMPOSE[@]}" exec -T panel node -e "require('dns').lookup('postgres',(e,a)=>{if(e){console.error(e);process.exit(1)};console.log('postgres:',a)})"
"${COMPOSE[@]}" exec -T panel node -e "fetch('http://craknode:8088/health').then(async r=>console.log('craknode health:',r.status,await r.text())).catch(e=>{console.error(e);process.exit(1)})"
"${COMPOSE[@]}" exec -T panel node -e "fetch('http://craknode:8088/diagnostics',{headers:{authorization:'Bearer '+process.env.CRAKNODE_TOKEN}}).then(async r=>{console.log('craknode auth:',r.status,await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"
echo "Production repair complete. Real node: $NODE_NAME | CPU: $NODE_CPU | RAM: ${NODE_MEMORY_MB}MB | Disk: ${NODE_DISK_MB}MB"
