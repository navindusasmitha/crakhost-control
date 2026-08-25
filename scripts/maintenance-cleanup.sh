#!/usr/bin/env bash
set -Eeuo pipefail

[ "$(id -u)" -eq 0 ] || { echo "[CrakHost] Maintenance cleanup requires root." >&2; exit 1; }

echo "[CrakHost] Safe maintenance cleanup starting at $(date -u +%FT%TZ)"
echo "[CrakHost] This action does NOT remove containers, volumes, databases or backups."
echo

echo "[CrakHost] Docker storage before cleanup:"
docker system df || true

echo
echo "[CrakHost] Removing dangling Docker images..."
docker image prune --force

echo
echo "[CrakHost] Removing Docker build cache older than 7 days..."
docker builder prune --force --filter until=168h

echo
echo "[CrakHost] Docker storage after cleanup:"
docker system df || true

echo
echo "[CrakHost] Root filesystem after cleanup:"
df -h /

echo "[CrakHost] Safe maintenance cleanup complete."
