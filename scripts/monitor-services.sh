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
    MONITOR_STATUS="recovered" MONITOR_MESSAGE="services recovered" bash -lc "$ALERT_COMMAND"
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
if [ -n "$ALERT_COMMAND" ] && [ "$current_state" != "$previous_state" ]; then
  MONITOR_STATUS="failed" MONITOR_MESSAGE="$summary" bash -lc "$ALERT_COMMAND"
fi
write_state "$current_state"
exit 1
