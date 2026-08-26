#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/oi-web-canary.pid"
LOG_FILE="${CANARY_LOG_FILE:-$RUN_DIR/oi-web-canary.log}"

mkdir -p "$RUN_DIR"
test -f "$ROOT_DIR/apps/web/.next-candidate/BUILD_ID"

if [ -f "$PID_FILE" ]; then
  old_pid="$(cat "$PID_FILE")"
  if kill -0 "$old_pid" 2>/dev/null; then
    echo "Preview canary is already running with PID $old_pid." >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

"$ROOT_DIR/scripts/check-ports.sh" 3200

cd "$ROOT_DIR"
nohup setsid env APP_ENV=development NODE_ENV=production NEXT_DIST_DIR=.next-candidate \
  pnpm --filter web preview:canary > "$LOG_FILE" 2>&1 &
pid=$!
echo "$pid" > "$PID_FILE"

sleep 1
if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Canary failed to start. See $LOG_FILE" >&2
  exit 1
fi

echo "Preview canary started on http://127.0.0.1:3200 (PID $pid)"
