#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT_DIR/.run/oi-web-canary.pid"

if [ ! -f "$PID_FILE" ]; then
  exit 0
fi

pid="$(cat "$PID_FILE")"
if kill -0 "$pid" 2>/dev/null; then
  process_cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  if [ "$process_cwd" != "$ROOT_DIR" ]; then
    echo "Refusing to stop canary PID $pid because its working directory differs." >&2
    exit 1
  fi
  process_group="$(ps -o pgid= -p "$pid" | tr -d ' ')"
  kill -TERM -- "-$process_group"
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
fi

if kill -0 "$pid" 2>/dev/null; then
  echo "Canary PID $pid did not stop cleanly; inspect it before taking action." >&2
  exit 1
fi

rm -f "$PID_FILE"
