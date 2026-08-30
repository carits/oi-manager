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

node - "$TEST_ROOT" <<'NODE'
const fs = require('node:fs')
const root = process.argv[2]
const base = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  window: { startedAt: new Date(Date.now() - 60_000).toISOString(), durationSeconds: 60 },
  instance: { nodeEnv: 'production' },
  process: { rssBytes: 64 * 1024 * 1024, eventLoopDelayP99Ms: 10 },
}
fs.writeFileSync(`${root}/api-healthy.json`, JSON.stringify({ ...base, endpoints: [], runtimeEvents: { series: [], droppedSeries: 0 } }))
fs.writeFileSync(`${root}/api-unhealthy.json`, JSON.stringify({
  ...base,
  endpoints: [{ endpoint: 'GET:/api/test', count: 20, status5xx: 4, p99Ms: 7000 }],
  runtimeEvents: { series: [{ kind: 'error', action: 'failure', count: 11 }, { kind: 'warn', action: 'client_telemetry', count: 21 }], droppedSeries: 0 },
}))
fs.writeFileSync(`${root}/judge-unhealthy.json`, JSON.stringify({
  ...base,
  judgeId: 'unknown',
  connection: { connected: false, authenticated: false, lastMessageAt: null },
  counters: { 'task.submission.infrastructure_retry': 6 },
}))
NODE
node "$ROOT_DIR/scripts/validate-runtime-snapshot.mjs" api "$TEST_ROOT/api-healthy.json" >/dev/null
if node "$ROOT_DIR/scripts/validate-runtime-snapshot.mjs" api "$TEST_ROOT/api-unhealthy.json" >/dev/null 2>&1; then
  echo 'Unhealthy API snapshot passed validation' >&2
  exit 1
fi

cat > "$TEST_ROOT/listeners-safe.txt" <<'EOF'
LISTEN 0 511 127.0.0.1:5432 0.0.0.0:*
LISTEN 0 511 0.0.0.0:80 0.0.0.0:*
EOF
cat > "$TEST_ROOT/listeners-unsafe.txt" <<'EOF'
LISTEN 0 511 0.0.0.0:5432 0.0.0.0:*
EOF
NETWORK_AUDIT_INPUT_FILE="$TEST_ROOT/listeners-safe.txt" node "$ROOT_DIR/scripts/audit-network-exposure.mjs" >/dev/null
if NETWORK_AUDIT_INPUT_FILE="$TEST_ROOT/listeners-unsafe.txt" node "$ROOT_DIR/scripts/audit-network-exposure.mjs" >/dev/null 2>&1; then
  echo 'Public PostgreSQL listener passed the network exposure audit' >&2
  exit 1
fi
if node "$ROOT_DIR/scripts/validate-runtime-snapshot.mjs" judge "$TEST_ROOT/judge-unhealthy.json" >/dev/null 2>&1; then
  echo 'Unhealthy Judge snapshot passed validation' >&2
  exit 1
fi

mkdir -p "$TEST_ROOT/empty-backups"
if RESTORE_BACKUP_DIR="$TEST_ROOT/empty-backups" \
  RESTORE_VERIFICATION_STATE_FILE="$TEST_ROOT/empty-backups/restore-verification.json" \
  RESTORE_VERIFICATION_LOCK_FILE="$TEST_ROOT/empty-restore.lock" \
  "$ROOT_DIR/scripts/verify-backup-restore.sh" >/dev/null 2>&1; then
  echo 'Restore verification without a backup incorrectly succeeded' >&2
  exit 1
fi
node - "$TEST_ROOT/empty-backups/restore-verification.json" <<'NODE'
const fs = require('node:fs')
const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (state.status !== 'failed' || state.verifiedAt !== null) throw new Error(`Unexpected failed restore state: ${JSON.stringify(state)}`)
if ((fs.statSync(process.argv[2]).mode & 0o077) !== 0) throw new Error('Restore verification state is not private')
NODE

