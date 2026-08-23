#!/usr/bin/env bash
set -Eeuo pipefail

DB_HOST="${CRAKMAIL_DB_HOST:-postgres}"
DB_PORT="${CRAKMAIL_DB_PORT:-5432}"
DB_NAME="${CRAKMAIL_DB_NAME:-crakhost}"
DB_USER="${CRAKMAIL_DB_USER:-crakhost}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
export PGPASSWORD="$POSTGRES_PASSWORD"
STATE=/var/lib/crakmail
mkdir -p "$STATE/dkim"

sync_domains(){
  local rows keytmp sigtmp changed=0
  rows="$(psql -At -F '|' -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "select domain,dkim_selector from mail_domains where enabled=true order by domain" 2>/dev/null || true)"
  keytmp="$(mktemp "$STATE/KeyTable.XXXXXX")"
  sigtmp="$(mktemp "$STATE/SigningTable.XXXXXX")"
  trap 'rm -f "$keytmp" "$sigtmp"' RETURN

  while IFS='|' read -r domain selector; do
    [[ -n "$domain" ]] || continue
    if [[ ! "$domain" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
      echo "CrakMail DKIM: skipping invalid domain from database: $domain" >&2
      continue
    fi
    if [[ ! "$selector" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]]; then selector=mail; fi
    dir="$STATE/dkim/$domain"
    private="$dir/$selector.private"
    public="$dir/$selector.txt"
    mkdir -p "$dir"
    if [[ ! -s "$private" || ! -s "$public" ]]; then
      rm -f "$dir"/*.private "$dir"/*.txt
      echo "CrakMail DKIM: generating 2048-bit key for $selector._domainkey.$domain"
      opendkim-genkey -b 2048 -D "$dir" -d "$domain" -s "$selector"
      chmod 0600 "$private"
      changed=1
    fi
    chown -R opendkim:opendkim "$dir"
    # OpenDKIM writes a BIND-style TXT record split across quoted lines. Concatenate only quoted payload segments.
    awk -F'"' '{for(i=2;i<=NF;i+=2) printf "%s",$i} END{print ""}' "$public" >"$STATE/dkim/$domain.txt"
    chown opendkim:opendkim "$STATE/dkim/$domain.txt"
    chmod 0644 "$STATE/dkim/$domain.txt"
    printf '%s._domainkey.%s %s:%s:%s\n' "$selector" "$domain" "$domain" "$selector" "$private" >>"$keytmp"
    printf '*@%s %s._domainkey.%s\n' "$domain" "$selector" "$domain" >>"$sigtmp"
  done <<<"$rows"

  if ! cmp -s "$keytmp" "$STATE/KeyTable" 2>/dev/null; then changed=1; fi
  if ! cmp -s "$sigtmp" "$STATE/SigningTable" 2>/dev/null; then changed=1; fi
  mv "$keytmp" "$STATE/KeyTable"
  mv "$sigtmp" "$STATE/SigningTable"
  chown opendkim:opendkim "$STATE/KeyTable" "$STATE/SigningTable"
  chmod 0640 "$STATE/KeyTable" "$STATE/SigningTable"
  trap - RETURN

  if [[ "$changed" = 1 ]] && pgrep -x opendkim >/dev/null 2>&1; then
    echo "CrakMail DKIM: signing maps changed; reloading OpenDKIM"
    pkill -HUP -x opendkim || true
  fi
}

if [[ "${CRAKMAIL_SYNC_ONCE:-0}" = 1 ]]; then
  sync_domains
  exit 0
fi

INTERVAL="${CRAKMAIL_DKIM_SYNC_SECONDS:-30}"
while true; do
  sync_domains || echo "CrakMail DKIM: sync failed; retrying" >&2
  sleep "$INTERVAL"
done
