#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/oi-dev.pid"
LOG_FILE="${DEV_LOG_FILE:-/tmp/oi-dev.log}"

cd "$ROOT_DIR"
mkdir -p "$RUN_DIR"

"$ROOT_DIR/scripts/stop-dev.sh"

ensure_compose_service() {
  local container_name="$1"
  local service_name="$2"

  if docker container inspect "$container_name" >/dev/null 2>&1; then
    if [ "$(docker inspect -f '{{.State.Running}}' "$container_name")" != "true" ]; then
      docker start "$container_name" >/dev/null
    fi
    echo "Reusing Docker container $container_name."
    return
  fi

  COMPOSE_PROJECT_NAME=oi-manager docker-compose up -d "$service_name"
}

ensure_compose_service oi-postgres db

# Recreate judge when the custom sandbox image or compose settings change.
COMPOSE_PROJECT_NAME=oi-manager docker-compose up -d --build judge

database_ready=false
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec oi-postgres pg_isready -U oi -d oi_manager >/dev/null 2>&1; then
    database_ready=true
    break
  fi
  sleep 1
done

if [ "$database_ready" != "true" ]; then
  echo "PostgreSQL did not become ready within 10 seconds." >&2
  exit 1
fi

sandbox_ready=false
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl --fail --silent --show-error http://127.0.0.1:5050/version >/dev/null 2>&1; then
    sandbox_ready=true
    break
  fi
  sleep 1
done

if [ "$sandbox_ready" != "true" ]; then
  echo "go-judge did not become ready within 20 seconds." >&2
  docker logs --tail 100 oi-judge >&2 || true
  exit 1
fi

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

api_ready=false
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl --fail --silent --show-error http://127.0.0.1:3002/api/health >/dev/null 2>&1; then
    api_ready=true
    break
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ "$api_ready" != "true" ]; then
  echo "Development API did not become healthy within 20 seconds. See $LOG_FILE" >&2
  exit 1
fi

echo "Development services started with PID $pid."
echo "HMR: http://127.0.0.1:3001"
echo "API: http://127.0.0.1:3002"
echo "Log: $LOG_FILE"