mkdir -p "$TEST_ROOT/tampered-backups"
printf 'not-a-real-dump\n' > "$TEST_ROOT/tampered-backups/oi_manager_20260829_000000.dump"
cat > "$TEST_ROOT/tampered-backups/oi_manager_20260829_000000.dump.manifest.json" <<'JSON'
{"schemaVersion":1,"backupName":"oi_manager_20260829_000000.dump","backupSha256":"0000000000000000000000000000000000000000000000000000000000000000","backupSize":16,"counts":{"tables":1,"migrations":1,"users":1,"problems":1,"submissions":1,"files":1,"testSetRevisions":1}}
JSON
if RESTORE_BACKUP_DIR="$TEST_ROOT/tampered-backups" \
  RESTORE_VERIFICATION_STATE_FILE="$TEST_ROOT/tampered-backups/restore-verification.json" \
  RESTORE_VERIFICATION_LOCK_FILE="$TEST_ROOT/tampered-restore.lock" \
  "$ROOT_DIR/scripts/verify-backup-restore.sh" >/dev/null 2>&1; then
  echo 'Tampered database backup incorrectly passed manifest validation' >&2
  exit 1
fi
grep -Fq '"status": "failed"' "$TEST_ROOT/tampered-backups/restore-verification.json"

mkdir -p "$TEST_ROOT/fake-bin" "$TEST_ROOT/fake-home/.config/oi-manager"
cron_capture="$TEST_ROOT/installed-crontab"
cat > "$TEST_ROOT/fake-bin/crontab" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == '-l' ]]; then exit 0; fi
cat > "$CRONTAB_CAPTURE"
SH
chmod 700 "$TEST_ROOT/fake-bin/crontab"
monitor_env="$TEST_ROOT/fake-home/.config/oi-manager/operations.env"
printf 'MONITOR_CLIENT_ERRORS_MAX=7\n' > "$monitor_env"
chmod 600 "$monitor_env"
CRONTAB_CAPTURE="$cron_capture" PATH="$TEST_ROOT/fake-bin:$PATH" HOME="$TEST_ROOT/fake-home" \
  MONITOR_ENV_FILE="$monitor_env" MONITOR_LOG_FILE="$TEST_ROOT/monitor-cron.log" \
  "$ROOT_DIR/scripts/install-monitor-cron.sh" >/dev/null
grep -Fq "set -a; . '$monitor_env'; set +a;" "$cron_capture"

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
  MONITOR_METRICS_CHECK=0 MONITOR_JUDGE_METRICS_CHECK=0 MONITOR_OPERATIONAL_STATE_CHECK=0 \
  MONITOR_JUDGE_SLO_CHECK=0 \
  MONITOR_SYSTEMD_CHECK=0 MONITOR_RESTORE_VERIFY_CHECK=0 MONITOR_ASSET_BACKUP_CHECK=0 \
  MONITOR_NETWORK_EXPOSURE_CHECK=0 \
  MONITOR_SECURITY_BASELINE_CHECK=0 \
  MONITOR_INCIDENT_CAPTURE_COMMAND= \
  MONITOR_STATE_FILE="$monitor_state" MONITOR_ALERT_COMMAND=/usr/bin/false \
  "$ROOT_DIR/scripts/monitor-services.sh" >/dev/null 2>&1; then
  echo 'Expected monitor failure was reported as healthy' >&2
  exit 1
fi
[[ ! -e "$monitor_state" ]]

scheduler_state="$TEST_ROOT/scheduler-monitor.state"
if MONITOR_SCHEDULER_CHECK=1 MONITOR_REQUIRED_OPERATION_TIMERS='missing-operation.timer' \
  MONITOR_METRICS_CHECK=0 MONITOR_JUDGE_METRICS_CHECK=0 MONITOR_OPERATIONAL_STATE_CHECK=0 \
  MONITOR_JUDGE_SLO_CHECK=0 MONITOR_SYSTEMD_CHECK=0 MONITOR_RESTORE_VERIFY_CHECK=0 \
  MONITOR_ASSET_BACKUP_CHECK=0 MONITOR_NETWORK_EXPOSURE_CHECK=0 MONITOR_SECURITY_BASELINE_CHECK=0 \
  MONITOR_INCIDENT_CAPTURE_COMMAND= MONITOR_STATE_FILE="$scheduler_state" \
  "$ROOT_DIR/scripts/monitor-services.sh" >/dev/null 2>&1; then
  echo 'Missing operation timer was reported as healthy' >&2
  exit 1
