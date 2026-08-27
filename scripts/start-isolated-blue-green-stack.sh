#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="$ROOT_DIR/test-results/blue-green"
ROUTER_PORT="${BLUE_GREEN_ROUTER_PORT:-3410}"
BLUE_PORT="${BLUE_GREEN_BLUE_PORT:-3412}"
GREEN_PORT="${BLUE_GREEN_GREEN_PORT:-3413}"
SANDBOX_PORT="${BLUE_GREEN_SANDBOX_PORT:-15051}"
SANDBOX_NAME="oi-manager-e2e-blue-green-go-judge"
SANDBOX_IMAGE="${STRESS_GO_JUDGE_IMAGE:-oi-manager/go-judge:v1.12.1-gcc-python3}"
ACTIVE_FILE="$RESULTS_DIR/active-upstream"
READY_FILE="$RESULTS_DIR/stack-ready"

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${JUDGE_TOKEN:?JUDGE_TOKEN is required}"
: "${TESTDATA_DIR:?TESTDATA_DIR is required}"
[[ "$DATABASE_URL" == *"schema=e2e"* ]] || { echo "Refusing blue/green stack without schema=e2e" >&2; exit 2; }

mkdir -p "$RESULTS_DIR"
rm -f "$RESULTS_DIR"/*.log "$RESULTS_DIR"/*.json "$RESULTS_DIR"/*.exit "$ACTIVE_FILE" "$ACTIVE_FILE.next" "$READY_FILE"
if docker ps -a --format '{{.Names}}' | grep -Fxq "$SANDBOX_NAME"; then
  echo "Refusing to replace existing container $SANDBOX_NAME" >&2
  exit 3
fi

PIDS=()
STARTED_PID=""
SANDBOX_STARTED=0
cleanup() {
  trap - EXIT INT TERM
  for pid in "${PIDS[@]:-}"; do kill -TERM "$pid" 2>/dev/null || true; done
  for pid in "${PIDS[@]:-}"; do wait "$pid" 2>/dev/null || true; done
  if [[ "$SANDBOX_STARTED" == 1 ]]; then docker stop --time 10 "$SANDBOX_NAME" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM

start_api() {
  local port="$1" log="$2"
  (
    cd "$ROOT_DIR/apps/server"
    exec env PORT="$port" API_HOST=127.0.0.1 NODE_ENV=test APP_ENV=test \
      SKIP_JUDGE_RECOVERY=true DISABLE_BACKGROUND_JOBS=true \
      pnpm exec tsx src/index.ts
  ) >"$log" 2>&1 &
  STARTED_PID=$!
  PIDS+=("$STARTED_PID")
  for _ in $(seq 1 120); do
    curl --fail --silent "http://127.0.0.1:${port}/api/readiness" >/dev/null && break
    sleep 0.25
  done
  curl --fail --silent "http://127.0.0.1:${port}/api/readiness" >/dev/null
}

start_api "$BLUE_PORT" "$RESULTS_DIR/server-blue.log"
BLUE_PID="$STARTED_PID"
start_api "$GREEN_PORT" "$RESULTS_DIR/server-green.log"
GREEN_PID="$STARTED_PID"
printf '%s\n' "$BLUE_PORT" >"$ACTIVE_FILE"

(
  cd "$ROOT_DIR"
  exec env API_ROUTER_HOST=127.0.0.1 API_ROUTER_PORT="$ROUTER_PORT" \
    API_ACTIVE_UPSTREAM_FILE="$ACTIVE_FILE" API_ALLOWED_UPSTREAMS="$BLUE_PORT,$GREEN_PORT" \
    API_STARTUP_READY_FILE="$READY_FILE" \
    node scripts/api-router.mjs
) >"$RESULTS_DIR/router.log" 2>&1 &
ROUTER_PID=$!
PIDS+=("$ROUTER_PID")
for _ in $(seq 1 80); do
  curl --silent --output /dev/null "http://127.0.0.1:${ROUTER_PORT}/api/health" && break
  sleep 0.25
done
curl --silent --output /dev/null "http://127.0.0.1:${ROUTER_PORT}/api/health"

(
  cd "$ROOT_DIR/apps/server"
  exec env NODE_ENV=test APP_ENV=test BACKGROUND_WORKER_LOCK_NAME=oi-manager-e2e-blue-green-worker pnpm exec tsx src/background-worker.ts
) >"$RESULTS_DIR/worker-primary.log" 2>&1 &
WORKER_PID=$!
PIDS+=("$WORKER_PID")
for _ in $(seq 1 80); do
  grep -q background_worker_started "$RESULTS_DIR/worker-primary.log" && break
  sleep 0.25
done
grep -q background_worker_started "$RESULTS_DIR/worker-primary.log"

set +e
(
  cd "$ROOT_DIR/apps/server"
  exec env NODE_ENV=test APP_ENV=test BACKGROUND_WORKER_LOCK_NAME=oi-manager-e2e-blue-green-worker pnpm exec tsx src/background-worker.ts
) >"$RESULTS_DIR/worker-secondary.log" 2>&1 &
WORKER_SECONDARY_PID=$!
wait "$WORKER_SECONDARY_PID"
WORKER_SECONDARY_EXIT=$?
set -e
printf '%s\n' "$WORKER_SECONDARY_EXIT" >"$RESULTS_DIR/worker-secondary.exit"
[[ "$WORKER_SECONDARY_EXIT" -ne 0 ]]
grep -q 'Another background worker already holds the singleton lock' "$RESULTS_DIR/worker-secondary.log"

docker run --detach --rm \
  --name "$SANDBOX_NAME" --label oi-manager.e2e-blue-green=true \
  --privileged --read-only --security-opt no-new-privileges:true \
  --memory 1536m --memory-swap 2g --cpus 1.5 --pids-limit 256 --ulimit nofile=65536:65536 \
  --publish "127.0.0.1:${SANDBOX_PORT}:5050" --shm-size 512m \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m --volume /sys/fs/cgroup:/sys/fs/cgroup:rw \
  "$SANDBOX_IMAGE" >"$RESULTS_DIR/go-judge.container-id"
SANDBOX_STARTED=1
for _ in $(seq 1 80); do
  curl --fail --silent "http://127.0.0.1:${SANDBOX_PORT}/version" >/dev/null && break
  sleep 0.25
done
curl --fail --silent "http://127.0.0.1:${SANDBOX_PORT}/version" >/dev/null

(
  cd "$ROOT_DIR/apps/judge"
  exec env BACKEND_URL="ws://127.0.0.1:${ROUTER_PORT}" SANDBOX_HOST="http://127.0.0.1:${SANDBOX_PORT}" \
    JUDGE_ID=blue-green-real-judge MAX_CONCURRENT=2 pnpm exec tsx src/index.ts
) >"$RESULTS_DIR/judge.log" 2>&1 &
JUDGE_PID=$!
PIDS+=("$JUDGE_PID")
for _ in $(seq 1 120); do
  grep -q 'Registration confirmed' "$RESULTS_DIR/judge.log" && break
  sleep 0.25
done
grep -q 'Registration confirmed' "$RESULTS_DIR/judge.log"

printf '{"routerPort":%s,"bluePort":%s,"greenPort":%s,"sandboxPort":%s,"bluePid":%s,"greenPid":%s,"routerPid":%s,"workerPid":%s,"judgePid":%s,"activeFile":"%s","resultsDir":"%s"}\n' \
  "$ROUTER_PORT" "$BLUE_PORT" "$GREEN_PORT" "$SANDBOX_PORT" "$BLUE_PID" "$GREEN_PID" "$ROUTER_PID" "$WORKER_PID" "$JUDGE_PID" "$ACTIVE_FILE" "$RESULTS_DIR" \
  >"$RESULTS_DIR/stack.json"
touch "$READY_FILE"

# The test deliberately drains and stops the blue API. Keep the harness alive
# for as long as the stable router is alive; Playwright teardown terminates the
# harness and cleanup then owns every remaining child process.
wait "$ROUTER_PID"
