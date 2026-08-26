#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${OI_MANAGER_ROOT:-/data/oi-manager-response-refactor}"
UNIT_DIR="$ROOT_DIR/deploy/systemd"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (for example: sudo $0)." >&2
  exit 1
fi

for unit in oi-manager-server.service oi-manager-server@.service oi-manager-api-router.service oi-manager-judge.service oi-manager-web.service; do
  test -f "$UNIT_DIR/$unit" || { echo "Missing unit: $UNIT_DIR/$unit" >&2; exit 1; }
  install -o root -g root -m 0644 "$UNIT_DIR/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable oi-manager-api-router.service oi-manager-judge.service oi-manager-web.service

# One-time transition from the legacy API bound directly to 3002. Start the
# blue backend first, then replace the public listener with the stable router.
mkdir -p "$ROOT_DIR/.run"
printf '3302\n' > "$ROOT_DIR/.run/api-active-upstream"
chown ecs-user:ecs-user "$ROOT_DIR/.run/api-active-upstream"
systemctl restart oi-manager-server@3302.service
systemctl enable oi-manager-server@3302.service
for _ in {1..30}; do
  if curl --fail --silent http://127.0.0.1:3302/api/readiness >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:3302/api/readiness >/dev/null
systemctl disable --now oi-manager-server.service 2>/dev/null || true
systemctl restart oi-manager-api-router.service
systemctl restart oi-manager-judge.service
systemctl restart oi-manager-web.service

echo "Installed and restarted OI Manager systemd services."
systemctl --no-pager --full status oi-manager-api-router.service oi-manager-server@3302.service oi-manager-judge.service oi-manager-web.service
