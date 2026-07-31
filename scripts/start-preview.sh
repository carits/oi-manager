#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/oi-web-preview.pid"
LOG_FILE="${PREVIEW_LOG_FILE:-/tmp/oi-web-preview.log}"

mkdir -p "$RUN_DIR"

if [ ! -f "$ROOT_DIR/apps/web/.next-current/BUILD_ID" ]; then
  echo "Preview build is missing. Run 'pnpm preview:build' and 'pnpm preview:promote' first." >&2
  exit 1
fi

if [ -f "$PID_FILE" ]; then
  old_pid="$(cat "$PID_FILE")"
  if kill -0 "$old_pid" 2>/dev/null; then
    echo "Preview is already running with PID $old_pid." >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

"$ROOT_DIR/scripts/check-ports.sh" 3000

cd "$ROOT_DIR"
nohup setsid env APP_ENV=development NODE_ENV=production NEXT_DIST_DIR=.next-current \
  pnpm --filter web preview:start > "$LOG_FILE" 2>&1 &
pid=$!
echo "$pid" > "$PID_FILE"

sleep 1
if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Preview failed to start. See $LOG_FILE" >&2
  exit 1
fi

echo "Preview started on http://0.0.0.0:3000 (PID $pid)"
echo "Log: $LOG_FILE"
