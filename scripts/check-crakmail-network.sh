#!/usr/bin/env bash
set -u

TARGET="${CRAKMAIL_PORT25_PROBE_HOST:-gmail-smtp-in.l.google.com}"
MAIL_HOSTNAME="${MAIL_HOSTNAME:-}"
MAIL_PUBLIC_IP="${MAIL_PUBLIC_IP:-}"

printf '\nCrakMail network preflight\n===========================\n'
printf 'Outbound SMTP target: %s:25\n\n' "$TARGET"

if command -v ss >/dev/null 2>&1; then
  echo '[Local listeners]'
  ss -lntp 2>/dev/null | awk 'NR==1 || $4 ~ /:(25|465|587|993)$/' || true
  echo
fi

if command -v ufw >/dev/null 2>&1; then
  echo '[UFW]'
  sudo ufw status 2>/dev/null || ufw status 2>/dev/null || true
  echo
fi

echo '[Outbound TCP/25]'
TMP="$(mktemp)"
if timeout 8 bash -c "exec 3<>/dev/tcp/${TARGET}/25; IFS= read -r line <&3; printf '%s\\n' \"\$line\"" >"$TMP" 2>&1; then
  echo "PASS: outbound port 25 is reachable."
  sed -n '1p' "$TMP"
  OUTBOUND=0
else
  echo "FAIL: could not open an outbound TCP/25 connection to ${TARGET}."
  echo "This is usually a provider anti-spam block, cloud firewall rule, or host firewall rule."
  sed -n '1,3p' "$TMP"
  OUTBOUND=1
fi
rm -f "$TMP"

echo
if [[ -n "$MAIL_HOSTNAME" ]]; then
  echo '[Mail hostname DNS]'
  getent ahostsv4 "$MAIL_HOSTNAME" 2>/dev/null | awk 'NR<=3{print}' || echo "No A record resolved for $MAIL_HOSTNAME"
  echo
fi
if [[ -n "$MAIL_PUBLIC_IP" ]]; then
  echo '[Reverse DNS / PTR]'
  getent hosts "$MAIL_PUBLIC_IP" 2>/dev/null || echo "No PTR answer found for $MAIL_PUBLIC_IP"
  echo
fi

echo '[Required public ports]'
echo '25/tcp  SMTP server-to-server inbound/outbound'
echo '465/tcp SMTP implicit TLS (client submission)'
echo '587/tcp SMTP STARTTLS (client submission)'
echo '993/tcp IMAPS'
echo
echo 'If UFW is active, allow only the required mail ports:'
echo '  sudo ufw allow 25/tcp'
echo '  sudo ufw allow 465/tcp'
echo '  sudo ufw allow 587/tcp'
echo '  sudo ufw allow 993/tcp'
echo
if [[ "$OUTBOUND" = 1 ]]; then
  echo 'Provider action is required if the host firewall is not the cause.'
  echo 'For OVHcloud: Network -> Public IP Addresses -> find the VPS IP -> IP Alert.'
  echo 'If it is blocked for spam, use the three-dot menu -> Anti-spam unblocking after confirming the server is clean.'
fi

exit "$OUTBOUND"
