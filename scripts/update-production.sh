#!/usr/bin/env bash
set -Eeuo pipefail

[ "$(id -u)" -eq 0 ] || { echo "[CrakHost] Run with sudo"; exit 1; }
cd /opt/crakhost
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.production.yml)
OLD_SHA="$(git rev-parse HEAD)"
NEW_SHA=""

rollback(){
  echo "[CrakHost] Rolling back to $OLD_SHA" >&2
  git reset --hard "$OLD_SHA"
  "${COMPOSE[@]}" build panel || true
  "${COMPOSE[@]}" up -d --remove-orphans || true
  echo "[CrakHost] Rollback attempted. Inspect: docker compose -f docker-compose.yml -f docker-compose.production.yml ps" >&2
}
trap 'echo "[CrakHost] Update aborted." >&2' INT TERM

echo "[CrakHost] Current commit: $OLD_SHA"
git fetch --prune origin main
git reset --hard origin/main
NEW_SHA="$(git rev-parse HEAD)"
if [ "$OLD_SHA" = "$NEW_SHA" ]; then echo "[CrakHost] Already on latest main ($NEW_SHA)."; fi
echo "[CrakHost] Candidate: $NEW_SHA"

if ! "${COMPOSE[@]}" build panel; then
  echo "[CrakHost] Candidate build failed; restoring source." >&2
  git reset --hard "$OLD_SHA"
  exit 1
fi

if ! "${COMPOSE[@]}" up -d --remove-orphans; then
  echo "[CrakHost] Docker startup/migration failed." >&2
  "${COMPOSE[@]}" ps -a || true
  rollback
  exit 1
fi

PANEL_OK=0
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4310/ >/dev/null 2>&1; then PANEL_OK=1; break; fi
  sleep 2
done
if [ "$PANEL_OK" -ne 1 ]; then
  echo "[CrakHost] Panel health verification failed." >&2
  "${COMPOSE[@]}" logs panel --tail=150 || true
  rollback
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
  rollback
  exit 1
fi

echo "[CrakHost] Update verified successfully: $OLD_SHA -> $NEW_SHA"
"${COMPOSE[@]}" ps
