#!/usr/bin/env bash
set -euo pipefail
DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then echo "Usage: bash scripts/mail/show-dns.sh example.com"; exit 2; fi
DOMAIN="${DOMAIN,,}"
HOST="mail.$DOMAIN"
PUBLIC_IP="$(curl -4fsS --max-time 8 https://api.ipify.org 2>/dev/null || echo YOUR_VPS_IP)"
DKIM_FILE="docker-data/dms/config/opendkim/keys/$DOMAIN/mail.txt"

echo "CrakMail DNS records for $DOMAIN"
echo "================================"
echo "A      $HOST                 $PUBLIC_IP"
echo "MX     $DOMAIN               10 $HOST"
echo "TXT    $DOMAIN               v=spf1 mx a ip4:$PUBLIC_IP -all"
echo "TXT    _dmarc.$DOMAIN        v=DMARC1; p=quarantine; adkim=s; aspf=s; rua=mailto:postmaster@$DOMAIN"
echo "PTR    $PUBLIC_IP            $HOST   (OVHcloud Manager, not normal DNS)"
echo
if [[ -f "$DKIM_FILE" ]]; then
  echo "DKIM record (publish exactly as TXT):"
  cat "$DKIM_FILE"
else
  echo "DKIM key not found yet at $DKIM_FILE"
  echo "Create a mailbox then run: docker exec crakhost-mailserver setup config dkim domain '$DOMAIN'"
fi
