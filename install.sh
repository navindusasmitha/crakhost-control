#!/usr/bin/env bash
set -Eeuo pipefail

[ "$(id -u)" -eq 0 ] || { echo "[CrakHost] Run with sudo/root."; exit 1; }

REPO="${CRAKHOST_REPO:-navindusasmitha/crakhost-control}"
DIR="${CRAKHOST_DIR:-/opt/crakhost}"
ENABLE_TLS="${CRAKHOST_ENABLE_TLS:-true}"

if [ -d "$DIR/.git" ] && [ -f "$DIR/.env" ]; then
  echo "[CrakHost] Existing installation detected at $DIR." >&2
  echo "[CrakHost] Use: sudo $DIR/scripts/update-production.sh" >&2
  exit 2
fi

apt-get update
apt-get install -y ca-certificates curl git openssl nginx certbot python3 python3-certbot-nginx
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
docker compose version >/dev/null

rm -rf "$DIR"
git clone --depth 1 "https://github.com/$REPO.git" "$DIR"
cd "$DIR"
cp .env.example .env

set_env(){
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" 'BEGIN{done=0} index($0,k"=")==1 {print k"="v;done=1;next} {print} END{if(!done)print k"="v}' .env > "$tmp"
  mv "$tmp" .env
}

DBPASS="$(openssl rand -hex 24)"
SESSION="$(openssl rand -hex 32)"
NODE_TOKEN="$(openssl rand -hex 32)"
REG_TOKEN="$(openssl rand -hex 32)"
CRON_SECRET="$(openssl rand -hex 32)"
DEPLOY_TOKEN="$(openssl rand -hex 32)"

DOMAIN="${PANEL_DOMAIN:-}"
EMAIL="${ACME_EMAIL:-}"
ADMIN_NAME="${CRAKHOST_ADMIN_NAME:-CrakHost Admin}"
ADMIN_EMAIL="${CRAKHOST_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${CRAKHOST_ADMIN_PASSWORD:-}"
NODE_NAME="${CRAKNODE_NAME:-$(hostname -s | tr -cd '[:alnum:]._-')}"
NODE_LOCATION="${CRAKHOST_NODE_LOCATION:-${CRAKNODE_LOCATION:-VPS}}"
[ -n "$NODE_NAME" ] || NODE_NAME="CRAKHOST-VPS-01"

if [ -z "$DOMAIN" ]; then
  printf 'Panel domain (panel.example.com): ' > /dev/tty
  IFS= read -r DOMAIN < /dev/tty || true
fi
if [ -z "$EMAIL" ]; then
  printf 'Admin/ACME email: ' > /dev/tty
  IFS= read -r EMAIL < /dev/tty || true
fi
if [ -z "$ADMIN_EMAIL" ]; then
  printf 'Initial admin login email: ' > /dev/tty
  IFS= read -r ADMIN_EMAIL < /dev/tty || true
fi
if [ -z "$ADMIN_PASSWORD" ]; then
  printf 'Initial admin password (12+ chars): ' > /dev/tty
  IFS= read -rs ADMIN_PASSWORD < /dev/tty || true
  printf '\n' > /dev/tty
fi

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ] || [ -z "$ADMIN_EMAIL" ]; then
  echo "[CrakHost] Domain, ACME email and admin email are required." >&2
  exit 1
fi
if [ "${#ADMIN_PASSWORD}" -lt 12 ]; then
  echo "[CrakHost] Admin password must be at least 12 characters." >&2
  exit 1
fi

PUBLIC_SCHEME="http"
if [ "$ENABLE_TLS" = "true" ]; then PUBLIC_SCHEME="https"; fi

set_env POSTGRES_PASSWORD "$DBPASS"
set_env DATABASE_URL "postgresql://crakhost:${DBPASS}@postgres:5432/crakhost"
set_env SESSION_SECRET "$SESSION"
set_env APP_URL "${PUBLIC_SCHEME}://${DOMAIN}"
set_env CRAKNODE_TOKEN "$NODE_TOKEN"
set_env CRAKNODE_REGISTRATION_TOKEN "$REG_TOKEN"
set_env CRAKNODE_NAME "$NODE_NAME"
set_env CRAKNODE_LOCATION "$NODE_LOCATION"
set_env CRAKNODE_PUBLIC_URL "http://craknode:8088"
set_env CRAKHOST_CRON_SECRET "$CRON_SECRET"
set_env CRAKHOST_DEPLOY_TOKEN "$DEPLOY_TOKEN"
set_env PANEL_DOMAIN "$DOMAIN"
set_env ACME_EMAIL "$EMAIL"
set_env CRAKHOST_GITHUB_REPO "$REPO"
chmod 600 .env