fi
grep -Fq 'operation-timer-disabled:missing-operation.timer' "$scheduler_state"

incident_capture="$TEST_ROOT/capture-incident.sh"
incident_result="$TEST_ROOT/incident-reason.txt"
cat > "$incident_capture" <<SH
#!/usr/bin/env bash
printf '%s\n' "\$INCIDENT_REASON" > '$incident_result'
SH
chmod 700 "$incident_capture"
incident_state="$TEST_ROOT/incident-monitor.state"
if MONITOR_API_URL='http://127.0.0.1:1/unavailable' \
  MONITOR_METRICS_CHECK=0 MONITOR_JUDGE_METRICS_CHECK=0 MONITOR_OPERATIONAL_STATE_CHECK=0 \
  MONITOR_JUDGE_SLO_CHECK=0 \
  MONITOR_SYSTEMD_CHECK=0 MONITOR_RESTORE_VERIFY_CHECK=0 MONITOR_ASSET_BACKUP_CHECK=0 \
  MONITOR_NETWORK_EXPOSURE_CHECK=0 \
  MONITOR_SECURITY_BASELINE_CHECK=0 \
  MONITOR_INCIDENT_CAPTURE_COMMAND="$incident_capture" MONITOR_STATE_FILE="$incident_state" \
  "$ROOT_DIR/scripts/monitor-services.sh" >/dev/null 2>&1; then
  echo 'Expected incident-capture monitor failure was reported as healthy' >&2
  exit 1
fi
grep -Fq 'monitor failure:' "$incident_result"
[[ -s "$incident_state" ]]

transition_capture="$TEST_ROOT/monitor-transitions.jsonl"
alert_command="$TEST_ROOT/capture-monitor-alert.sh"
cat > "$alert_command" <<SH
#!/usr/bin/env bash
MONITOR_ALERT_TEST_MODE=1 MONITOR_ALERT_CAPTURE_FILE='$transition_capture' \
  '$ROOT_DIR/scripts/send-monitor-alert.sh'
SH
chmod 700 "$alert_command"
if MONITOR_API_URL='http://127.0.0.1:1/unavailable' \
  MONITOR_METRICS_CHECK=0 MONITOR_JUDGE_METRICS_CHECK=0 MONITOR_OPERATIONAL_STATE_CHECK=0 \
  MONITOR_JUDGE_SLO_CHECK=0 \
  MONITOR_SYSTEMD_CHECK=0 MONITOR_RESTORE_VERIFY_CHECK=0 MONITOR_ASSET_BACKUP_CHECK=0 \
  MONITOR_NETWORK_EXPOSURE_CHECK=0 \
  MONITOR_SECURITY_BASELINE_CHECK=0 \
  MONITOR_INCIDENT_CAPTURE_COMMAND= \
  MONITOR_STATE_FILE="$monitor_state" MONITOR_ALERT_COMMAND="$alert_command" \
  "$ROOT_DIR/scripts/monitor-services.sh" >/dev/null 2>&1; then
  echo 'Expected monitor failure was reported as healthy' >&2
  exit 1
