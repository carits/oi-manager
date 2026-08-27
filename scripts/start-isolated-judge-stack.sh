#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="${STRESS_RESULTS_DIR:-$ROOT_DIR/test-results/stress}"
SANDBOX_PORT="${STRESS_GO_JUDGE_PORT:-15050}"
SANDBOX_NAME="${STRESS_GO_JUDGE_NAME:-oi-manager-e2e-stress-go-judge}"
SANDBOX_IMAGE="${STRESS_GO_JUDGE_IMAGE:-oi-manager/go-judge:v1.12.1-gcc-python3}"
SANDBOX_LABEL="${STRESS_GO_JUDGE_LABEL:-oi-manager.e2e-stress=true}"
PROXY_PORT="${STRESS_SANDBOX_PROXY_PORT:-}"

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${JUDGE_TOKEN:?JUDGE_TOKEN is required}"
: "${PORT:?PORT is required}"

if [[ "$DATABASE_URL" != *"schema=e2e"* ]]; then
  echo "Refusing to start the stress stack without schema=e2e" >&2
  exit 2
fi

mkdir -p "$RESULTS_DIR"
if docker ps -a --format '{{.Names}}' | grep -Fxq "$SANDBOX_NAME"; then
  echo "Refusing to replace existing container $SANDBOX_NAME" >&2
  exit 3
fi

API_PID=""
JUDGE_PID=""
SANDBOX_STARTED=0
PROXY_PID=""
cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$JUDGE_PID" ]]; then kill -TERM "$JUDGE_PID" 2>/dev/null || true; fi
  if [[ -n "$API_PID" ]]; then kill -TERM "$API_PID" 2>/dev/null || true; fi
  if [[ -n "$PROXY_PID" ]]; then kill -TERM "$PROXY_PID" 2>/dev/null || true; fi
  if [[ -n "$JUDGE_PID" ]]; then wait "$JUDGE_PID" 2>/dev/null || true; fi
  if [[ -n "$API_PID" ]]; then wait "$API_PID" 2>/dev/null || true; fi
  if [[ -n "$PROXY_PID" ]]; then wait "$PROXY_PID" 2>/dev/null || true; fi
  if [[ "$SANDBOX_STARTED" == 1 ]]; then docker stop --time 10 "$SANDBOX_NAME" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM

docker run --detach --rm \
  --name "$SANDBOX_NAME" \
  --label "$SANDBOX_LABEL" \
  --privileged \
  --read-only \
  --security-opt no-new-privileges:true \
  --memory 1536m \
  --memory-swap 2g \
  --cpus 1.5 \
  --pids-limit 256 \
  --ulimit nofile=65536:65536 \
  --publish "127.0.0.1:${SANDBOX_PORT}:5050" \
  --shm-size 512m \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m \
  --volume /sys/fs/cgroup:/sys/fs/cgroup:rw \
  "$SANDBOX_IMAGE" >"$RESULTS_DIR/go-judge.container-id"
SANDBOX_STARTED=1

for _ in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:${SANDBOX_PORT}/version" >/dev/null; then break; fi
  sleep 0.25
done
curl --fail --silent "http://127.0.0.1:${SANDBOX_PORT}/version" >/dev/null

if [[ -n "$PROXY_PORT" ]]; then
  env FAULT_PROXY_PORT="$PROXY_PORT" FAULT_PROXY_UPSTREAM_PORT="$SANDBOX_PORT" \
    node "$ROOT_DIR/scripts/fault-http-proxy.mjs" >"$RESULTS_DIR/fault-proxy.log" 2>&1 &
  PROXY_PID=$!
  for _ in $(seq 1 60); do
    if curl --fail --silent "http://127.0.0.1:${PROXY_PORT}/version" >/dev/null; then break; fi
    sleep 0.25
  done
  curl --fail --silent "http://127.0.0.1:${PROXY_PORT}/version" >/dev/null
fi

(
  cd "$ROOT_DIR/apps/server"
  exec pnpm exec tsx src/index.ts
) >"$RESULTS_DIR/server.log" 2>&1 &
API_PID=$!

for _ in $(seq 1 120); do
  if curl --fail --silent "http://127.0.0.1:${PORT}/api/health" >/dev/null; then break; fi
  sleep 0.25
done
curl --fail --silent "http://127.0.0.1:${PORT}/api/health" >/dev/null

(
  cd "$ROOT_DIR/apps/judge"
  exec pnpm exec tsx src/index.ts
) >"$RESULTS_DIR/judge.log" 2>&1 &
JUDGE_PID=$!

printf '{"apiPid":%s,"judgePid":%s,"sandboxPort":%s,"sandboxProxyPort":%s}\n' \
  "$API_PID" "$JUDGE_PID" "$SANDBOX_PORT" "${PROXY_PORT:-0}" >"$RESULTS_DIR/stack-pids.json"

wait -n "$API_PID" "$JUDGE_PID"
exit $?
