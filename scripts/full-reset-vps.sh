#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/navindusasmitha/crakhost-control.git"
INSTALL_DIR="/opt/crakhost"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.production.yml)

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/full-reset-vps.sh --yes-delete-crakhost"
  exit 1
fi

if [[ "${1:-}" != "--yes-delete-crakhost" ]]; then
  cat <<'EOF'
CRAKHOST FULL RESET

This deletes CrakHost application data from this VPS:
- CrakHost Docker containers
- CrakHost Docker volumes (PostgreSQL data, server data, backups)
- CrakHost Docker network
- /opt/crakhost

It does NOT wipe Ubuntu, SSH, unrelated Docker projects, nginx, or unrelated files.

Re-run with:
  sudo bash scripts/full-reset-vps.sh --yes-delete-crakhost
EOF
  exit 2
fi

if [[ -t 0 ]]; then
  echo
  echo "WARNING: This is irreversible. All CrakHost customers, servers, DB records and backups will be deleted."
  read -r -p "Type DELETE CRAKHOST to continue: " CONFIRM
  [[ "$CONFIRM" == "DELETE CRAKHOST" ]] || { echo "Cancelled."; exit 3; }
fi

echo "[1/7] Stopping CrakHost compose stack..."
if [[ -d "$INSTALL_DIR" ]]; then
  cd "$INSTALL_DIR"
  docker compose "${COMPOSE_FILES[@]}" down --remove-orphans --volumes || true
fi

echo "[2/7] Removing remaining CrakHost-managed containers..."
mapfile -t containers < <(docker ps -aq --filter 'label=crakhost.managed=true' || true)
if (( ${#containers[@]} )); then docker rm -f "${containers[@]}" || true; fi
mapfile -t named < <(docker ps -a --format '{{.ID}} {{.Names}}' | awk '$2 ~ /^crakhost-/ || $2 ~ /^crakhost-control-/ {print $1}' || true)
if (( ${#named[@]} )); then docker rm -f "${named[@]}" || true; fi

echo "[3/7] Removing CrakHost volumes..."
mapfile -t volumes < <(docker volume ls --format '{{.Name}}' | grep -E '^(crakhost|crakhost-control)' || true)
if (( ${#volumes[@]} )); then docker volume rm -f "${volumes[@]}" || true; fi

echo "[4/7] Removing CrakHost network..."
docker network rm crakhost 2>/dev/null || true

echo "[5/7] Removing old application directory..."
cd /
rm -rf "$INSTALL_DIR"

echo "[6/7] Cloning fresh main branch..."
git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo "[7/7] Fresh source ready."
echo
echo "CrakHost data has been fully cleared from this VPS."
echo "Next run the installer from a safe working directory:"
echo "  cd ~"
echo "  curl -fsSL https://raw.githubusercontent.com/navindusasmitha/crakhost-control/main/install.sh | sudo bash"
echo
echo "NOTE: nginx/SSL/domain configuration outside /opt/crakhost was intentionally NOT deleted."
