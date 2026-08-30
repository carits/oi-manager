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
INODE_MAX_PERCENT="${MONITOR_INODE_MAX_PERCENT:-85}"
STATE_FILE="${MONITOR_STATE_FILE:-$ROOT_DIR/.run/service-monitor.state}"
QUIET_SUCCESS="${MONITOR_QUIET_SUCCESS:-0}"
ALERT_COMMAND="${MONITOR_ALERT_COMMAND:-}"
JUDGE_PROJECTION_CHECK="${MONITOR_JUDGE_PROJECTION_CHECK:-1}"
JUDGE_SLO_CHECK="${MONITOR_JUDGE_SLO_CHECK:-1}"
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
SYSTEMD_CHECK="${MONITOR_SYSTEMD_CHECK:-1}"
REQUIRED_NODE_ENV="${MONITOR_REQUIRED_NODE_ENV:-production}"
SERVICE_RESTART_MAX_DELTA="${MONITOR_SERVICE_RESTART_MAX_DELTA:-3}"
RESTART_STATE_FILE="${MONITOR_RESTART_STATE_FILE:-$ROOT_DIR/.run/service-restarts.state}"
RESTORE_VERIFY_CHECK="${MONITOR_RESTORE_VERIFY_CHECK:-1}"
RESTORE_VERIFY_STATE_FILE="${MONITOR_RESTORE_VERIFY_STATE_FILE:-$BACKUP_DIR/restore-verification.json}"
RESTORE_VERIFY_MAX_AGE_HOURS="${MONITOR_RESTORE_VERIFY_MAX_AGE_HOURS:-192}"
ASSET_BACKUP_CHECK="${MONITOR_ASSET_BACKUP_CHECK:-1}"
ASSET_BACKUP_DIR="${MONITOR_ASSET_BACKUP_DIR:-/data/backups/oi-manager/assets}"
ASSET_BACKUP_MAX_AGE_HOURS="${MONITOR_ASSET_BACKUP_MAX_AGE_HOURS:-26}"
ASSET_RESTORE_STATE_FILE="${MONITOR_ASSET_RESTORE_STATE_FILE:-$ASSET_BACKUP_DIR/asset-restore-verification.json}"
ASSET_RESTORE_MAX_AGE_HOURS="${MONITOR_ASSET_RESTORE_MAX_AGE_HOURS:-192}"
NETWORK_EXPOSURE_CHECK="${MONITOR_NETWORK_EXPOSURE_CHECK:-1}"
SECURITY_BASELINE_CHECK="${MONITOR_SECURITY_BASELINE_CHECK:-1}"
SECURITY_BASELINE_DIR="${MONITOR_SECURITY_BASELINE_DIR:-/data/backups/oi-manager/security-baseline}"
SECURITY_BASELINE_STATE_FILE="${MONITOR_SECURITY_BASELINE_STATE_FILE:-$SECURITY_BASELINE_DIR/security-baseline.json}"
SECURITY_BASELINE_MAX_AGE_HOURS="${MONITOR_SECURITY_BASELINE_MAX_AGE_HOURS:-192}"
INCIDENT_CAPTURE_COMMAND="${MONITOR_INCIDENT_CAPTURE_COMMAND:-$ROOT_DIR/scripts/capture-incident-evidence.sh}"
LOCK_FILE="${MONITOR_LOCK_FILE:-/tmp/oi-manager-service-monitor.lock}"

exec 9>"$LOCK_FILE"
flock -n 9 || { echo "[$(date --iso-8601=seconds)] service monitor already running; skipped"; exit 0; }

failures=()
failure_codes=()
restart_state_lines=()

write_state() {
  local value="$1"
  local temp="${STATE_FILE}.next.$$"
  printf '%s\n' "$value" > "$temp"
  chmod 600 "$temp"
  mv -- "$temp" "$STATE_FILE"
}

fail() {
  local code="$1"
  shift
  failure_codes+=("$code")
  failures+=("$*")
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
    fail "http-unavailable:$name" "$name unavailable ($url): $body"
    return
  fi
  if [ -n "$expected_text" ] && ! grep -Fq "$expected_text" <<<"$body"; then
    fail "http-content:$name" "$name returned unexpected content ($url)"
  fi
}

