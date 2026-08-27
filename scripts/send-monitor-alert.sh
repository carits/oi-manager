#!/usr/bin/env bash
set -Eeuo pipefail

STATUS="${MONITOR_STATUS:-unknown}"
MESSAGE="${MONITOR_MESSAGE:-no message supplied}"
WEBHOOK_FILE="${MONITOR_ALERT_WEBHOOK_URL_FILE:-}"
EMAIL_TO="${MONITOR_ALERT_EMAIL:-}"
CAPTURE_FILE="${MONITOR_ALERT_CAPTURE_FILE:-}"
TEST_MODE="${MONITOR_ALERT_TEST_MODE:-0}"
ALLOW_HTTP="${MONITOR_ALERT_ALLOW_HTTP:-0}"
HOST_LABEL="${MONITOR_HOST_LABEL:-$(hostname -f 2>/dev/null || hostname)}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ID_FILE="$ROOT_DIR/apps/web/.next-current/BUILD_ID"
BUILD_ID="unknown"
if [[ -s "$BUILD_ID_FILE" ]]; then BUILD_ID="$(cat "$BUILD_ID_FILE")"; fi

payload="$({
  MONITOR_PAYLOAD_STATUS="$STATUS" \
  MONITOR_PAYLOAD_MESSAGE="$MESSAGE" \
  MONITOR_PAYLOAD_HOST="$HOST_LABEL" \
  MONITOR_PAYLOAD_BUILD_ID="$BUILD_ID" \
  node <<'NODE'
const payload = {
  source: 'oi-manager',
  status: process.env.MONITOR_PAYLOAD_STATUS,
  message: process.env.MONITOR_PAYLOAD_MESSAGE,
  host: process.env.MONITOR_PAYLOAD_HOST,
  buildId: process.env.MONITOR_PAYLOAD_BUILD_ID,
  timestamp: new Date().toISOString(),
}
process.stdout.write(JSON.stringify(payload))
NODE
})"

delivered=0
if [[ -n "$WEBHOOK_FILE" ]]; then
  [[ -f "$WEBHOOK_FILE" ]] || { echo "Webhook URL file does not exist: $WEBHOOK_FILE" >&2; exit 2; }
  permissions="$(stat -c '%a' "$WEBHOOK_FILE")"
  [[ "$permissions" == "600" || "$permissions" == "400" ]] || {
    echo "Webhook URL file must have mode 600 or 400, got $permissions" >&2
    exit 2
  }
  MONITOR_WEBHOOK_FILE="$WEBHOOK_FILE" \
  MONITOR_WEBHOOK_PAYLOAD="$payload" \
  MONITOR_WEBHOOK_ALLOW_HTTP="$ALLOW_HTTP" \
  node <<'NODE'
const fs = require('node:fs')
const endpoint = fs.readFileSync(process.env.MONITOR_WEBHOOK_FILE, 'utf8').trim()
const url = new URL(endpoint)
if (url.protocol !== 'https:' && !(process.env.MONITOR_WEBHOOK_ALLOW_HTTP === '1' && url.protocol === 'http:')) {
  throw new Error('Monitor webhook must use HTTPS')
}
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 10_000)
fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': 'oi-manager-monitor/1' },
  body: process.env.MONITOR_WEBHOOK_PAYLOAD,
  signal: controller.signal,
}).then(response => {
  if (!response.ok) throw new Error(`Monitor webhook returned HTTP ${response.status}`)
}).finally(() => clearTimeout(timer)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
NODE
  delivered=1
fi

if [[ -n "$EMAIL_TO" ]]; then
  command -v sendmail >/dev/null 2>&1 || { echo "sendmail is not installed" >&2; exit 2; }
  {
    printf 'To: %s\n' "$EMAIL_TO"
    printf 'Subject: [OI Manager] %s on %s\n' "$STATUS" "$HOST_LABEL"
    printf 'Content-Type: text/plain; charset=UTF-8\n\n'
    printf 'Status: %s\nHost: %s\nBuild: %s\nMessage: %s\n' "$STATUS" "$HOST_LABEL" "$BUILD_ID" "$MESSAGE"
  } | sendmail -t
  delivered=1
fi

if [[ -n "$CAPTURE_FILE" ]]; then
  [[ "$TEST_MODE" == "1" ]] || { echo "MONITOR_ALERT_CAPTURE_FILE is test-only" >&2; exit 2; }
  mkdir -p "$(dirname "$CAPTURE_FILE")"
  printf '%s\n' "$payload" >> "$CAPTURE_FILE"
  delivered=1
fi

[[ "$delivered" == "1" ]] || {
  echo "No monitor alert destination is configured" >&2
  exit 2
}

echo "Monitor alert delivered: status=$STATUS host=$HOST_LABEL"
