#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" >/dev/null 2>&1 || true; fi
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT INT TERM

port="$((18000 + RANDOM % 1000))"
capture="$TEST_ROOT/webhook.jsonl"
url_file="$TEST_ROOT/webhook-url"
cat > "$TEST_ROOT/webhook-server.mjs" <<'NODE'
import fs from 'node:fs'
import http from 'node:http'
const [port, capture] = process.argv.slice(2)
http.createServer((request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    fs.appendFileSync(capture, `${body}\n`)
    response.writeHead(204).end()
  })
}).listen(Number(port), '127.0.0.1')
NODE
node "$TEST_ROOT/webhook-server.mjs" "$port" "$capture" &
SERVER_PID="$!"
printf 'http://127.0.0.1:%s/alert\n' "$port" > "$url_file"
chmod 600 "$url_file"
for _ in {1..20}; do curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1 && break; sleep 0.1; done

MONITOR_STATUS=failed MONITOR_MESSAGE='fault injection' \
MONITOR_ALERT_WEBHOOK_URL_FILE="$url_file" MONITOR_ALERT_ALLOW_HTTP=1 \
  "$ROOT_DIR/scripts/send-monitor-alert.sh"
MONITOR_STATUS=recovered MONITOR_MESSAGE='services recovered' \
MONITOR_ALERT_WEBHOOK_URL_FILE="$url_file" MONITOR_ALERT_ALLOW_HTTP=1 \
  "$ROOT_DIR/scripts/send-monitor-alert.sh"

node - "$capture" <<'NODE'
const fs = require('node:fs')
const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse)
if (rows.length !== 2 || rows[0].status !== 'failed' || rows[1].status !== 'recovered') {
  throw new Error(`Unexpected alert capture: ${JSON.stringify(rows)}`)
}
NODE

monitor_state="$TEST_ROOT/monitor.state"
if MONITOR_API_URL='http://127.0.0.1:1/unavailable' \
  MONITOR_STATE_FILE="$monitor_state" MONITOR_ALERT_COMMAND=false \
  "$ROOT_DIR/scripts/monitor-services.sh" >/dev/null 2>&1; then
  echo 'Expected monitor failure was reported as healthy' >&2
  exit 1
fi
[[ ! -e "$monitor_state" ]]

transition_capture="$TEST_ROOT/monitor-transitions.jsonl"
alert_command="MONITOR_ALERT_TEST_MODE=1 MONITOR_ALERT_CAPTURE_FILE='$transition_capture' '$ROOT_DIR/scripts/send-monitor-alert.sh'"
if MONITOR_API_URL='http://127.0.0.1:1/unavailable' \
  MONITOR_STATE_FILE="$monitor_state" MONITOR_ALERT_COMMAND="$alert_command" \
  "$ROOT_DIR/scripts/monitor-services.sh" >/dev/null 2>&1; then
  echo 'Expected monitor failure was reported as healthy' >&2
  exit 1
fi
MONITOR_STATE_FILE="$monitor_state" MONITOR_ALERT_COMMAND="$alert_command" MONITOR_QUIET_SUCCESS=1 \
  "$ROOT_DIR/scripts/monitor-services.sh" >/dev/null
node - "$transition_capture" <<'NODE'
const fs = require('node:fs')
const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse)
if (rows.length !== 2 || rows[0].status !== 'failed' || rows[1].status !== 'recovered') {
  throw new Error(`Unexpected monitor transitions: ${JSON.stringify(rows)}`)
}
NODE

mkdir -p "$TEST_ROOT/remote"
export LOG_ARCHIVE_TEST_REMOTE="$TEST_ROOT/remote"
LOG_ARCHIVE_SPOOL_DIR="$TEST_ROOT/spool" \
LOG_ARCHIVE_LOCK_FILE="$TEST_ROOT/archive.lock" \
LOG_ARCHIVE_SINCE_HOURS=1 \
LOG_ARCHIVE_COMMAND='cp -- "$LOG_ARCHIVE_PATH" "$LOG_ARCHIVE_TEST_REMOTE/"; cp -- "$LOG_ARCHIVE_PATH.sha256" "$LOG_ARCHIVE_TEST_REMOTE/"' \
  "$ROOT_DIR/scripts/archive-operations-logs.sh"

archive="$(find "$TEST_ROOT/remote" -maxdepth 1 -type f -name '*.tar.gz' -print -quit)"
[[ -n "$archive" && -s "$archive" ]]
expected_sha="$(cut -d' ' -f1 "$archive.sha256")"
actual_sha="$(sha256sum "$archive" | cut -d' ' -f1)"
[[ "$actual_sha" == "$expected_sha" ]]
tar -tzf "$archive" > "$TEST_ROOT/archive-list.txt"
grep -Fxq './manifest.txt' "$TEST_ROOT/archive-list.txt"
grep -Fxq './journal/oi-manager-judge.service.log' "$TEST_ROOT/archive-list.txt"
grep -Fxq './docker/oi-judge.log' "$TEST_ROOT/archive-list.txt"

echo "Observability verification passed: failed/recovered webhook and off-process archive copy"
