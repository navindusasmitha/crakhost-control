#!/usr/bin/env bash
set -uo pipefail

TARGET="${1:-gmail-smtp-in.l.google.com}"
PORT="${2:-25}"
PUBLIC_IP="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"

echo "CrakMail SMTP preflight"
echo "======================="
echo "Public IPv4 : ${PUBLIC_IP:-unknown}"
echo "Remote test : ${TARGET}:${PORT}"
echo

if timeout 8 bash -c "</dev/tcp/${TARGET}/${PORT}" 2>/dev/null; then
  echo "OUTBOUND PORT 25: OPEN"
  OUT=0
else
  echo "OUTBOUND PORT 25: BLOCKED OR FILTERED"
  OUT=1
fi

if command -v dig >/dev/null 2>&1 && [ -n "${PUBLIC_IP}" ]; then
  PTR="$(dig +short -x "$PUBLIC_IP" | sed 's/\.$//' | head -n1)"
  echo "PTR / reverse DNS: ${PTR:-NOT SET}"
else
  echo "PTR / reverse DNS: install dnsutils to check locally"
fi

echo
if [ "$OUT" -ne 0 ]; then
  cat <<'EOF'
OVHcloud VPS commonly blocks outbound TCP/25 by default.
Open OVHcloud Manager -> your VPS -> Support / SMTP or create a support request
asking for outbound SMTP TCP/25 to be enabled for a legitimate self-hosted mail server.

Submission from users/apps should still use 587 STARTTLS or 465 TLS. Port 25 is
needed for server-to-server delivery to internet MX hosts.
EOF
fi

exit "$OUT"