check_disk() {
  local mount="$1"
  local usage
  usage="$(df -P "$mount" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  if ! [[ "$usage" =~ ^[0-9]+$ ]]; then
    fail "disk-read:$mount" "cannot read disk usage for $mount"
  elif [ "$usage" -ge "$DISK_MAX_PERCENT" ]; then
    fail "disk-usage:$mount" "disk usage for $mount is ${usage}% (limit ${DISK_MAX_PERCENT}%)"
  fi
}

check_inodes() {
  local mount="$1"
  local usage
  usage="$(df -Pi "$mount" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  if ! [[ "$usage" =~ ^[0-9]+$ ]]; then
    fail "inode-read:$mount" "cannot read inode usage for $mount"
  elif [ "$usage" -ge "$INODE_MAX_PERCENT" ]; then
    fail "inode-usage:$mount" "inode usage for $mount is ${usage}% (limit ${INODE_MAX_PERCENT}%)"
  fi
}

check_unit() {
  local unit="$1"
  if ! systemctl is-active --quiet "$unit"; then
    fail "systemd-inactive:$unit" "systemd unit is not active: $unit"
  fi
  local current previous delta main_pid node_env
  main_pid="$(systemctl show "$unit" --property=MainPID --value 2>/dev/null || echo 0)"
  if [[ "$main_pid" =~ ^[1-9][0-9]*$ ]] && [ -r "/proc/$main_pid/environ" ]; then
    node_env="$(xargs -0 -n1 -a "/proc/$main_pid/environ" 2>/dev/null | awk -F= '$1 == "NODE_ENV" { print $2; exit }')"
    if [ "$node_env" != "$REQUIRED_NODE_ENV" ]; then
      fail "systemd-node-env:$unit" "systemd unit NODE_ENV is ${node_env:-missing}, expected $REQUIRED_NODE_ENV: $unit"
    fi
  else
    fail "systemd-main-process:$unit" "systemd unit has no readable main process: $unit"
  fi
  current="$(systemctl show "$unit" --property=NRestarts --value 2>/dev/null || echo 0)"
  [[ "$current" =~ ^[0-9]+$ ]] || current=0
  previous="$(awk -v unit="$unit" '$1 == unit { print $2 }' "$RESTART_STATE_FILE" 2>/dev/null || true)"
  if [[ "$previous" =~ ^[0-9]+$ ]] && [ "$current" -ge "$previous" ]; then
    delta="$((current - previous))"
    if [ "$delta" -gt "$SERVICE_RESTART_MAX_DELTA" ]; then
      fail "systemd-restarts:$unit" "systemd unit restarted ${delta} times since last check: $unit"
    fi
  fi
  restart_state_lines+=("$unit $current")
}

write_restart_state() {
  local temporary="${RESTART_STATE_FILE}.next.$$"
  mkdir -p "$(dirname "$RESTART_STATE_FILE")"
  printf '%s\n' "${restart_state_lines[@]}" > "$temporary"
  chmod 600 "$temporary"
  mv -- "$temporary" "$RESTART_STATE_FILE"
}

check_restore_verification() {
  local output
  if [ ! -s "$RESTORE_VERIFY_STATE_FILE" ]; then
    fail "database-restore-state-missing" "database restore verification state is missing: $RESTORE_VERIFY_STATE_FILE"
    return
  fi
  if ! output="$(node - "$RESTORE_VERIFY_STATE_FILE" "$RESTORE_VERIFY_MAX_AGE_HOURS" "$BACKUP_DIR" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const [file, maxAgeHours, backupDir] = process.argv.slice(2)
const state = JSON.parse(fs.readFileSync(file, 'utf8'))
const ageHours = (Date.now() - Date.parse(state.verifiedAt || state.checkedAt)) / 3_600_000
if (state.status !== 'healthy') throw new Error(`status=${state.status}`)
if (Number(state.schemaVersion || 0) < 2) throw new Error(`schemaVersion=${state.schemaVersion || 'missing'}`)
if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > Number(maxAgeHours)) throw new Error(`age=${ageHours.toFixed(1)}h`)
if (!/^[a-f0-9]{64}$/.test(state.backupSha256 || '')) throw new Error('backupSha256=invalid')
if (!state.backupName || path.basename(state.backupName) !== state.backupName) throw new Error('backupName=invalid')
const backupPath = path.join(backupDir, state.backupName)
if (!fs.existsSync(backupPath)) throw new Error('verifiedBackup=missing')
const actualHash = crypto.createHash('sha256').update(fs.readFileSync(backupPath)).digest('hex')
if (actualHash !== state.backupSha256) throw new Error('verifiedBackup=hash-mismatch')
const manifestPath = `${backupPath}.manifest.json`
if (!fs.existsSync(manifestPath)) throw new Error('verifiedManifest=missing')
const manifestHash = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex')
if (manifestHash !== state.manifestSha256) throw new Error('verifiedManifest=hash-mismatch')
console.log(`age=${ageHours.toFixed(1)}h backup=${state.backupName}`)
NODE
  )"; then
    fail "database-restore-invalid" "database restore verification failed: ${output:-validation error}"
  fi
}