docker volume create "${CRAKHOST_PGDATA_VOLUME:-crakhost-pgdata}" >/dev/null
docker volume create "${CRAKHOST_BACKUPS_VOLUME:-crakhost-node-backups}" >/dev/null

cat > /etc/nginx/sites-available/crakhost-panel <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:4310;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
NGINX
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/crakhost-panel /etc/nginx/sites-enabled/crakhost-panel
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# Install the narrow root-owned Unix-socket updater before the panel starts.
CRAKHOST_UPDATE_SOURCE=terminal bash scripts/install-updater-agent.sh

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.production.yml)
echo "[CrakHost] Building and starting services..."
if ! "${COMPOSE[@]}" up -d --build --remove-orphans; then
  echo "[CrakHost] Docker Compose failed. Current service state:" >&2
  "${COMPOSE[@]}" ps -a || true
  exit 1
fi

PANEL_READY=0
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:4310/api/health >/dev/null 2>&1; then PANEL_READY=1; break; fi
  sleep 2
done
if [ "$PANEL_READY" -ne 1 ]; then
  echo "[CrakHost] Panel health check failed." >&2
  "${COMPOSE[@]}" logs panel --tail=160 || true
  exit 1
fi

ADMIN_HASH="$(printf '%s' "$ADMIN_PASSWORD" | "${COMPOSE[@]}" exec -T panel node -e 'const crypto=require("node:crypto");let p="";process.stdin.on("data",c=>p+=c);process.stdin.on("end",()=>{const s=crypto.randomBytes(16);const h=crypto.scryptSync(p,s,64,{N:16384,r:8,p:1});process.stdout.write(`scrypt$16384$8$1$${s.toString("base64")}$${h.toString("base64")}`)})')"
unset ADMIN_PASSWORD

"${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost \
  -v admin_name="$ADMIN_NAME" -v admin_email="$ADMIN_EMAIL" -v admin_hash="$ADMIN_HASH" <<'SQL'
INSERT INTO users(name,email,password_hash,role,credits,email_verified_at,banned_at,ban_reason)
VALUES (:'admin_name',lower(:'admin_email'),:'admin_hash','ADMIN',0,now(),null,'')
ON CONFLICT(email) DO UPDATE SET
  name=excluded.name,
  password_hash=excluded.password_hash,
  role='ADMIN',
  email_verified_at=coalesce(users.email_verified_at,now()),
  banned_at=null,
  ban_reason='';

DELETE FROM users WHERE email='admin@crakhost.local' AND email<>lower(:'admin_email');
DELETE FROM nodes n WHERE n.name='LOCAL-DEV-01' AND NOT EXISTS (SELECT 1 FROM servers s WHERE s.node_id=n.id);
SQL

"${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost \
  -v node_name="$NODE_NAME" -v node_location="$NODE_LOCATION" -v node_token="$NODE_TOKEN" \
  -c "INSERT INTO nodes(name,location,base_url,enabled,api_token,last_seen_at,agent_version) VALUES (:'node_name',:'node_location','http://craknode:8088',true,:'node_token',now(),'0.14.0') ON CONFLICT(name) DO UPDATE SET location=excluded.location,base_url=excluded.base_url,enabled=true,api_token=excluded.api_token,last_seen_at=now(),agent_version=excluded.agent_version;" >/dev/null

if ! "${COMPOSE[@]}" exec -T panel node -e "fetch('http://craknode:8088/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
  echo "[CrakHost] CrakNode connectivity check failed." >&2
  exit 1
fi

TLS_READY=false
if [ "$ENABLE_TLS" = "true" ]; then
  echo "[CrakHost] Requesting HTTPS certificate for $DOMAIN..."
  if certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN"; then
    TLS_READY=true
  else
    echo "[CrakHost] HTTPS setup did not complete. Verify DNS points to this VPS, then run:" >&2
    echo "sudo certbot --nginx -m '$EMAIL' -d '$DOMAIN' --agree-tos --redirect" >&2
  fi
fi

systemctl reload nginx

echo
echo "[CrakHost] CrakHost Control v0.52 installation complete."
echo "Panel health: http://127.0.0.1:4310/api/health"
if [ "$TLS_READY" = "true" ]; then
  echo "Public panel: https://$DOMAIN"
else
  echo "Public panel: http://$DOMAIN (HTTPS pending if enabled)"
fi
echo "Admin email: $ADMIN_EMAIL"
echo "Node: $NODE_NAME ($NODE_LOCATION)"
echo "In-panel updater: enabled"
echo "Manual fallback update: sudo $DIR/scripts/update-production.sh"
echo "Status: cd $DIR && docker compose -f docker-compose.yml -f docker-compose.production.yml ps"
