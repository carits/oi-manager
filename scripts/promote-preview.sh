#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
CURRENT_DIR="$WEB_DIR/.next-current"
CANDIDATE_DIR="$WEB_DIR/.next-candidate"
PREVIOUS_DIR="$WEB_DIR/.next-previous"
CANARY_PID_FILE="$ROOT_DIR/.run/oi-web-canary.pid"
WEB_UNIT="oi-manager-web.service"
USE_SYSTEMD=false
CHAT_PROBE_ENV="$ROOT_DIR/.run/chat-probe.env"

if systemctl cat "$WEB_UNIT" >/dev/null 2>&1; then
  USE_SYSTEMD=true
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "The installed $WEB_UNIT must be promoted as root (use sudo)." >&2
    exit 1
  fi
fi

run_chat_probe() {
  local url="$1"
  local build_id="$2"
  if [[ "$USE_SYSTEMD" != "true" ]]; then
    return 0
  fi
  if [[ ! -f "$CHAT_PROBE_ENV" ]]; then
    echo "Production chat probe credentials are missing: $CHAT_PROBE_ENV" >&2
    return 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$CHAT_PROBE_ENV"
  set +a
  if [[ "${CHAT_PROBE_ENABLED:-false}" != "true" ]]; then
    echo "Production chat probe must be enabled before promotion." >&2
    return 1
  fi
  (
    cd "$ROOT_DIR"
    local runner="${SUDO_USER:-$(stat -c '%U' "$ROOT_DIR")}"
    local pnpm_bin
    pnpm_bin="$(command -v pnpm)"
    runuser -u "$runner" -- env \
      CHAT_PROBE_SENDER_USERNAME="$CHAT_PROBE_SENDER_USERNAME" \
      CHAT_PROBE_SENDER_PASSWORD="$CHAT_PROBE_SENDER_PASSWORD" \
      CHAT_PROBE_RECEIVER_USERNAME="$CHAT_PROBE_RECEIVER_USERNAME" \
      CHAT_PROBE_RECEIVER_PASSWORD="$CHAT_PROBE_RECEIVER_PASSWORD" \
      E2E_LIVE_BASE_URL="$url" E2E_LIVE_BUILD_ID="$build_id" \
      "$pnpm_bin" exec playwright test chat-probe.spec.ts --config=playwright.live.config.ts
  )
}

test -f "$CANDIDATE_DIR/BUILD_ID"

wait_for_preview() {
  local url="$1"
  local expected_build_id="${2:-}"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if PREVIEW_URL="$url" EXPECTED_BUILD_ID="$expected_build_id" node "$ROOT_DIR/scripts/preview-health.mjs"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

stop_published_preview() {
  if [[ "$USE_SYSTEMD" == "true" ]]; then
    systemctl stop "$WEB_UNIT"
  else
    "$ROOT_DIR/scripts/stop-preview.sh"
  fi
}

start_published_preview() {
  if [[ "$USE_SYSTEMD" == "true" ]]; then
    systemctl restart "$WEB_UNIT"
    systemctl is-active --quiet "$WEB_UNIT"
  else
    "$ROOT_DIR/scripts/start-preview.sh"
  fi
}

if [ -f "$CANARY_PID_FILE" ] && kill -0 "$(cat "$CANARY_PID_FILE")" 2>/dev/null; then
  echo "Reusing the running preview canary."
else
  "$ROOT_DIR/scripts/start-preview-canary.sh"
fi
cleanup_canary() {
  "$ROOT_DIR/scripts/stop-preview-canary.sh"
}
trap cleanup_canary EXIT
wait_for_preview http://127.0.0.1:3200/login "$(cat "$CANDIDATE_DIR/BUILD_ID")"
if [[ "$USE_SYSTEMD" == "true" ]]; then sleep 11; fi
run_chat_probe http://127.0.0.1:3200 "$(cat "$CANDIDATE_DIR/BUILD_ID")"
"$ROOT_DIR/scripts/stop-preview-canary.sh"
trap - EXIT

stop_published_preview

if [ -d "$PREVIOUS_DIR" ]; then
  previous_path="$(readlink -f "$PREVIOUS_DIR")"
  expected_path="$(readlink -f "$WEB_DIR")/.next-previous"
  if [ "$previous_path" != "$expected_path" ]; then
    echo "Refusing to remove unexpected previous path: $previous_path" >&2
    exit 1
  fi
  rm -rf -- "$previous_path"
fi
if [ -d "$CURRENT_DIR" ]; then
  mv "$CURRENT_DIR" "$PREVIOUS_DIR"
fi
mv "$CANDIDATE_DIR" "$CURRENT_DIR"

if ! start_published_preview ||
  ! wait_for_preview http://127.0.0.1:3000/login "$(cat "$CURRENT_DIR/BUILD_ID")" ||
  ! run_chat_probe http://127.0.0.1:3000 "$(cat "$CURRENT_DIR/BUILD_ID")"; then
  stop_published_preview || true
  current_path="$(readlink -f "$CURRENT_DIR")"
  expected_current_path="$(readlink -f "$WEB_DIR")/.next-current"
  if [ "$current_path" != "$expected_current_path" ]; then
    echo "Refusing to remove unexpected current path: $current_path" >&2
    exit 1
  fi
  rm -rf -- "$current_path"
  if [ -d "$PREVIOUS_DIR" ]; then
    mv "$PREVIOUS_DIR" "$CURRENT_DIR"
    start_published_preview
    wait_for_preview http://127.0.0.1:3000/login "$(cat "$CURRENT_DIR/BUILD_ID")"
  fi
  echo "Promotion failed and the previous preview was restored." >&2
  exit 1
fi

echo "Preview candidate promoted to port 3000."