check_asset_backup_and_restore() {
  local output
  if ! output="$(node - "$ASSET_BACKUP_DIR" "$ASSET_BACKUP_MAX_AGE_HOURS" "$ASSET_RESTORE_STATE_FILE" "$ASSET_RESTORE_MAX_AGE_HOURS" "$BACKUP_DIR" <<'NODE'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const [backupDir, backupMaxAgeHours, restoreStateFile, restoreMaxAgeHours, databaseBackupDir] = process.argv.slice(2)
const snapshotDir = path.join(backupDir, 'snapshots')
const names = fs.readdirSync(snapshotDir, { withFileTypes: true })
  .filter(item => item.isDirectory() && /^snapshot-20\d{6}T\d{6}Z(?:-\d+)?$/.test(item.name))
  .map(item => ({ name: item.name, mtimeMs: fs.statSync(path.join(snapshotDir, item.name)).mtimeMs }))
  .sort((left, right) => left.mtimeMs - right.mtimeMs)
if (!names.length) throw new Error('snapshot=missing')
const snapshotName = names.at(-1).name
const snapshot = path.join(snapshotDir, snapshotName)
const metadata = JSON.parse(fs.readFileSync(path.join(snapshot, 'metadata.json'), 'utf8'))
const ageHours = (Date.now() - Date.parse(metadata.createdAt)) / 3_600_000
if (metadata.status !== 'complete' || metadata.snapshotName !== snapshotName) throw new Error('snapshot=invalid')
if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > Number(backupMaxAgeHours)) throw new Error(`snapshotAge=${ageHours.toFixed(1)}h`)
const manifest = fs.readFileSync(path.join(snapshot, 'manifest.sha256'))
const manifestSha = crypto.createHash('sha256').update(manifest).digest('hex')
if (manifestSha !== metadata.manifestSha256) throw new Error('snapshotManifest=hash-mismatch')
const linksManifest = fs.readFileSync(path.join(snapshot, 'links.manifest'))
const linksSha = crypto.createHash('sha256').update(linksManifest).digest('hex')
if (linksSha !== metadata.linksSha256) throw new Error('snapshotLinks=hash-mismatch')
if (!metadata.databaseBackupName || path.basename(metadata.databaseBackupName) !== metadata.databaseBackupName) throw new Error('databaseBackup=invalid')
const databaseBackup = path.join(databaseBackupDir, metadata.databaseBackupName)
if (!fs.existsSync(databaseBackup)) throw new Error('databaseBackup=missing')
const databaseSha = crypto.createHash('sha256').update(fs.readFileSync(databaseBackup)).digest('hex')
if (databaseSha !== metadata.databaseBackupSha256) throw new Error('databaseBackup=hash-mismatch')
const databaseManifestPath = `${databaseBackup}.manifest.json`
if (!fs.existsSync(databaseManifestPath)) throw new Error('databaseManifest=missing')
const databaseManifestBytes = fs.readFileSync(databaseManifestPath)
const databaseManifestSha = crypto.createHash('sha256').update(databaseManifestBytes).digest('hex')
if (!/^[a-f0-9]{64}$/.test(metadata.databaseManifestSha256 || '') || databaseManifestSha !== metadata.databaseManifestSha256) {
  throw new Error('databaseManifest=hash-mismatch')
}
const databaseManifest = JSON.parse(databaseManifestBytes.toString('utf8'))
if (databaseManifest.schemaVersion !== 1 || databaseManifest.backupName !== metadata.databaseBackupName ||
    databaseManifest.backupSha256 !== metadata.databaseBackupSha256 || Number(databaseManifest.backupSize) !== fs.statSync(databaseBackup).size) {
  throw new Error('databaseManifest=identity-mismatch')
}

