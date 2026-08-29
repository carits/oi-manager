#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ORIGIN="${MONITOR_WEB_ORIGIN:-http://127.0.0.1:3000}"
WEB_URL="${MONITOR_WEB_URL:-$WEB_ORIGIN/login}"
# The deployed optimized Web service has no HMR listener. Development
# environments can opt in by setting MONITOR_HMR_URL explicitly.
HMR_URL="${MONITOR_HMR_URL:-}"
API_URL="${MONITOR_API_URL:-http://127.0.0.1:3002/api/health}"
JUDGE_URL="${MONITOR_JUDGE_URL:-http://127.0.0.1:5050/version}"
DB_CONTAINER="${MONITOR_DB_CONTAINER:-oi-postgres}"
DB_USER="${MONITOR_DB_USER:-oi}"
DB_NAME="${MONITOR_DB_NAME:-oi_manager}"
BACKUP_DIR="${MONITOR_BACKUP_DIR:-/data/backups/oi-manager/automatic}"
BACKUP_MAX_AGE_HOURS="${MONITOR_BACKUP_MAX_AGE_HOURS:-26}"
DISK_MAX_PERCENT="${MONITOR_DISK_MAX_PERCENT:-85}"
STATE_FILE="${MONITOR_STATE_FILE:-$ROOT_DIR/.run/service-monitor.state}"
QUIET_SUCCESS="${MONITOR_QUIET_SUCCESS:-0}"
ALERT_COMMAND="${MONITOR_ALERT_COMMAND:-}"
JUDGE_PROJECTION_CHECK="${MONITOR_JUDGE_PROJECTION_CHECK:-1}"
METRICS_CHECK="${MONITOR_METRICS_CHECK:-1}"
METRICS_MAX_AGE_SECONDS="${MONITOR_METRICS_MAX_AGE_SECONDS:-600}"
API_RSS_MAX_MB="${MONITOR_API_RSS_MAX_MB:-1024}"
EVENT_LOOP_P99_MAX_MS="${MONITOR_EVENT_LOOP_P99_MAX_MS:-250}"
API_ENDPOINT_MIN_REQUESTS="${MONITOR_API_ENDPOINT_MIN_REQUESTS:-20}"
API_ENDPOINT_5XX_MAX_PERCENT="${MONITOR_API_ENDPOINT_5XX_MAX_PERCENT:-5}"
API_ENDPOINT_P99_MAX_MS="${MONITOR_API_ENDPOINT_P99_MAX_MS:-5000}"
JUDGE_METRICS_CHECK="${MONITOR_JUDGE_METRICS_CHECK:-1}"
JUDGE_METRICS_MAX_AGE_SECONDS="${MONITOR_JUDGE_METRICS_MAX_AGE_SECONDS:-180}"
JUDGE_RSS_MAX_MB="${MONITOR_JUDGE_RSS_MAX_MB:-2048}"
OPERATIONAL_STATE_CHECK="${MONITOR_OPERATIONAL_STATE_CHECK:-1}"
INCIDENT_CAPTURE_COMMAND="${MONITOR_INCIDENT_CAPTURE_COMMAND:-$ROOT_DIR/scripts/capture-incident-evidence.sh}"

failures=()

write_state() {
  local value="$1"
  local temp="${STATE_FILE}.next.$$"
  printf '%s\n' "$value" > "$temp"
  mv -- "$temp" "$STATE_FILE"
}

fail() {
  failures+=("$1")
}

