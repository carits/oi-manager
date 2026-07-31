#!/bin/bash
set -euo pipefail

for port in "$@"; do
  pid=""
  listener=""
  if command -v lsof >/dev/null 2>&1; then
    pid="$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  elif command -v ss >/dev/null 2>&1; then
    listener="$(ss -H -ltnp "sport = :$port" 2>/dev/null | head -n 1 || true)"
    pid="$(printf '%s' "$listener" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p')"
  else
    echo "Cannot inspect port $port: install lsof or iproute2 (ss)." >&2
    exit 2
  fi

  if [ -n "$pid" ] || [ -n "$listener" ]; then
    command_line="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    owner="${pid:-unknown}"
    details="${command_line:-$listener}"
    echo "Port $port is already owned by PID $owner: $details" >&2
    echo "Stop the owning service explicitly before starting another instance." >&2
    exit 1
  fi
done
