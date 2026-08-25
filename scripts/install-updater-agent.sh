#!/usr/bin/env bash
set -Eeuo pipefail

[ "$(id -u)" -eq 0 ] || { echo "[CrakHost] Updater agent installer requires root." >&2; exit 1; }

DIR="${CRAKHOST_DIR:-/opt/crakhost}"
SOURCE="${CRAKHOST_UPDATE_SOURCE:-terminal}"
SERVICE="crakhost-updater.service"
SOCKET_DIR="/run/crakhost-updater"
UPDATER_GROUP="crakhost-updater"

[ -f "$DIR/services/updater/server.py" ] || { echo "[CrakHost] Missing updater agent source." >&2; exit 1; }
[ -f "$DIR/.env" ] || { echo "[CrakHost] Missing $DIR/.env." >&2; exit 1; }

DEPLOY_TOKEN="$(sed -n 's/^CRAKHOST_DEPLOY_TOKEN=//p' "$DIR/.env" | tail -n 1)"
if [ "${#DEPLOY_TOKEN}" -lt 32 ] || [[ "$DEPLOY_TOKEN" == replace-with-* ]]; then
  echo "[CrakHost] CRAKHOST_DEPLOY_TOKEN is missing or unsafe." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  apt-get update
  apt-get install -y python3
fi

if ! getent group "$UPDATER_GROUP" >/dev/null 2>&1; then
  groupadd --system "$UPDATER_GROUP"
fi
UPDATER_GID="$(getent group "$UPDATER_GROUP" | cut -d: -f3)"
[ -n "$UPDATER_GID" ] || { echo "[CrakHost] Unable to resolve updater group GID." >&2; exit 1; }

# Persist the numeric GID for Docker Compose group_add. The container does not
# need a matching group name; Linux checks Unix-socket access by numeric GID.
TMP_ENV="$(mktemp)"
awk -v gid="$UPDATER_GID" '
  BEGIN{done=0}
  /^CRAKHOST_UPDATER_GID=/{print "CRAKHOST_UPDATER_GID=" gid;done=1;next}
  {print}
  END{if(!done)print "CRAKHOST_UPDATER_GID=" gid}
' "$DIR/.env" > "$TMP_ENV"
mv "$TMP_ENV" "$DIR/.env"
chmod 600 "$DIR/.env"

mkdir -p "$SOCKET_DIR" /var/lib/crakhost-updater /var/log/crakhost /etc/crakhost
chown root:"$UPDATER_GROUP" "$SOCKET_DIR"
chmod 750 "$SOCKET_DIR"
chmod 755 /var/lib/crakhost-updater /var/log/crakhost
touch /var/log/crakhost/updater.log
chmod 640 /var/log/crakhost/updater.log
printf 'CRAKHOST_DEPLOY_TOKEN=%s\nCRAKHOST_UPDATER_GID=%s\n' "$DEPLOY_TOKEN" "$UPDATER_GID" > /etc/crakhost/updater.env
chmod 600 /etc/crakhost/updater.env

cat > "/etc/systemd/system/$SERVICE" <<UNIT
[Unit]
Description=CrakHost privileged update agent
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=root
Group=$UPDATER_GROUP
WorkingDirectory=$DIR
EnvironmentFile=/etc/crakhost/updater.env
Environment=CRAKHOST_DIR=$DIR
ExecStart=/usr/bin/python3 $DIR/services/updater/server.py
Restart=always
RestartSec=2
TimeoutStopSec=10
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null

# A panel-triggered update is launched by the running agent itself. Restarting
# it mid-job would terminate the update, so only refresh the unit on disk.
if [ "$SOURCE" = "panel" ] && systemctl is-active --quiet "$SERVICE"; then
  echo "[CrakHost] Updater agent unit refreshed; active panel job keeps the current process."
else
  systemctl restart "$SERVICE"
fi

READY=0
for _ in $(seq 1 40); do
  if [ -S "$SOCKET_DIR/updater.sock" ]; then READY=1; break; fi
  sleep 0.25
done

if [ "$READY" -ne 1 ]; then
  echo "[CrakHost] Updater agent socket did not become ready." >&2
  systemctl status "$SERVICE" --no-pager -l || true
  exit 1
fi

# The service primary group owns newly-created sockets. Keep the intended mode
# explicit for upgraded hosts whose currently running pre-v0.55.1 agent may
# have created the socket as root:root before this installer was applied.
chown root:"$UPDATER_GROUP" "$SOCKET_DIR/updater.sock"
chmod 660 "$SOCKET_DIR/updater.sock"

echo "[CrakHost] In-panel updater agent ready: $SOCKET_DIR/updater.sock (gid $UPDATER_GID)"
