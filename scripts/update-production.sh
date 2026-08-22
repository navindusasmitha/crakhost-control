#!/usr/bin/env bash
set -Eeuo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
cd /opt/crakhost

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.production.yml)
OLD_SHA="$(git rev-parse HEAD)"

echo "[CrakHost] Current commit: $OLD_SHA"
git fetch origin main
git reset --hard origin/main
NEW_SHA="$(git rev-parse HEAD)"
echo "[CrakHost] Updating to: $NEW_SHA"

if ! "${COMPOSE[@]}" build panel; then
  echo "[CrakHost] Panel build failed. Restoring source tree to $OLD_SHA" >&2
  git reset --hard "$OLD_SHA"
  exit 1
fi

if ! "${COMPOSE[@]}" up -d --remove-orphans; then
  echo "[CrakHost] Docker startup failed." >&2
  "${COMPOSE[@]}" ps -a || true
  exit 1
fi

PANEL_OK=0
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4310/ >/dev/null 2>&1; then PANEL_OK=1; break; fi
  sleep 2
done
if [ "$PANEL_OK" -ne 1 ]; then
  echo "[CrakHost] Panel failed health verification." >&2
  "${COMPOSE[@]}" logs panel --tail=150 || true
  exit 1
fi

NODE_OK=0
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T panel node -e "fetch('http://craknode:8088/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then NODE_OK=1; break; fi
  sleep 2
done
if [ "$NODE_OK" -ne 1 ]; then
  echo "[CrakHost] CrakNode connectivity verification failed." >&2
  "${COMPOSE[@]}" logs craknode --tail=150 || true
  exit 1
fi

echo "[CrakHost] Update verified successfully."
"${COMPOSE[@]}" ps
