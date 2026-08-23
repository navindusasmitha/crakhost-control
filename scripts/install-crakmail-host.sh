#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

DOMAIN="${1:-}"
PUBLIC_IP="${2:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash scripts/install-crakmail-host.sh example.com [PUBLIC_IP]" >&2
  exit 2
fi
DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed 's/^\.\+//;s/\.\+$//')"
if [[ ! "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
  echo "Invalid domain: $DOMAIN" >&2
  exit 2
fi
MAIL_HOST="mail.${DOMAIN}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
[[ -f "$ENV_FILE" ]] || { echo "$ENV_FILE not found. Create production .env first." >&2; exit 1; }

if [[ -z "$PUBLIC_IP" ]]; then
  if command -v curl >/dev/null 2>&1; then PUBLIC_IP="$(curl -4fsS --max-time 6 https://api.ipify.org 2>/dev/null || true)"; fi
fi
if [[ -z "$PUBLIC_IP" ]]; then
  PUBLIC_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1);exit}}')"
fi
if [[ ! "$PUBLIC_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "Could not determine a public IPv4 address. Pass it as the second argument." >&2
  exit 1
fi

set_env(){
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}
set_env MAIL_DOMAIN "$DOMAIN"
set_env MAIL_HOSTNAME "$MAIL_HOST"
set_env MAIL_PUBLIC_IP "$PUBLIC_IP"
set_env CRAKMAIL_DKIM_SELECTOR "mail"
set_env CRAKMAIL_DKIM_SYNC_SECONDS "30"
set_env CRAKMAIL_WEBMAIL_URL "https://${MAIL_HOST}"

printf '\nCrakMail bootstrap\n==================\nDomain:      %s\nMail host:   %s\nPublic IPv4: %s\n\n' "$DOMAIN" "$MAIL_HOST" "$PUBLIC_IP"

if ! command -v nginx >/dev/null 2>&1; then
  echo "Host Nginx is required for Roundcube webmail reverse proxy." >&2
  exit 1
fi

SITE=/etc/nginx/sites-available/crakmail-webmail.conf
cat >"$SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${MAIL_HOST};
    client_max_body_size 25m;

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_pass http://127.0.0.1:8888;
    }
}
EOF
ln -sfn "$SITE" /etc/nginx/sites-enabled/crakmail-webmail.conf
nginx -t
systemctl reload nginx

if ! command -v certbot >/dev/null 2>&1; then
  echo "Installing Certbot Nginx plugin..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
fi

ACME_EMAIL="$(grep -E '^ACME_EMAIL=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
if [[ -n "$ACME_EMAIL" && "$ACME_EMAIL" == *@* && "$ACME_EMAIL" != *example.com ]]; then
  certbot --nginx -d "$MAIL_HOST" --non-interactive --agree-tos --redirect -m "$ACME_EMAIL"
else
  certbot --nginx -d "$MAIL_HOST" --non-interactive --agree-tos --redirect --register-unsafely-without-email
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw allow 25/tcp
  ufw allow 465/tcp
  ufw allow 587/tcp
  ufw allow 993/tcp
fi

cd "$ROOT"
echo "Starting migration, panel, CrakMail and Roundcube..."
docker compose \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  -f docker-compose.mail.yml \
  up -d --build --force-recreate migrate panel crakmail roundcube

printf '\nWaiting for services...\n'
sleep 20
docker compose -f docker-compose.yml -f docker-compose.production.yml -f docker-compose.mail.yml ps

set +e
MAIL_HOSTNAME="$MAIL_HOST" MAIL_PUBLIC_IP="$PUBLIC_IP" bash "$ROOT/scripts/check-crakmail-network.sh"
NETWORK_RC=$?
set -e

cat <<EOF

CrakMail host installation finished.

Next:
  1. In CrakHost Admin -> Mail Center -> Mail Hosting, confirm the domain and copy DNS records.
  2. Publish A/MX/SPF/DKIM/DMARC at your DNS provider.
  3. At your VPS provider, set PTR/reverse DNS: ${PUBLIC_IP} -> ${MAIL_HOST}
  4. Create mailboxes such as support@${DOMAIN} and billing@${DOMAIN} in the admin UI.
  5. Webmail: https://${MAIL_HOST}

EOF
if [[ "$NETWORK_RC" -ne 0 ]]; then
  echo "WARNING: outbound port 25 did not pass. Direct internet delivery will not work until the provider/firewall block is removed." >&2
fi
