#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" || ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "Usage: sudo bash scripts/mail/bootstrap.sh example.com"
  exit 2
fi
DOMAIN="${DOMAIN,,}"
MAIL_HOST="mail.${DOMAIN}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

need(){ command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }; }
need docker
need curl
need openssl
need nginx

if [[ ! -f .env ]]; then
  echo "Missing $ROOT_DIR/.env. CrakMail must reuse the production PostgreSQL credentials from the main CrakHost stack." >&2
  exit 1
fi
if ! grep -Eq '^POSTGRES_PASSWORD=.+$' .env; then
  echo "POSTGRES_PASSWORD is missing from $ROOT_DIR/.env" >&2
  exit 1
fi

PUBLIC_IP="$(curl -4fsS --max-time 8 https://api.ipify.org)"
RESOLVED_IP="$(getent ahostsv4 "$MAIL_HOST" 2>/dev/null | awk 'NR==1{print $1}')"

echo "CrakMail bootstrap"
echo "=================="
echo "Domain      : $DOMAIN"
echo "Mail host   : $MAIL_HOST"
echo "Public IPv4 : $PUBLIC_IP"
echo "DNS A       : ${RESOLVED_IP:-not resolved}"
echo

if [[ "$RESOLVED_IP" != "$PUBLIC_IP" ]]; then
  cat <<EOF
DNS is not ready yet.
Create this record first and wait until it resolves:
  A  $MAIL_HOST  ->  $PUBLIC_IP

Then run this command again.
EOF
  exit 3
fi

umask 077
cat > .env.mail <<EOF
MAIL_DOMAIN=$DOMAIN
MAIL_HOSTNAME=$MAIL_HOST
MAIL_PUBLIC_IP=$PUBLIC_IP
CRAKMAIL_DKIM_SELECTOR=mail
CRAKMAIL_DKIM_SYNC_SECONDS=30
EOF
chmod 600 .env.mail

if [[ ! -f "/etc/letsencrypt/live/$MAIL_HOST/fullchain.pem" ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    echo "Installing certbot nginx plugin..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
  fi
  echo "Issuing TLS certificate for $MAIL_HOST ..."
  certbot certonly --nginx -d "$MAIL_HOST" --non-interactive --agree-tos --register-unsafely-without-email
fi

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
cat > "/etc/nginx/sites-available/crakmail-$DOMAIN" <<EOF
server {
    listen 80;
    server_name $MAIL_HOST;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl;
    http2 on;
    server_name $MAIL_HOST;
    ssl_certificate /etc/letsencrypt/live/$MAIL_HOST/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$MAIL_HOST/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:8888;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
EOF
ln -sfn "/etc/nginx/sites-available/crakmail-$DOMAIN" "/etc/nginx/sites-enabled/crakmail-$DOMAIN"
nginx -t
systemctl reload nginx

COMPOSE=(docker compose \
  --env-file .env \
  --env-file .env.mail \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  -f docker-compose.mail.yml)

echo "Validating Compose configuration..."
"${COMPOSE[@]}" config -q

echo "Starting CrakMail + Roundcube..."
"${COMPOSE[@]}" up -d --build crakmail roundcube panel

CID="$("${COMPOSE[@]}" ps -q crakmail)"
if [[ -z "$CID" ]]; then
  echo "CrakMail container was not created." >&2
  "${COMPOSE[@]}" ps
  exit 1
fi

echo "Waiting for CrakMail health..."
for i in $(seq 1 36); do
  STATUS="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CID" 2>/dev/null || echo unknown)"
  if [[ "$STATUS" == "healthy" ]]; then
    break
  fi
  if [[ "$STATUS" == "exited" || "$STATUS" == "dead" || "$STATUS" == "unhealthy" ]]; then
    echo "CrakMail failed with status: $STATUS" >&2
    "${COMPOSE[@]}" logs --tail=160 crakmail
    exit 1
  fi
  if [[ "$i" == 36 ]]; then
    echo "CrakMail did not become healthy within 180 seconds (last status: $STATUS)." >&2
    "${COMPOSE[@]}" logs --tail=160 crakmail
    exit 1
  fi
  sleep 5
done

"${COMPOSE[@]}" ps crakmail roundcube panel

echo
cat <<EOF
CrakMail core is running.
Webmail: https://$MAIL_HOST

Create mailboxes from CrakHost -> Admin -> Mail Hosting.
Recommended first mailboxes: postmaster@$DOMAIN, support@$DOMAIN, billing@$DOMAIN, noreply@$DOMAIN

Now publish MX/SPF/DKIM/DMARC and configure PTR:
  MX  $DOMAIN -> $MAIL_HOST priority 10
  SPF $DOMAIN -> v=spf1 mx a ip4:$PUBLIC_IP -all
  PTR $PUBLIC_IP -> $MAIL_HOST   (set this in OVHcloud Manager)

Run:
  sudo bash scripts/mail/show-dns.sh $DOMAIN
  bash scripts/mail/check-port25.sh
EOF
