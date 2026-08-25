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
if ! [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || [[ "$DOMAIN" != *.* ]]; then echo "[CrakHost] Invalid STATUS_DOMAIN: $DOMAIN" >&2; exit 1; fi
command -v nginx >/dev/null 2>&1 || { echo "[CrakHost] nginx not installed; status proxy skipped." >&2; exit 2; }
cat > /etc/nginx/sites-available/crakhost-status <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # The status hostname is intentionally isolated from the authenticated
    # control panel. Only the public status document, its public JSON feed and
    # Next.js static assets are reachable through this virtual host.
    location = / {
        proxy_pass http://127.0.0.1:4310/status;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /api/public/status {
        proxy_pass http://127.0.0.1:4310/api/public/status;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /_next/ {
        proxy_pass http://127.0.0.1:4310;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        expires 1h;
    }

    location = /favicon.ico {
        proxy_pass http://127.0.0.1:4310/favicon.ico;
        proxy_set_header Host \$host;
    }

    location / {
        return 404;
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
}
NGINX
ln -sf /etc/nginx/sites-available/crakhost-status /etc/nginx/sites-enabled/crakhost-status
if ! nginx -t; then echo "[CrakHost] Status nginx configuration failed validation." >&2; exit 1; fi
systemctl reload nginx

echo "[CrakHost] Isolated public status HTTP proxy ready for $DOMAIN."
if [ "$AUTO_TLS" = "true" ] && command -v certbot >/dev/null 2>&1 && [ -n "$EMAIL" ]; then
  if getent ahostsv4 "$DOMAIN" >/dev/null 2>&1; then
    # Always ask Certbot to deploy the certificate into the freshly generated
    # status vhost. Previously we skipped this step when a certificate already
    # existed, which could leave HTTPS on the panel/default vhost after an
    # nginx config refresh. --keep-until-expiring avoids unnecessary renewal.
    echo "[CrakHost] Installing/refreshing HTTPS configuration for $DOMAIN..."
    if timeout 120 certbot --nginx --non-interactive --agree-tos --redirect --keep-until-expiring -m "$EMAIL" -d "$DOMAIN" --cert-name crakhost-status; then
      echo "[CrakHost] HTTPS ready for https://$DOMAIN"
    else
      echo "[CrakHost] HTTPS deployment did not complete. DNS/certificate state may still be propagating; HTTP proxy remains configured." >&2
    fi
  else
    echo "[CrakHost] DNS for $DOMAIN is not resolving yet. Add the A record, then re-apply the latest release to request HTTPS." >&2
  fi
fi
