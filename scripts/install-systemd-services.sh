#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${OI_MANAGER_ROOT:-/data/oi-manager-response-refactor}"
UNIT_DIR="$ROOT_DIR/deploy/systemd"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (for example: sudo $0)." >&2
  exit 1
fi

for unit in oi-manager-server.service oi-manager-server@.service oi-manager-api-router.service oi-manager-worker.service oi-manager-judge.service oi-manager-web.service; do
  test -f "$UNIT_DIR/$unit" || { echo "Missing unit: $UNIT_DIR/$unit" >&2; exit 1; }
  install -o root -g root -m 0644 "$UNIT_DIR/$unit" "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable oi-manager-api-router.service oi-manager-worker.service oi-manager-judge.service oi-manager-web.service

mkdir -p "$ROOT_DIR/.run"
ACTIVE_FILE="$ROOT_DIR/.run/api-active-upstream"
ACTIVE="$(cat "$ACTIVE_FILE" 2>/dev/null || true)"

if [[ "$ACTIVE" == "3302" || "$ACTIVE" == "3303" ]] && systemctl is-active --quiet oi-manager-api-router.service; then
  # Repeated installs must preserve the live slot. Restart the stable router so
  # its unit limits take effect, then let the normal blue/green promotion start
  # the opposite slot with the new template and drain the current one.
  systemctl restart oi-manager-api-router.service
  bash "$ROOT_DIR/scripts/promote-api.sh"
  ACTIVE="$(cat "$ACTIVE_FILE")"
else
  # First installation or repair from an invalid pointer starts the initial
  # blue slot before the stable router is exposed.
  ACTIVE=3302
  printf '%s\n' "$ACTIVE" > "$ACTIVE_FILE.next"
  chown ecs-user:ecs-user "$ACTIVE_FILE.next"
  mv -f "$ACTIVE_FILE.next" "$ACTIVE_FILE"
  systemctl restart "oi-manager-server@${ACTIVE}.service"
  systemctl enable "oi-manager-server@${ACTIVE}.service"
  for _ in {1..30}; do
    if curl --fail --silent "http://127.0.0.1:${ACTIVE}/api/readiness" >/dev/null; then break; fi
    sleep 1
  done
  curl --fail --silent "http://127.0.0.1:${ACTIVE}/api/readiness" >/dev/null
  systemctl restart oi-manager-api-router.service
  systemctl restart oi-manager-worker.service
fi

systemctl disable --now oi-manager-server.service 2>/dev/null || true
systemctl restart oi-manager-judge.service
systemctl restart oi-manager-web.service

echo "Installed OI Manager systemd services; active API slot: ${ACTIVE}."
systemctl --no-pager --full status oi-manager-api-router.service "oi-manager-server@${ACTIVE}.service" oi-manager-worker.service oi-manager-judge.service oi-manager-web.service
