#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${OI_MANAGER_ROOT:-/data/oi-manager-response-refactor}"
ACTIVE_FILE="$ROOT_DIR/.run/api-active-upstream"
CURRENT="$(cat "$ACTIVE_FILE" 2>/dev/null || echo 3302)"
if [[ "$CURRENT" == "3302" ]]; then CANDIDATE=3303; else CANDIDATE=3302; fi

systemctl restart "oi-manager-server@${CANDIDATE}.service"
for _ in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:${CANDIDATE}/api/readiness" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "http://127.0.0.1:${CANDIDATE}/api/readiness" >/dev/null
systemctl enable "oi-manager-server@${CANDIDATE}.service"

mkdir -p "$ROOT_DIR/.run"
printf '%s\n' "$CANDIDATE" > "$ACTIVE_FILE.next"
mv -f "$ACTIVE_FILE.next" "$ACTIVE_FILE"

if systemctl is-active --quiet "oi-manager-server@${CURRENT}.service"; then
  systemctl kill --signal=SIGUSR2 "oi-manager-server@${CURRENT}.service"
  for _ in {1..45}; do
    systemctl is-active --quiet "oi-manager-server@${CURRENT}.service" || break
    sleep 1
  done
  if systemctl is-active --quiet "oi-manager-server@${CURRENT}.service"; then
    systemctl stop "oi-manager-server@${CURRENT}.service"
  fi
fi
systemctl disable "oi-manager-server@${CURRENT}.service" 2>/dev/null || true

# Background jobs are deliberately singleton and never run inside blue/green
# API slots. Restart the worker only after the HTTP upstream has been promoted.
if systemctl cat oi-manager-worker.service >/dev/null 2>&1; then
  systemctl restart oi-manager-worker.service
  systemctl is-active --quiet oi-manager-worker.service
fi
if systemctl cat oi-manager-executor@.service >/dev/null 2>&1; then
  systemctl restart oi-manager-executor@1.service
  systemctl is-active --quiet oi-manager-executor@1.service
fi

curl --fail --silent http://127.0.0.1:3002/api/readiness >/dev/null
echo "API promoted: ${CURRENT} -> ${CANDIDATE}"
