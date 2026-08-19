#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${OI_MANAGER_ROOT:-/data/oi-manager-response-refactor}"
UNIT_DIR="$ROOT_DIR/deploy/systemd"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (for example: sudo $0)." >&2
  exit 1
fi

for unit in oi-manager-server.service oi-manager-judge.service oi-manager-web.service; do
  test -f "$UNIT_DIR/$unit" || { echo "Missing unit: $UNIT_DIR/$unit" >&2; exit 1; }
  install -o root -g root -m 0644 "$UNIT_DIR/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable oi-manager-server.service oi-manager-judge.service oi-manager-web.service
systemctl restart oi-manager-server.service
systemctl restart oi-manager-judge.service
systemctl restart oi-manager-web.service

echo "Installed and restarted OI Manager systemd services."
systemctl --no-pager --full status oi-manager-server.service oi-manager-judge.service oi-manager-web.service
