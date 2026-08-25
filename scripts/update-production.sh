#!/usr/bin/env bash
set -Eeuo pipefail

[ "$(id -u)" -eq 0 ] || { echo "[CrakHost] Run with sudo/root."; exit 1; }
DIR="${CRAKHOST_DIR:-/opt/crakhost}"
cd "$DIR"
[ -f .env ] || { echo "[CrakHost] Missing $DIR/.env" >&2; exit 1; }

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.production.yml)
OLD_SHA="$(git rev-parse HEAD)"
BACKUP_ROOT="${CRAKHOST_BACKUP_ROOT:-/var/backups/crakhost}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[CrakHost] Tracked source files have local changes. Commit/stash them before updating." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cp .env "$BACKUP_DIR/.env"
chmod 600 "$BACKUP_DIR/.env"

echo "[CrakHost] Creating PostgreSQL backup..."
if ! "${COMPOSE[@]}" exec -T postgres pg_dump -U crakhost -d crakhost | gzip -9 > "$BACKUP_DIR/crakhost.sql.gz"; then
  echo "[CrakHost] Database backup failed; update cancelled." >&2
  rm -f "$BACKUP_DIR/crakhost.sql.gz"
  exit 1
fi
printf '%s\n' "$OLD_SHA" > "$BACKUP_DIR/source-sha.txt"

echo "[CrakHost] Backup ready: $BACKUP_DIR"
git fetch --prune origin main
git checkout -q main
git reset --hard origin/main
NEW_SHA="$(git rev-parse HEAD)"

if [ "$OLD_SHA" = "$NEW_SHA" ]; then
  echo "[CrakHost] Already on latest main ($NEW_SHA)."
  curl -fsS http://127.0.0.1:4310/api/health || true
  exit 0
fi

echo "[CrakHost] Updating $OLD_SHA -> $NEW_SHA"

rollback_code(){
  echo "[CrakHost] Restoring application source to $OLD_SHA" >&2
  git reset --hard "$OLD_SHA"
  "${COMPOSE[@]}" up -d --build --remove-orphans || true
  echo "[CrakHost] Database migrations are not automatically reversed." >&2
  echo "[CrakHost] Pre-update database backup: $BACKUP_DIR/crakhost.sql.gz" >&2
}

if ! "${COMPOSE[@]}" build panel; then
  echo "[CrakHost] Candidate panel build failed." >&2
  git reset --hard "$OLD_SHA"
  exit 1
fi

"${COMPOSE[@]}" up -d postgres redis craknode
if ! "${COMPOSE[@]}" run --rm migrate; then
  echo "[CrakHost] Database migration failed." >&2
  rollback_code
  exit 1
fi
if ! "${COMPOSE[@]}" up -d --build --remove-orphans; then
  echo "[CrakHost] Docker startup failed." >&2
  "${COMPOSE[@]}" ps -a || true
  rollback_code
  exit 1
fi

PANEL_OK=0
for i in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:4310/api/health >/dev/null 2>&1; then PANEL_OK=1; break; fi
  sleep 2
done
if [ "$PANEL_OK" -ne 1 ]; then
  echo "[CrakHost] Panel readiness verification failed." >&2
  "${COMPOSE[@]}" logs panel --tail=180 || true
  rollback_code
  exit 1
fi

NODE_OK=0
for i in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T panel node -e "fetch('http://craknode:8088/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then NODE_OK=1; break; fi
  sleep 2
done
if [ "$NODE_OK" -ne 1 ]; then
  echo "[CrakHost] CrakNode connectivity verification failed." >&2
  "${COMPOSE[@]}" logs craknode --tail=180 || true
  rollback_code
  exit 1
fi

nginx -t >/dev/null
systemctl reload nginx

echo "[CrakHost] Update verified successfully."
echo "[CrakHost] Backup: $BACKUP_DIR"
curl -fsS http://127.0.0.1:4310/api/health; echo
"${COMPOSE[@]}" ps
