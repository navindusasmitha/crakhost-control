#!/usr/bin/env bash
set -Eeuo pipefail

[ "$(id -u)" -eq 0 ] || { echo "[CrakHost] Run with sudo/root."; exit 1; }
DIR="${CRAKHOST_DIR:-/opt/crakhost}"
cd "$DIR"
[ -f .env ] || { echo "[CrakHost] Missing $DIR/.env" >&2; exit 1; }

OLD_SHA="$(git rev-parse HEAD)"
BACKUP_ROOT="${CRAKHOST_BACKUP_ROOT:-/var/backups/crakhost}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
SOURCE="${CRAKHOST_UPDATE_SOURCE:-terminal}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[CrakHost] Tracked source files have local changes. Commit/stash them before updating." >&2
  git status --short >&2 || true
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cp .env "$BACKUP_DIR/.env"
chmod 600 "$BACKUP_DIR/.env"
printf '%s\n' "$OLD_SHA" > "$BACKUP_DIR/source-sha.txt"

get_env(){ sed -n "s/^$1=//p" .env | tail -n 1; }
set_env(){
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" 'BEGIN{done=0} index($0,k"=")==1 {print k"="v;done=1;next} {print} END{if(!done)print k"="v}' .env > "$tmp"
  mv "$tmp" .env
  chmod 600 .env
}
ensure_secret(){
  local key="$1" current
  current="$(get_env "$key")"
  if [ -z "$current" ] || [[ "$current" == replace-with-* ]] || [[ "$current" == change-me-* ]]; then
    set_env "$key" "$(openssl rand -hex 32)"
    echo "[CrakHost] Generated missing $key for this existing installation."
  fi
}
ensure_value(){
  local key="$1" fallback="$2" current
  current="$(get_env "$key")"
  [ -n "$current" ] || set_env "$key" "$fallback"
}

ensure_secret CRAKHOST_CRON_SECRET
ensure_secret CRAKNODE_REGISTRATION_TOKEN
ensure_secret CRAKHOST_DEPLOY_TOKEN
ensure_value CRAKHOST_PENDING_ORDER_TTL_HOURS 24
ensure_value CRAKHOST_COMMERCE_CLEANUP_SECONDS 3600
if [ -z "$(get_env APP_URL)" ]; then
  PANEL_DOMAIN_VALUE="$(get_env PANEL_DOMAIN)"
  [ -n "$PANEL_DOMAIN_VALUE" ] && set_env APP_URL "https://${PANEL_DOMAIN_VALUE}"
fi

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.production.yml)

echo "[CrakHost] Stage 1/7: creating PostgreSQL backup..."
if ! "${COMPOSE[@]}" exec -T postgres pg_dump -U crakhost -d crakhost | gzip -9 > "$BACKUP_DIR/crakhost.sql.gz"; then
  echo "[CrakHost] Database backup failed; update cancelled." >&2
  rm -f "$BACKUP_DIR/crakhost.sql.gz"
  cp "$BACKUP_DIR/.env" .env
  chmod 600 .env
  exit 1
fi

echo "[CrakHost] Backup ready: $BACKUP_DIR"
echo "[CrakHost] Stage 2/7: fetching latest main branch..."
git fetch --prune origin main
git checkout -q main
git reset --hard origin/main
NEW_SHA="$(git rev-parse HEAD)"

if [ "$OLD_SHA" = "$NEW_SHA" ]; then
  echo "[CrakHost] Source is already on latest main ($NEW_SHA); re-applying production services."
else
  echo "[CrakHost] Updating $OLD_SHA -> $NEW_SHA"
fi

echo "[CrakHost] Stage 3/7: preparing privileged updater agent..."
CRAKHOST_UPDATE_SOURCE="$SOURCE" bash scripts/install-updater-agent.sh

rollback_code(){
  echo "[CrakHost] Restoring application source to $OLD_SHA" >&2
  git reset --hard "$OLD_SHA"
  "${COMPOSE[@]}" build panel || true
  "${COMPOSE[@]}" up -d postgres redis || true
  "${COMPOSE[@]}" up -d --no-deps --force-recreate craknode || true
  "${COMPOSE[@]}" up -d --no-deps panel || true
  "${COMPOSE[@]}" up -d --no-deps commerce-cleanup || true
  echo "[CrakHost] Database migrations are not automatically reversed." >&2
  echo "[CrakHost] Pre-update database backup: $BACKUP_DIR/crakhost.sql.gz" >&2
}

echo "[CrakHost] Stage 4/7: building panel..."
if ! "${COMPOSE[@]}" build panel; then
  echo "[CrakHost] Candidate panel build failed." >&2
  git reset --hard "$OLD_SHA"
  exit 1
fi

echo "[CrakHost] Stage 5/7: applying database migrations..."
"${COMPOSE[@]}" up -d postgres redis
if ! "${COMPOSE[@]}" run --rm migrate; then
  echo "[CrakHost] Database migration failed." >&2
  rollback_code
  exit 1
fi

echo "[CrakHost] Stage 6/7: restarting application services..."
if ! "${COMPOSE[@]}" up -d --no-deps --force-recreate craknode; then
  echo "[CrakHost] CrakNode restart failed." >&2
  rollback_code
  exit 1
fi
if ! "${COMPOSE[@]}" up -d --no-deps panel; then
  echo "[CrakHost] Panel startup failed." >&2
  rollback_code
  exit 1
fi
"${COMPOSE[@]}" up -d --no-deps commerce-cleanup

PANEL_OK=0
for _ in $(seq 1 90); do
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
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T panel node -e "fetch('http://craknode:8088/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then NODE_OK=1; break; fi
  sleep 2
done
if [ "$NODE_OK" -ne 1 ]; then
  echo "[CrakHost] CrakNode connectivity verification failed." >&2
  "${COMPOSE[@]}" logs craknode --tail=180 || true
  rollback_code
  exit 1
fi

if [ "$SOURCE" != "panel" ] && command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null
  systemctl reload nginx
fi

echo "[CrakHost] Stage 7/7: verification complete."
echo "[CrakHost] Update verified successfully."
echo "[CrakHost] Backup: $BACKUP_DIR"
curl -fsS http://127.0.0.1:4310/api/health; echo
"${COMPOSE[@]}" ps

# A browser-triggered job is owned by the currently running updater agent.
# Delay the agent restart until after this script exits so its watcher can
# persist the successful result, then load any newly deployed agent code.
if [ "$SOURCE" = "panel" ]; then
  REFRESH_UNIT="crakhost-updater-refresh-${CRAKHOST_UPDATE_JOB_ID:-$(date +%s)}"
  if command -v systemd-run >/dev/null 2>&1; then
    systemd-run --quiet --unit="$REFRESH_UNIT" --on-active=5s /bin/systemctl restart crakhost-updater.service >/dev/null 2>&1 || true
    echo "[CrakHost] Updater agent refresh scheduled."
  else
    nohup bash -c 'sleep 5; systemctl restart crakhost-updater.service' >/dev/null 2>&1 &
    echo "[CrakHost] Updater agent refresh scheduled with fallback launcher."
  fi
fi
