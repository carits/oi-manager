#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/oi-dev.pid"
LOG_FILE="${DEV_LOG_FILE:-/tmp/oi-dev.log}"

cd "$ROOT_DIR"
mkdir -p "$RUN_DIR"

"$ROOT_DIR/scripts/stop-dev.sh"
docker-compose up -d db judge

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec oi-postgres pg_isready -U oi -d oi_manager >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

"$ROOT_DIR/scripts/check-ports.sh" 3001 3002

nohup setsid pnpm dev > "$LOG_FILE" 2>&1 &
pid=$!
echo "$pid" > "$PID_FILE"

sleep 3
if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Development services failed to start. See $LOG_FILE" >&2
  exit 1
fi

echo "Development services started with PID $pid."
echo "HMR: http://127.0.0.1:3001"
echo "API: http://127.0.0.1:3002"
echo "Log: $LOG_FILE"