fi
# The detail text changed, but the failing check identity did not. This must
# not emit another incident transition or duplicate alert.
if MONITOR_API_URL='http://127.0.0.1:2/still-unavailable' \
  MONITOR_METRICS_CHECK=0 MONITOR_JUDGE_METRICS_CHECK=0 MONITOR_OPERATIONAL_STATE_CHECK=0 \
  MONITOR_JUDGE_SLO_CHECK=0 \
  MONITOR_SYSTEMD_CHECK=0 MONITOR_RESTORE_VERIFY_CHECK=0 MONITOR_ASSET_BACKUP_CHECK=0 \
  MONITOR_NETWORK_EXPOSURE_CHECK=0 \
  MONITOR_SECURITY_BASELINE_CHECK=0 \
  MONITOR_INCIDENT_CAPTURE_COMMAND= \
  MONITOR_STATE_FILE="$monitor_state" MONITOR_ALERT_COMMAND="$alert_command" \
  "$ROOT_DIR/scripts/monitor-services.sh" >/dev/null 2>&1; then
  echo 'Expected repeated monitor failure was reported as healthy' >&2
  exit 1
fi
MONITOR_STATE_FILE="$monitor_state" MONITOR_ALERT_COMMAND="$alert_command" MONITOR_QUIET_SUCCESS=1 \
  MONITOR_METRICS_CHECK=0 MONITOR_JUDGE_METRICS_CHECK=0 MONITOR_OPERATIONAL_STATE_CHECK=0 \
  MONITOR_JUDGE_SLO_CHECK=0 \
  MONITOR_SYSTEMD_CHECK=0 MONITOR_RESTORE_VERIFY_CHECK=0 MONITOR_ASSET_BACKUP_CHECK=0 \
  MONITOR_NETWORK_EXPOSURE_CHECK=0 \
  MONITOR_SECURITY_BASELINE_CHECK=0 \
  MONITOR_INCIDENT_CAPTURE_COMMAND= \
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
upload_command="$TEST_ROOT/upload-archive.sh"
verify_command="$TEST_ROOT/verify-archive.sh"
cat > "$upload_command" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
cp -- "$LOG_ARCHIVE_PATH" "$LOG_ARCHIVE_TEST_REMOTE/$LOG_ARCHIVE_NAME"
cp -- "$LOG_ARCHIVE_CHECKSUM_PATH" "$LOG_ARCHIVE_TEST_REMOTE/$LOG_ARCHIVE_NAME.sha256"
SH
cat > "$verify_command" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
remote_archive="$LOG_ARCHIVE_TEST_REMOTE/$LOG_ARCHIVE_NAME"
[[ -s "$remote_archive" ]]
[[ "$(stat -c '%s' "$remote_archive")" == "$LOG_ARCHIVE_SIZE" ]]
[[ "$(sha256sum "$remote_archive" | cut -d' ' -f1)" == "$LOG_ARCHIVE_SHA256" ]]
SH
chmod 700 "$upload_command" "$verify_command"
LOG_ARCHIVE_SPOOL_DIR="$TEST_ROOT/spool" \
LOG_ARCHIVE_LOCK_FILE="$TEST_ROOT/archive.lock" \
LOG_ARCHIVE_SINCE_HOURS=1 \
LOG_ARCHIVE_COMMAND="$upload_command" \
LOG_ARCHIVE_VERIFY_COMMAND="$verify_command" \
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
marker="$(find "$TEST_ROOT/spool" -maxdepth 1 -type f -name '*.tar.gz.uploaded' -print -quit)"
[[ -n "$marker" ]]

if LOG_ARCHIVE_SPOOL_DIR="$TEST_ROOT/failed-spool" \
  LOG_ARCHIVE_LOCK_FILE="$TEST_ROOT/failed-archive.lock" \
  LOG_ARCHIVE_SINCE_HOURS=1 \
  LOG_ARCHIVE_COMMAND="$upload_command" \
  LOG_ARCHIVE_VERIFY_COMMAND=/usr/bin/false \
  "$ROOT_DIR/scripts/archive-operations-logs.sh" >/dev/null 2>&1; then
  echo 'Expected remote verification failure was reported as success' >&2
  exit 1
fi
if find "$TEST_ROOT/failed-spool" -maxdepth 1 -type f -name '*.tar.gz.uploaded' -print -quit | grep -q .; then
  echo 'Remote verification failure incorrectly created an uploaded marker' >&2
  exit 1
fi

echo "Observability verification passed: rolling snapshot alerts, service transitions, incident capture, remote archive readback, and failure retention"
