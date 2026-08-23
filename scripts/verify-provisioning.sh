#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if docker info >/dev/null 2>&1; then
  D="docker"
else
  D="sudo docker"
fi

compose(){ $D compose -f docker-compose.yml -f docker-compose.production.yml "$@"; }

printf '\n[CrakHost] Stack status\n'
compose ps

printf '\n[CrakHost] CrakNode diagnostics\n'
compose exec -T craknode sh -c 'wget -qO- --header="Authorization: Bearer $CRAKNODE_TOKEN" http://127.0.0.1:8088/diagnostics'
printf '\n'

printf '\n[CrakHost] Database node capacity\n'
compose exec -T postgres psql -U crakhost -d crakhost -c "select name,enabled,capacity_cpu,capacity_memory_mb,capacity_disk_mb,last_seen_at,agent_version from nodes order by created_at;"

printf '\n[CrakHost] Active server reservations\n'
compose exec -T postgres psql -U crakhost -d crakhost -c "select s.identifier,s.name,s.status,n.name node,s.cpu_limit,s.memory_mb,s.disk_mb,s.primary_port from servers s left join nodes n on n.id=s.node_id where s.status<>'deleted' order by s.created_at desc;"

ID="${1:-}"
if [ -z "$ID" ]; then
  printf '\nPass a server identifier to verify one runtime, for example:\n  sh scripts/verify-provisioning.sh srv-1234abcd\n'
  exit 0
fi

case "$ID" in
  *[!A-Za-z0-9._-]*|'') echo "Invalid server identifier" >&2; exit 2;;
esac

printf '\n[CrakHost] Runtime status for %s\n' "$ID"
compose exec -T craknode sh -c "wget -qO- --header=\"Authorization: Bearer \$CRAKNODE_TOKEN\" http://127.0.0.1:8088/v1/servers/$ID/status"
printf '\n'

printf '\n[CrakHost] Managed Docker container\n'
$D ps -a --filter "label=crakhost.server=$ID" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}'

printf '\n[CrakHost] Recent lifecycle events\n'
compose exec -T postgres psql -U crakhost -d crakhost -c "select e.type,e.detail,e.created_at from service_events e join servers s on s.id=e.server_id where s.identifier='$ID' order by e.created_at desc limit 20;"

printf '\n[CrakHost] Allocation\n'
compose exec -T postgres psql -U crakhost -d crakhost -c "select a.ip,a.port,n.name node from allocations a join servers s on s.id=a.server_id left join nodes n on n.id=a.node_id where s.identifier='$ID';"
