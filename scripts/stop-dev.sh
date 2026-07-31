#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT_DIR/.run/oi-dev.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No managed development PID was found."
  echo "Inspect ports 3001 and 3002 before stopping any process manually."
  exit 0
fi

pid="$(cat "$PID_FILE")"
if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Removed stale development PID file."
  exit 0
fi

process_cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
if [ "$process_cwd" != "$ROOT_DIR" ]; then
  echo "Refusing to stop PID $pid because it is not owned by $ROOT_DIR." >&2
  exit 1
fi

process_group="$(ps -o pgid= -p "$pid" | tr -d ' ')"
kill -TERM -- "-$process_group"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done

if kill -0 "$pid" 2>/dev/null; then
  echo "Development process group $process_group did not stop cleanly; inspect it manually." >&2
  exit 1
fi

rm -f "$PID_FILE"
echo "Managed development services stopped. The public preview on port 3000 was not touched."