deliver_alert() {
  local status="$1"
  local message="$2"
  if [[ "$ALERT_COMMAND" != /* ]] || [ ! -x "$ALERT_COMMAND" ]; then
    echo "monitor alert command must be an absolute executable: $ALERT_COMMAND" >&2
    return 1
  fi
  MONITOR_STATUS="$status" MONITOR_MESSAGE="$message" "$ALERT_COMMAND"
}

check_http() {
  local name="$1"
  local url="$2"
  local expected_text="${3:-}"
  local body
  if ! body="$(curl --fail --silent --show-error --location --max-time 5 "$url" 2>&1)"; then
    fail "$name unavailable ($url): $body"
    return
  fi
  if [ -n "$expected_text" ] && ! grep -Fq "$expected_text" <<<"$body"; then
    fail "$name returned unexpected content ($url)"
  fi
}

check_disk() {
  local mount="$1"
  local usage
  usage="$(df -P "$mount" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  if ! [[ "$usage" =~ ^[0-9]+$ ]]; then
    fail "cannot read disk usage for $mount"
  elif [ "$usage" -ge "$DISK_MAX_PERCENT" ]; then
    fail "disk usage for $mount is ${usage}% (limit ${DISK_MAX_PERCENT}%)"
  fi
}

check_metrics_snapshot() {
  local active_port metrics_file output
  active_port="$(cat "$ROOT_DIR/.run/api-active-upstream" 2>/dev/null || echo 3002)"
  metrics_file="$ROOT_DIR/.run/metrics-${active_port}.json"
  if [ ! -s "$metrics_file" ]; then
    fail "API metrics snapshot is missing: $metrics_file"
    return
  fi
  if ! output="$(node - "$metrics_file" "$METRICS_MAX_AGE_SECONDS" "$API_RSS_MAX_MB" "$EVENT_LOOP_P99_MAX_MS" "$API_ENDPOINT_MIN_REQUESTS" "$API_ENDPOINT_5XX_MAX_PERCENT" "$API_ENDPOINT_P99_MAX_MS" <<'NODE'
const fs = require('node:fs')
const [file, maxAgeRaw, maxRssRaw, maxLoopRaw, minRequestsRaw, max5xxRaw, maxP99Raw] = process.argv.slice(2)
const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'))
const ageSeconds = (Date.now() - Date.parse(snapshot.generatedAt)) / 1000
const rssMb = Number(snapshot.process?.rssBytes || 0) / 1024 / 1024
const eventLoopP99 = Number(snapshot.process?.eventLoopDelayP99Ms || 0)
const violations = []
if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > Number(maxAgeRaw)) violations.push(`age=${ageSeconds.toFixed(1)}s`)
if (!Number.isFinite(rssMb) || rssMb > Number(maxRssRaw)) violations.push(`rss=${rssMb.toFixed(1)}MiB`)
if (!Number.isFinite(eventLoopP99) || eventLoopP99 > Number(maxLoopRaw)) violations.push(`eventLoopP99=${eventLoopP99.toFixed(3)}ms`)
if (Number(snapshot.runtimeEvents?.droppedSeries || 0) > 0) violations.push(`droppedSeries=${snapshot.runtimeEvents.droppedSeries}`)
for (const endpoint of snapshot.endpoints || []) {
  if (Number(endpoint.count) < Number(minRequestsRaw)) continue
  const rate5xx = Number(endpoint.status5xx || 0) * 100 / Number(endpoint.count)
  if (rate5xx > Number(max5xxRaw)) violations.push(`${endpoint.endpoint}:5xx=${rate5xx.toFixed(1)}%`)
  if (Number(endpoint.p99Ms || 0) > Number(maxP99Raw)) violations.push(`${endpoint.endpoint}:p99=${endpoint.p99Ms}ms`)
}
if (violations.length) throw new Error(violations.join(', '))
console.log(`age=${ageSeconds.toFixed(1)}s rss=${rssMb.toFixed(1)}MiB eventLoopP99=${eventLoopP99.toFixed(3)}ms`)
NODE
  )"; then
    fail "API metrics snapshot failed: ${output:-validation error}"
  fi
}

check_judge_metrics_snapshot() {
  local metrics_file="$ROOT_DIR/.run/judge-metrics.json"
  local output
  if [ ! -s "$metrics_file" ]; then
    fail "Judge metrics snapshot is missing: $metrics_file"
    return
  fi
  if ! output="$(node - "$metrics_file" "$JUDGE_METRICS_MAX_AGE_SECONDS" "$JUDGE_RSS_MAX_MB" "$EVENT_LOOP_P99_MAX_MS" <<'NODE'
const fs = require('node:fs')
const [file, maxAgeRaw, maxRssRaw, maxLoopRaw] = process.argv.slice(2)
const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'))
const ageSeconds = (Date.now() - Date.parse(snapshot.generatedAt)) / 1000
const messageAge = snapshot.connection?.lastMessageAt
  ? (Date.now() - Date.parse(snapshot.connection.lastMessageAt)) / 1000
  : Number.POSITIVE_INFINITY
const rssMb = Number(snapshot.process?.rssBytes || 0) / 1024 / 1024
const eventLoopP99 = Number(snapshot.process?.eventLoopDelayP99Ms || 0)
const violations = []
if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > Number(maxAgeRaw)) violations.push(`age=${ageSeconds.toFixed(1)}s`)
if (!snapshot.connection?.connected) violations.push('disconnected')
if (!snapshot.connection?.authenticated) violations.push('unauthenticated')
if (!Number.isFinite(messageAge) || messageAge > Number(maxAgeRaw)) violations.push(`lastMessageAge=${messageAge.toFixed(1)}s`)
if (!Number.isFinite(rssMb) || rssMb > Number(maxRssRaw)) violations.push(`rss=${rssMb.toFixed(1)}MiB`)
if (!Number.isFinite(eventLoopP99) || eventLoopP99 > Number(maxLoopRaw)) violations.push(`eventLoopP99=${eventLoopP99.toFixed(3)}ms`)
if (violations.length) throw new Error(violations.join(', '))
console.log(`age=${ageSeconds.toFixed(1)}s messageAge=${messageAge.toFixed(1)}s rss=${rssMb.toFixed(1)}MiB`)
NODE
  )"; then
    fail "Judge metrics snapshot failed: ${output:-validation error}"
  fi
}

check_http "preview" "$WEB_URL"
if [ -n "$HMR_URL" ]; then
  check_http "HMR" "$HMR_URL"
fi
check_http "API" "$API_URL" '"status":"ok"'
check_http "go-judge" "$JUDGE_URL"

if ! docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
  fail "PostgreSQL is not ready in $DB_CONTAINER"
fi

if [ "$JUDGE_PROJECTION_CHECK" = "1" ]; then
  if ! projection_output="$(cd "$ROOT_DIR" && pnpm --silent judge:projection:check 2>&1)"; then
    projection_summary="$(tail -n 20 <<<"$projection_output" | tr '\n' ' ' | cut -c1-1200)"
    fail "JudgeRun/Submission projection mismatch: $projection_summary"
  fi
fi

if [ "$METRICS_CHECK" = "1" ]; then
  check_metrics_snapshot
fi

if [ "$JUDGE_METRICS_CHECK" = "1" ]; then
  check_judge_metrics_snapshot
fi

if [ "$OPERATIONAL_STATE_CHECK" = "1" ]; then
  if ! operational_output="$(cd "$ROOT_DIR" && pnpm --silent operations:check 2>&1)"; then
    operational_summary="$(tail -n 30 <<<"$operational_output" | tr '\n' ' ' | cut -c1-1600)"
    fail "Operational state degraded: $operational_summary"
  fi
fi

build_id_file="$ROOT_DIR/apps/web/.next-current/BUILD_ID"
if [ ! -s "$build_id_file" ]; then
  fail "current preview BUILD_ID is missing"
else
  build_id="$(cat "$build_id_file")"
  manifest_url="$WEB_ORIGIN/_next/static/$build_id/_buildManifest.js"
  check_http "preview build $build_id" "$manifest_url"
fi

newest_backup="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}_*.dump" -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 || true)"
if [ -z "$newest_backup" ]; then
  fail "no automatic database backup found in $BACKUP_DIR"
else
  newest_epoch="${newest_backup%% *}"
  newest_epoch="${newest_epoch%.*}"
  max_age_seconds="$((BACKUP_MAX_AGE_HOURS * 3600))"
  age_seconds="$(( $(date +%s) - newest_epoch ))"
  if [ "$age_seconds" -gt "$max_age_seconds" ]; then
    fail "latest database backup is older than ${BACKUP_MAX_AGE_HOURS}h"
  fi
fi

check_disk /
if [ -d /data ]; then check_disk /data; fi

mkdir -p "$(dirname "$STATE_FILE")"
timestamp="$(date --iso-8601=seconds)"
if [ "${#failures[@]}" -eq 0 ]; then
  current_state="ok"
  previous_state="$(cat "$STATE_FILE" 2>/dev/null || true)"
  if [ "$QUIET_SUCCESS" != "1" ] || [ -n "$previous_state" -a "$previous_state" != "ok" ]; then
    echo "[$timestamp] service monitor healthy"
  fi
  if [ -n "$ALERT_COMMAND" ] && [ -n "$previous_state" ] && [ "$previous_state" != "ok" ]; then
    deliver_alert "recovered" "services recovered"
  fi
  # Persist the transition only after the external notification succeeds.
  # A failed delivery is retried during the next monitor run.
  write_state "$current_state"
  exit 0
fi

summary="$(printf '%s; ' "${failures[@]}")"
current_state="failed:$summary"
previous_state="$(cat "$STATE_FILE" 2>/dev/null || true)"
echo "[$timestamp] service monitor failed: $summary" >&2
if [ "$current_state" != "$previous_state" ] && [ -n "$INCIDENT_CAPTURE_COMMAND" ]; then
  if [[ "$INCIDENT_CAPTURE_COMMAND" != /* ]] || [ ! -x "$INCIDENT_CAPTURE_COMMAND" ]; then
    echo "incident capture command must be an absolute executable: $INCIDENT_CAPTURE_COMMAND" >&2
  elif ! INCIDENT_REASON="monitor failure: $summary" "$INCIDENT_CAPTURE_COMMAND"; then
    echo "incident evidence capture failed" >&2
  fi
fi
if [ -n "$ALERT_COMMAND" ] && [ "$current_state" != "$previous_state" ]; then
  deliver_alert "failed" "$summary"
fi
write_state "$current_state"
exit 1
