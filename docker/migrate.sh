#!/bin/sh
set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
DB_URL="postgresql://crakhost:${POSTGRES_PASSWORD}@postgres:5432/crakhost"

echo "[CrakHost] Waiting for PostgreSQL..."
for i in $(seq 1 60); do
  if pg_isready -h postgres -U crakhost -d crakhost >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "[CrakHost] PostgreSQL did not become ready" >&2
    exit 1
  fi
  sleep 2
done

echo "[CrakHost] Applying migrations in version order..."
for f in $(find /migrations -maxdepth 1 -type f -name 'v*.sql' | sort -V); do
  echo "  -> $(basename "$f")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done

echo "[CrakHost] Database migrations complete."
