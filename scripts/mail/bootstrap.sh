#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" || ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "Usage: sudo bash scripts/mail/bootstrap.sh example.com"
  exit 2
fi
DOMAIN="${DOMAIN,,}"
HOSTNAME="mail.${DOMAIN}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

need(){ command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1"; exit 1; }; }
need docker
need curl

PUBLIC_IP="$(curl -4fsS --max-time 8 https://api.ipify.org)"
RESOLVED_IP="$(getent ahostsv4 "$HOSTNAME" 2>/dev/null | awk 'NR==1{print $1}')"

echo "CrakMail bootstrap"
echo "=================="
echo "Domain      : $DOMAIN"
echo "Mail host   : $HOSTNAME"
echo "Public IPv4 : $PUBLIC_IP"
echo "DNS A       : ${RESOLVED_IP:-not resolved}"
echo

if [[ "$RESOLVED_IP" != "$PUBLIC_IP" ]]; then
  cat <<EOF
DNS is not ready yet.
Create this record first and wait until it resolves:
  A  $HOSTNAME  ->  $PUBLIC_IP

Then run this command again.
EOF
  exit 3
fi

mkdir -p docker-data/dms/config
cat > .env.mail <<EOF
CRAKMAIL_DOMAIN=$DOMAIN
CRAKMAIL_HOSTNAME=$HOSTNAME
EOF

cat > mailserver.env <<EOF
OVERRIDE_HOSTNAME=$HOSTNAME
POSTMASTER_ADDRESS=postmaster@$DOMAIN
REPORT_RECIPIENT=postmaster@$DOMAIN
ENABLE_AMAVIS=0
ENABLE_CLAMAV=0
ENABLE_SPAMASSASSIN=0
ENABLE_RSPAMD=0
ENABLE_FAIL2BAN=0
ENABLE_SASLAUTHD=0
ENABLE_POP3=0
ENABLE_IMAP=1
SMTP_ONLY=0
ENABLE_OPENDKIM=1
ENABLE_OPENDMARC=1
ENABLE_POLICYD_SPF=1
SSL_TYPE=letsencrypt
TLS_LEVEL=modern
ACCOUNT_PROVISIONER=FILE
SPOOF_PROTECTION=1
POSTFIX_MESSAGE_SIZE_LIMIT=52428800
DOVECOT_MAILBOX_FORMAT=maildir
DOVECOT_INET_PROTOCOLS=ipv4
POSTFIX_INET_PROTOCOLS=ipv4
PERMIT_DOCKER=none
EOF

if [[ ! -f "/etc/letsencrypt/live/$HOSTNAME/fullchain.pem" ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    echo "Installing certbot nginx plugin..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
  fi
  echo "Issuing TLS certificate for $HOSTNAME ..."
  certbot certonly --nginx -d "$HOSTNAME" --non-interactive --agree-tos --register-unsafely-without-email
fi

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
cat > "/etc/nginx/sites-available/crakmail-$DOMAIN" <<EOF
server {
    listen 80;
    server_name $HOSTNAME;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name $HOSTNAME;
    ssl_certificate /etc/letsencrypt/live/$HOSTNAME/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$HOSTNAME/privkey.pem;
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

echo "Starting mail services..."
docker compose --env-file .env.mail -f docker-compose.mail.yml up -d

sleep 15
CREDS_FILE="$ROOT_DIR/.crakmail-credentials"
if [[ ! -f "$CREDS_FILE" ]]; then
  umask 077
  : > "$CREDS_FILE"
  for LOCAL in postmaster support billing noreply; do
    PASS="$(openssl rand -base64 24 | tr -d '\n' | tr '/+' 'AZ')"
    EMAIL="$LOCAL@$DOMAIN"
    docker exec crakhost-mailserver setup email add "$EMAIL" "$PASS"
    printf '%s=%s\n' "$EMAIL" "$PASS" >> "$CREDS_FILE"
  done
  chmod 600 "$CREDS_FILE"
fi

echo "Generating DKIM keys..."
docker exec crakhost-mailserver setup config dkim domain "$DOMAIN" || docker exec crakhost-mailserver setup config dkim

docker restart crakhost-mailserver >/dev/null

echo
cat <<EOF
CrakMail is installed.
Webmail: https://$HOSTNAME
Credentials file: $CREDS_FILE (root-only; move/delete after storing securely)

Now publish MX/SPF/DKIM/DMARC and configure PTR:
  MX  $DOMAIN -> $HOSTNAME priority 10
  SPF $DOMAIN -> v=spf1 mx a ip4:$PUBLIC_IP -all
  PTR $PUBLIC_IP -> $HOSTNAME   (set this in OVHcloud Manager)

Run:
  bash scripts/mail/show-dns.sh $DOMAIN
  bash scripts/mail/check-port25.sh
EOF