const state = JSON.parse(fs.readFileSync(restoreStateFile, 'utf8'))
const restoreAge = (Date.now() - Date.parse(state.verifiedAt || state.checkedAt)) / 3_600_000
if (state.status !== 'healthy') throw new Error(`restoreStatus=${state.status}`)
if (Number(state.schemaVersion || 0) < 2) throw new Error(`restoreSchemaVersion=${state.schemaVersion || 'missing'}`)
if (!Number.isFinite(restoreAge) || restoreAge < 0 || restoreAge > Number(restoreMaxAgeHours)) throw new Error(`restoreAge=${restoreAge.toFixed(1)}h`)
const restoredSnapshot = path.join(snapshotDir, state.snapshotName || '')
if (!fs.existsSync(restoredSnapshot)) throw new Error('restoredSnapshot=missing')
const restoredManifestSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(restoredSnapshot, 'manifest.sha256'))).digest('hex')
if (restoredManifestSha !== state.manifestSha256) throw new Error('restoredManifest=hash-mismatch')
const restoredMetadata = JSON.parse(fs.readFileSync(path.join(restoredSnapshot, 'metadata.json'), 'utf8'))
if (state.databaseBackupName !== restoredMetadata.databaseBackupName ||
    state.databaseBackupSha256 !== restoredMetadata.databaseBackupSha256 ||
    state.databaseManifestSha256 !== restoredMetadata.databaseManifestSha256) {
  throw new Error('restoredDatabasePair=identity-mismatch')
}
console.log(`snapshot=${snapshotName} age=${ageHours.toFixed(1)}h files=${metadata.fileCount} restoreAge=${restoreAge.toFixed(1)}h`)
NODE
  )"; then
    fail "asset-backup-restore-invalid" "asset backup or restore verification failed: ${output:-validation error}"
  fi
}

check_security_baseline() {
  local output
  if [ ! -s "$SECURITY_BASELINE_STATE_FILE" ]; then
    fail "security-baseline-state-missing" "security baseline state is missing: $SECURITY_BASELINE_STATE_FILE"
    return
  fi
  if ! output="$(node - "$SECURITY_BASELINE_STATE_FILE" "$SECURITY_BASELINE_MAX_AGE_HOURS" "$SECURITY_BASELINE_DIR" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const [file, maxAgeHours, reportDir] = process.argv.slice(2)
const state = JSON.parse(fs.readFileSync(file, 'utf8'))
const ageHours = (Date.now() - Date.parse(state.checkedAt)) / 3_600_000
if (state.status !== 'healthy') throw new Error(`status=${state.status} failed=${(state.failedChecks || []).join(',')}`)
if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > Number(maxAgeHours)) throw new Error(`age=${ageHours.toFixed(1)}h`)
if (!state.reportName || path.basename(state.reportName) !== state.reportName) throw new Error('reportName=invalid')
if (!/^[a-f0-9]{64}$/.test(state.reportSha256 || '')) throw new Error('reportSha256=invalid')
const reportPath = path.join(reportDir, state.reportName)
if (!fs.existsSync(reportPath)) throw new Error('report=missing')
const actualHash = crypto.createHash('sha256').update(fs.readFileSync(reportPath)).digest('hex')
if (actualHash !== state.reportSha256) throw new Error('report=hash-mismatch')
console.log(`age=${ageHours.toFixed(1)}h report=${state.reportName}`)
NODE
  )"; then
    fail "security-baseline-invalid" "security baseline failed: ${output:-validation error}"
  fi
}

check_metrics_snapshot() {
  local active_port metrics_file output
  active_port="$(cat "$ROOT_DIR/.run/api-active-upstream" 2>/dev/null || echo 3002)"
  metrics_file="$ROOT_DIR/.run/metrics-${active_port}.json"
  if [ ! -s "$metrics_file" ]; then
    fail "api-metrics-missing" "API metrics snapshot is missing: $metrics_file"
    return
  fi
  if ! output="$(node "$ROOT_DIR/scripts/validate-runtime-snapshot.mjs" api "$metrics_file" 2>&1)"; then
    fail "api-metrics-invalid" "API metrics snapshot failed: ${output:-validation error}"
  fi
}

