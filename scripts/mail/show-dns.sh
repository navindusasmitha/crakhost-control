#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" || ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "Usage: sudo bash scripts/mail/show-dns.sh example.com"
  exit 2
fi
DOMAIN="${DOMAIN,,}"
MAIL_HOST="mail.$DOMAIN"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PUBLIC_IP="$(curl -4fsS --max-time 8 https://api.ipify.org 2>/dev/null || echo YOUR_VPS_IP)"
DKIM_VALUE=""

if [[ -f .env && -f .env.mail ]]; then
  COMPOSE=(docker compose \
    --env-file .env \
    --env-file .env.mail \
    -f docker-compose.yml \
    -f docker-compose.production.yml \
    -f docker-compose.mail.yml)
  DKIM_VALUE="$("${COMPOSE[@]}" exec -T crakmail sh -lc "cat '/var/lib/crakmail/dkim/${DOMAIN}.txt' 2>/dev/null" 2>/dev/null || true)"
fi

echo "CrakMail DNS records for $DOMAIN"
echo "================================"
echo "A      $MAIL_HOST                 $PUBLIC_IP"
echo "MX     $DOMAIN                    10 $MAIL_HOST."
echo "TXT    $DOMAIN                    v=spf1 mx a:$MAIL_HOST ip4:$PUBLIC_IP -all"
echo "TXT    _dmarc.$DOMAIN             v=DMARC1; p=none; adkim=s; aspf=s; rua=mailto:postmaster@$DOMAIN"
echo "PTR    $PUBLIC_IP                 $MAIL_HOST   (OVHcloud Manager, not normal DNS)"
echo

if [[ -n "$DKIM_VALUE" ]]; then
  echo "DKIM TXT record:"
  echo "Name : mail._domainkey.$DOMAIN"
  echo "Value: $DKIM_VALUE"
else
  echo "DKIM key is not available yet."
  echo "After the domain exists in Admin -> Mail Hosting, wait about 30 seconds and run this command again."
  if [[ -f .env && -f .env.mail ]]; then
    echo "To force a one-time sync:"
    echo "  sudo docker compose --env-file .env --env-file .env.mail -f docker-compose.yml -f docker-compose.production.yml -f docker-compose.mail.yml exec -T crakmail env CRAKMAIL_SYNC_ONCE=1 /usr/local/bin/crakmail-sync-dkim"
  fi
fi
