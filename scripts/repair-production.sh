#!/usr/bin/env bash
set -Eeuo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
cd "${CRAKHOST_DIR:-/opt/crakhost}"
[ -f .env ] || { echo ".env not found"; exit 1; }
set -a; . ./.env; set +a
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.production.yml)

# Ensure core services are up first.
"${COMPOSE[@]}" up -d postgres redis craknode panel

for i in $(seq 1 30); do
  "${COMPOSE[@]}" exec -T postgres pg_isready -U crakhost -d crakhost >/dev/null 2>&1 && break
  sleep 2
done

# Remove legacy dev/demo DB rows.
cat database/migrations/v0.14.sql | "${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost

NODE_NAME="$(hostname -s | tr -cd '[:alnum:]._-')"
[ -n "$NODE_NAME" ] || NODE_NAME="CRAKHOST-VPS-01"
NODE_LOCATION="${CRAKHOST_NODE_LOCATION:-VPS}"
NODE_TOKEN="${CRAKNODE_TOKEN:?CRAKNODE_TOKEN missing from .env}"

"${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost \
  -v node_name="$NODE_NAME" -v node_location="$NODE_LOCATION" -v node_token="$NODE_TOKEN" \
  -c "INSERT INTO nodes(name,location,base_url,enabled,api_token,last_seen_at,agent_version) VALUES (:'node_name',:'node_location','http://craknode:8088',true,:'node_token',now(),'0.14.0') ON CONFLICT(name) DO UPDATE SET location=excluded.location,base_url=excluded.base_url,enabled=true,api_token=excluded.api_token,last_seen_at=now(),agent_version=excluded.agent_version;"

# Verify DNS/network from panel to DB and CrakNode.
"${COMPOSE[@]}" exec -T panel node -e "require('dns').lookup('postgres',(e,a)=>{if(e){console.error(e);process.exit(1)};console.log('postgres:',a)})"
"${COMPOSE[@]}" exec -T panel node -e "fetch('http://craknode:8088/health').then(r=>r.text()).then(x=>console.log('craknode:',x)).catch(e=>{console.error(e);process.exit(1)})"

echo "Production repair complete. Legacy demo server removed; real VPS node registered as $NODE_NAME."
echo "Refresh the panel. Create a new Minecraft/FiveM server through Deploy Server to provision a real container."