check_judge_metrics_snapshot() {
  local metrics_file="$ROOT_DIR/.run/judge-metrics.json"
  local output
  if [ ! -s "$metrics_file" ]; then
    fail "judge-metrics-missing" "Judge metrics snapshot is missing: $metrics_file"
    return
  fi
  if ! output="$(node "$ROOT_DIR/scripts/validate-runtime-snapshot.mjs" judge "$metrics_file" 2>&1)"; then
    fail "judge-metrics-invalid" "Judge metrics snapshot failed: ${output:-validation error}"
  fi
}

check_http "preview" "$WEB_URL"
if [ -n "$HMR_URL" ]; then
  check_http "HMR" "$HMR_URL"
fi
check_http "API" "$API_URL" '"status":"ok"'
check_http "go-judge" "$JUDGE_URL"

if [ "$SYSTEMD_CHECK" = "1" ]; then
  active_api_port="$(cat "$ROOT_DIR/.run/api-active-upstream" 2>/dev/null || true)"
  check_unit oi-manager-web.service
  check_unit oi-manager-api-router.service
  check_unit oi-manager-worker.service
  check_unit oi-manager-executor@1.service
  check_unit oi-manager-judge.service
  if [[ "$active_api_port" =~ ^330[23]$ ]]; then
    check_unit "oi-manager-server@${active_api_port}.service"
  else
    fail "active-api-slot-invalid" "active API slot is invalid: ${active_api_port:-missing}"
  fi
  write_restart_state
fi

if ! docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
  fail "postgres-readiness" "PostgreSQL is not ready in $DB_CONTAINER"
fi

if [ "$NETWORK_EXPOSURE_CHECK" = "1" ]; then
  if ! network_output="$(node "$ROOT_DIR/scripts/audit-network-exposure.mjs" 2>&1)"; then
    network_summary="$(tail -n 20 <<<"$network_output" | tr '\n' ' ' | cut -c1-1200)"
    fail "network-exposure" "Network exposure audit failed: $network_summary"
  fi
fi

if [ "$JUDGE_PROJECTION_CHECK" = "1" ]; then
  if ! projection_output="$(cd "$ROOT_DIR" && pnpm --silent judge:projection:check 2>&1)"; then
    projection_summary="$(tail -n 20 <<<"$projection_output" | tr '\n' ' ' | cut -c1-1200)"
    fail "judge-projection" "JudgeRun/Submission projection mismatch: $projection_summary"
  fi
fi

if [ "$JUDGE_SLO_CHECK" = "1" ]; then
  if ! slo_output="$(cd "$ROOT_DIR" && pnpm --silent judge:slo 2>&1)"; then
    slo_summary="$(tail -n 30 <<<"$slo_output" | tr '\n' ' ' | cut -c1-1600)"
    fail "judge-slo" "Judge SLO violated: $slo_summary"
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
    fail "operational-state" "Operational state degraded: $operational_summary"
  fi
fi

if [ "$RESTORE_VERIFY_CHECK" = "1" ]; then
  check_restore_verification
fi

if [ "$ASSET_BACKUP_CHECK" = "1" ]; then
  check_asset_backup_and_restore
fi

if [ "$SECURITY_BASELINE_CHECK" = "1" ]; then
  check_security_baseline
fi

build_id_file="$ROOT_DIR/apps/web/.next-current/BUILD_ID"
if [ ! -s "$build_id_file" ]; then
  fail "web-build-id-missing" "current preview BUILD_ID is missing"
else
  build_id="$(cat "$build_id_file")"
  manifest_url="$WEB_ORIGIN/_next/static/$build_id/_buildManifest.js"
  check_http "preview build $build_id" "$manifest_url"
fi

newest_backup="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}_*.dump" -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 || true)"
if [ -z "$newest_backup" ]; then
  fail "database-backup-missing" "no automatic database backup found in $BACKUP_DIR"
else
  newest_epoch="${newest_backup%% *}"
  newest_epoch="${newest_epoch%.*}"
  max_age_seconds="$((BACKUP_MAX_AGE_HOURS * 3600))"
  age_seconds="$(( $(date +%s) - newest_epoch ))"
  if [ "$age_seconds" -gt "$max_age_seconds" ]; then
    fail "database-backup-stale" "latest database backup is older than ${BACKUP_MAX_AGE_HOURS}h"
  fi
fi

check_disk /
check_inodes /
if [ -d /data ]; then
  check_disk /data
  check_inodes /data
fi

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
failure_fingerprint="$(printf '%s\n' "${failure_codes[@]}" | LC_ALL=C sort -u | paste -sd, -)"
current_state="failed:$failure_fingerprint"
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
