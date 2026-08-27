#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="oi-manager-e2e-fault-postgres"
JUDGE_CONTAINER="oi-manager-e2e-fault-go-judge"
DB_PORT="15432"
DB_UPSTREAM_PORT="15433"
DB_CONTROL_PORT="15434"
DB_PROXY_PID=""
cleanup() {
  [[ -n "$DB_PROXY_PID" ]] && kill -TERM "$DB_PROXY_PID" >/dev/null 2>&1 || true
  [[ -n "$DB_PROXY_PID" ]] && wait "$DB_PROXY_PID" >/dev/null 2>&1 || true
  for container in "$JUDGE_CONTAINER" "$DB_CONTAINER"; do
    owned="$(docker inspect --format '{{ index .Config.Labels "oi-manager.e2e-fault" }}' "$container" 2>/dev/null || true)"
    [[ "$owned" == "true" ]] && docker stop --time 10 "$container" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT INT TERM
cleanup
for container in "$DB_CONTAINER" "$JUDGE_CONTAINER"; do
  if docker inspect "$container" >/dev/null 2>&1; then
    echo "Refusing to replace unowned container $container" >&2
    exit 3
  fi
done

docker run --detach --rm --name "$DB_CONTAINER" --label oi-manager.e2e-fault=true \
  --publish "127.0.0.1:${DB_UPSTREAM_PORT}:5432" \
  -e POSTGRES_DB=oi_manager -e POSTGRES_USER=oi -e POSTGRES_PASSWORD=oi_password \
  postgres:16-alpine >/dev/null
db_ready=0
for _ in $(seq 1 120); do
  if docker exec "$DB_CONTAINER" pg_isready -U oi -d oi_manager >/dev/null 2>&1; then db_ready=1; break; fi
  sleep 0.25
done
[[ "$db_ready" == "1" ]] || { echo "Dedicated PostgreSQL did not become ready" >&2; exit 1; }

env FAULT_TCP_PROXY_PORT="$DB_PORT" FAULT_TCP_UPSTREAM_PORT="$DB_UPSTREAM_PORT" \
  FAULT_TCP_CONTROL_PORT="$DB_CONTROL_PORT" node "$ROOT_DIR/scripts/fault-tcp-proxy.mjs" \
  > "$ROOT_DIR/test-results/fault-db-proxy.log" 2>&1 &
DB_PROXY_PID=$!
for _ in $(seq 1 80); do
  curl --fail --silent "http://127.0.0.1:${DB_CONTROL_PORT}/__fault/status" >/dev/null && break
  sleep 0.1
done
curl --fail --silent "http://127.0.0.1:${DB_CONTROL_PORT}/__fault/status" >/dev/null

export E2E_DATABASE_URL="postgresql://oi:oi_password@127.0.0.1:${DB_PORT}/oi_manager?schema=e2e"
cd "$ROOT_DIR"
pnpm test:ui:prepare
pnpm exec playwright test --config=playwright.fault.config.ts "$@"
