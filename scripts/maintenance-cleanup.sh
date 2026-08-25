#!/usr/bin/env bash
set -Eeuo pipefail

[ "$(id -u)" -eq 0 ] || { echo "[CrakHost] Maintenance cleanup requires root." >&2; exit 1; }

CACHE_KEEP="${CRAKHOST_BUILD_CACHE_KEEP:-4GB}"

echo "[CrakHost] Safe maintenance cleanup starting at $(date -u +%FT%TZ)"
echo "[CrakHost] This action does NOT remove containers, volumes, databases or backups."
echo "[CrakHost] Build cache policy: keep approximately $CACHE_KEEP of reusable cache."
echo

echo "[CrakHost] Docker storage before cleanup:"
docker system df || true

echo
echo "[CrakHost] Removing dangling Docker images..."
docker image prune --force

echo
echo "[CrakHost] Trimming unused Docker build cache..."
if docker builder prune --help 2>&1 | grep -q -- '--keep-storage'; then
  docker builder prune --force --all --keep-storage "$CACHE_KEEP"
else
  echo "[CrakHost] Docker does not support --keep-storage; using conservative 24-hour cache pruning fallback."
  docker builder prune --force --filter until=24h
fi

echo
echo "[CrakHost] Docker storage after cleanup:"
docker system df || true

echo
echo "[CrakHost] Root filesystem after cleanup:"
df -h /

echo "[CrakHost] Safe maintenance cleanup complete."
