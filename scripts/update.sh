#!/usr/bin/env bash
set -euo pipefail
cd "${CRAKHOST_DIR:-/opt/crakhost}"; git fetch --tags origin
LATEST="$(git tag --sort=-v:refname|head -n1)"; CURRENT="$(git describe --tags --always 2>/dev/null||true)"
echo "Current=$CURRENT Latest=$LATEST"; [ -n "$LATEST" ]||exit 2; [ "$CURRENT" = "$LATEST" ]&&exit 0
mkdir -p /opt/crakhost-backups
docker compose exec -T postgres pg_dump -U crakhost crakhost|gzip>"/opt/crakhost-backups/pre-${LATEST}-$(date +%s).sql.gz"
git checkout -f "$LATEST"
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
for f in database/migrations/v*.sql;do cat "$f"|docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U crakhost -d crakhost >/dev/null;done
echo "Updated to $LATEST"
