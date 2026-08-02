#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
CURRENT_DIR="$WEB_DIR/.next-current"
CANDIDATE_DIR="$WEB_DIR/.next-candidate"
PREVIOUS_DIR="$WEB_DIR/.next-previous"
CANARY_PID_FILE="$ROOT_DIR/.run/oi-web-canary.pid"

test -f "$CANDIDATE_DIR/BUILD_ID"

wait_for_preview() {
  local url="$1"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if PREVIEW_URL="$url" node "$ROOT_DIR/scripts/preview-health.mjs"; then
      return 0
    fi
    sleep 1
  done
  return 1
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
wait_for_preview http://127.0.0.1:3200/login
"$ROOT_DIR/scripts/stop-preview-canary.sh"
trap - EXIT

"$ROOT_DIR/scripts/stop-preview.sh"

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

if ! "$ROOT_DIR/scripts/start-preview.sh" ||
  ! wait_for_preview http://127.0.0.1:3000/login; then
  "$ROOT_DIR/scripts/stop-preview.sh" || true
  current_path="$(readlink -f "$CURRENT_DIR")"
  expected_current_path="$(readlink -f "$WEB_DIR")/.next-current"
  if [ "$current_path" != "$expected_current_path" ]; then
    echo "Refusing to remove unexpected current path: $current_path" >&2
    exit 1
  fi
  rm -rf -- "$current_path"
  if [ -d "$PREVIOUS_DIR" ]; then
    mv "$PREVIOUS_DIR" "$CURRENT_DIR"
    "$ROOT_DIR/scripts/start-preview.sh"
    wait_for_preview http://127.0.0.1:3000/login
  fi
  echo "Promotion failed and the previous preview was restored." >&2
  exit 1
fi

echo "Preview candidate promoted to port 3000."
