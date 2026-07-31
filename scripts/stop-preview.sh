#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT_DIR/.run/oi-web-preview.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No managed preview PID file was found."
  exit 0
fi

pid="$(cat "$PID_FILE")"
if kill -0 "$pid" 2>/dev/null; then
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
fi

if kill -0 "$pid" 2>/dev/null; then
  current_cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  current_group="$(ps -o pgid= -p "$pid" | tr -d ' ')"
  if [ "$current_cwd" != "$ROOT_DIR" ] || [ "$current_group" != "$process_group" ]; then
    echo "Refusing to force-stop PID $pid because its ownership changed." >&2
    exit 1
  fi

  echo "Preview did not stop after SIGTERM; force-stopping managed process group $process_group."
  kill -KILL -- "-$process_group"
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
fi

if kill -0 "$pid" 2>/dev/null; then
  echo "Managed preview PID $pid is still present after forced shutdown." >&2
  exit 1
fi

rm -f "$PID_FILE"
echo "Preview stopped."
