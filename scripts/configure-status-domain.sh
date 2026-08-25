#!/usr/bin/env bash
set -Eeuo pipefail
[ "$(id -u)" -eq 0 ] || { echo "[CrakHost] Status-domain setup requires root." >&2; exit 1; }
DIR="${CRAKHOST_DIR:-/opt/crakhost}"
cd "$DIR"
get_env(){ sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1; }
DOMAIN="${STATUS_DOMAIN:-$(get_env STATUS_DOMAIN)}"
DOMAIN="${DOMAIN:-uptime.crakbit.space}"
EMAIL="${ACME_EMAIL:-$(get_env ACME_EMAIL)}"
AUTO_TLS="${CRAKHOST_STATUS_AUTO_TLS:-$(get_env CRAKHOST_STATUS_AUTO_TLS)}"
AUTO_TLS="${AUTO_TLS:-true}"
SITE=/etc/nginx/sites-available/crakhost-status
ENABLED=/etc/nginx/sites-enabled/crakhost-status
CERT_DIR=/etc/letsencrypt/live/crakhost-status
FULLCHAIN="$CERT_DIR/fullchain.pem"
PRIVKEY="$CERT_DIR/privkey.pem"

if ! [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || [[ "$DOMAIN" != *.* ]]; then echo "[CrakHost] Invalid STATUS_DOMAIN: $DOMAIN" >&2; exit 1; fi
command -v nginx >/dev/null 2>&1 || { echo "[CrakHost] nginx not installed; status proxy skipped." >&2; exit 2; }

proxy_locations(){ cat <<'NGINX'
    location = / {
        proxy_pass http://127.0.0.1:4310/status;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location = /api/public/status {
        proxy_pass http://127.0.0.1:4310/api/public/status;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location ^~ /_next/ {
        proxy_pass http://127.0.0.1:4310;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        expires 1h;
    }
    location = /favicon.ico {
        proxy_pass http://127.0.0.1:4310/favicon.ico;
        proxy_set_header Host $host;
    }
    location / { return 404; }
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
NGINX
}

write_http(){
  {
    echo 'server {'
    echo '    listen 80;'
    echo '    listen [::]:80;'
    echo "    server_name $DOMAIN;"
    proxy_locations
    echo '}'
  } > "$SITE"
  ln -sf "$SITE" "$ENABLED"
  nginx -t
  systemctl reload nginx
}

write_https(){
  {
    echo 'server {'
    echo '    listen 80;'
    echo '    listen [::]:80;'
    echo "    server_name $DOMAIN;"
    echo '    location /.well-known/acme-challenge/ { root /var/www/html; }'
    echo '    location / { return 301 https://$host$request_uri; }'
    echo '}'
    echo 'server {'
    echo '    listen 443 ssl;'
    echo '    listen [::]:443 ssl;'
    echo "    server_name $DOMAIN;"
    echo "    ssl_certificate $FULLCHAIN;"
    echo "    ssl_certificate_key $PRIVKEY;"
    echo '    ssl_protocols TLSv1.2 TLSv1.3;'
    echo '    ssl_session_cache shared:CrakHostStatusSSL:10m;'
    proxy_locations
    echo '}'
  } > "$SITE"
  ln -sf "$SITE" "$ENABLED"
  nginx -t
  systemctl reload nginx
}

cert_matches(){
  [ -s "$FULLCHAIN" ] && [ -s "$PRIVKEY" ] && command -v openssl >/dev/null 2>&1 && openssl x509 -in "$FULLCHAIN" -noout -checkhost "$DOMAIN" 2>/dev/null | grep -q 'does match certificate'
}

# Always install the dedicated HTTP vhost first. This prevents the status
# hostname from falling through to the main CrakHost landing-page vhost and
# also gives ACME a deterministic HTTP server block to work with.
write_http
echo "[CrakHost] Isolated public status HTTP proxy ready for $DOMAIN."

if [ "$AUTO_TLS" != "true" ]; then
  echo "[CrakHost] Automatic status TLS is disabled."
  exit 0
fi

# If a valid dedicated certificate already exists, do not depend on Certbot's
# nginx rewriter: install an explicit 443 status vhost ourselves every deploy.
if cert_matches; then
  write_https
  echo "[CrakHost] Existing HTTPS certificate attached to dedicated status vhost: https://$DOMAIN"
  exit 0
fi

if ! getent ahostsv4 "$DOMAIN" >/dev/null 2>&1 && ! getent ahostsv6 "$DOMAIN" >/dev/null 2>&1; then
  echo "[CrakHost] DNS for $DOMAIN is not resolving on this VPS yet; HTTPS provisioning postponed." >&2
  exit 0
fi

# A host upgraded from an older CrakHost install may have HTTPS for the panel
# without the Certbot CLI/plugin. Install the small Ubuntu packages only when
# they are actually missing.
if ! command -v certbot >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "[CrakHost] Certbot is missing; installing certificate tooling..."
    DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx || true
  fi
fi

if ! command -v certbot >/dev/null 2>&1; then
  echo "[CrakHost] Certbot is unavailable; HTTP status page is active but HTTPS could not be provisioned." >&2
  exit 0
fi

CERTBOT_ARGS=(--nginx --non-interactive --agree-tos --keep-until-expiring -d "$DOMAIN" --cert-name crakhost-status)
if [ -n "$EMAIL" ]; then CERTBOT_ARGS+=(-m "$EMAIL"); else CERTBOT_ARGS+=(--register-unsafely-without-email); fi

echo "[CrakHost] Requesting/deploying dedicated certificate for $DOMAIN..."
if timeout 180 certbot "${CERTBOT_ARGS[@]}"; then
  # Certbot may rewrite the temporary HTTP file. Replace it once more with our
  # deterministic isolated 80/443 vhosts, using only the status certificate.
  if cert_matches; then
    write_https
    echo "[CrakHost] HTTPS status routing verified: https://$DOMAIN"
  else
    echo "[CrakHost] Certbot completed but the resulting certificate does not match $DOMAIN; keeping HTTP status routing only." >&2
  fi
else
  echo "[CrakHost] HTTPS provisioning failed; keeping the isolated HTTP status page active." >&2
fi
