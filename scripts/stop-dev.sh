#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT_DIR/.run/oi-dev.pid"

# `pnpm restart` invokes the lifecycle sequence stop -> restart -> start. Defer
# that automatic stop so restart-dev.sh can prepare Docker dependencies before
# it deliberately stops the application process group. A direct `pnpm stop`
# still performs the normal stop operation.
if [ "${npm_lifecycle_event:-}" = "stop" ] && [ "${npm_command:-}" = "restart" ]; then
  echo "Deferring application stop until restart dependencies are ready."
  exit 0
fi

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

group_has_live_processes() {
  ps -o stat= -g "$process_group" 2>/dev/null | grep -Eq '^[[:space:]]*[^Z]'
}

# The pnpm parent can remain as a zombie until its launcher reaps it. A zombie
# owns no ports or work, so waiting on kill -0 needlessly extended every API
# restart by ten seconds. Wait for live group members instead.
for _ in $(seq 1 100); do
  group_has_live_processes || break
  sleep 0.1
done

if group_has_live_processes; then
  echo "Development process group $process_group did not stop cleanly; inspect it manually." >&2
  exit 1
fi

rm -f "$PID_FILE"
echo "Managed development services stopped. The loopback preview on port 3000 was not touched."
