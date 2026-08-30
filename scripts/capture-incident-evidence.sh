#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SPOOL_DIR="${INCIDENT_EVIDENCE_DIR:-/data/backups/oi-manager/incidents}"
SINCE_HOURS="${INCIDENT_SINCE_HOURS:-6}"
REASON="${INCIDENT_REASON:-manual_capture}"
LOCK_FILE="${INCIDENT_EVIDENCE_LOCK_FILE:-/tmp/oi-manager-incident-evidence.lock}"
KEEP_DAYS="${INCIDENT_EVIDENCE_KEEP_DAYS:-90}"

[[ "$SINCE_HOURS" =~ ^[1-9][0-9]*$ ]] || { echo 'INCIDENT_SINCE_HOURS must be positive' >&2; exit 2; }
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || { echo 'INCIDENT_EVIDENCE_KEEP_DAYS must be non-negative' >&2; exit 2; }
mkdir -p "$SPOOL_DIR"
chmod 700 "$SPOOL_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo 'Another incident evidence capture is already running' >&2; exit 2; }

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
host_label="$(hostname -f 2>/dev/null || hostname)"
incident_id="incident-${timestamp}-${host_label}"
work_dir="$(mktemp -d "$SPOOL_DIR/.incident.XXXXXX")"
archive_tmp="$SPOOL_DIR/.${incident_id}.tar.gz.tmp.$$"
archive="$SPOOL_DIR/${incident_id}.tar.gz"

cleanup() {
  rm -rf -- "$work_dir"
  rm -f -- "$archive_tmp"
}
trap cleanup EXIT INT TERM

run_privileged() {
  if [[ "$(id -u)" == 0 ]]; then "$@"; else sudo -n "$@"; fi
}

capture() {
  local output="$1"
  shift
  {
    printf '$'
    printf ' %q' "$@"
    printf '\n'
    "$@"
  } > "$output" 2>&1 || true
}

mkdir -p "$work_dir"/{host,services,journal,docker,application,configuration,backups,security}
safe_reason="$(printf '%s' "$REASON" | tr '\r\n' ' ' | cut -c1-240)"
{
  printf 'schema_version=1\n'
  printf 'incident_id=%s\n' "$incident_id"
  printf 'generated_at=%s\n' "$(date --iso-8601=seconds)"
  printf 'host=%s\n' "$host_label"
  printf 'since_hours=%s\n' "$SINCE_HOURS"
  printf 'reason=%s\n' "$safe_reason"
  printf 'git_commit=%s\n' "$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  printf 'web_build_id=%s\n' "$(cat "$ROOT_DIR/apps/web/.next-current/BUILD_ID" 2>/dev/null || echo unknown)"
  printf 'active_api=%s\n' "$(cat "$ROOT_DIR/.run/api-active-upstream" 2>/dev/null || echo unknown)"
} > "$work_dir/manifest.txt"

capture "$work_dir/host/uptime.txt" uptime
capture "$work_dir/host/memory.txt" free -h
capture "$work_dir/host/filesystems.txt" df -hT
capture "$work_dir/host/inodes.txt" df -hi
capture "$work_dir/host/sockets.txt" ss -ltnp
capture "$work_dir/host/processes.txt" ps -eo pid,ppid,user,stat,lstart,etime,%cpu,%mem,rss,comm --sort=-%cpu
capture "$work_dir/host/kernel.txt" uname -a
capture "$work_dir/host/reboots.txt" last -x -n 50

units=(
  oi-manager-api-router.service
  oi-manager-server@3302.service
  oi-manager-server@3303.service
  oi-manager-worker.service
  oi-manager-executor@1.service
  oi-manager-judge.service
  oi-manager-web.service
  docker.service
)
for unit in "${units[@]}"; do
  capture "$work_dir/services/${unit}.state" systemctl show "$unit" \
    --property=Id,LoadState,ActiveState,SubState,Result,NRestarts,ExecMainPID,ExecMainStatus,MemoryCurrent,TasksCurrent,ActiveEnterTimestamp
  run_privileged journalctl --no-pager --utc --since "$SINCE_HOURS hours ago" -u "$unit" \
    > "$work_dir/journal/${unit}.log" 2>&1 || true
done
run_privileged journalctl --no-pager --utc --since "$SINCE_HOURS hours ago" -u sshd.service -u ssh.service \
  > "$work_dir/security/ssh-journal.log" 2>&1 || true
run_privileged dmesg --ctime > "$work_dir/host/dmesg.log" 2>&1 || true

for container in oi-postgres oi-judge; do
  capture "$work_dir/docker/${container}.state" docker inspect --format \
    '{{.Name}} status={{.State.Status}} started={{.State.StartedAt}} restart={{.RestartCount}} image={{.Config.Image}}' "$container"
  docker logs --timestamps --since "${SINCE_HOURS}h" "$container" \
    > "$work_dir/docker/${container}.log" 2>&1 || true
done

capture "$work_dir/application/health.json" curl -fsS http://127.0.0.1:3002/api/health
capture "$work_dir/application/readiness.json" curl -fsS http://127.0.0.1:3002/api/readiness
capture "$work_dir/application/projection.json" bash -lc "cd '$ROOT_DIR' && pnpm --silent judge:projection:audit"
capture "$work_dir/application/slo.json" bash -lc "cd '$ROOT_DIR' && pnpm --silent judge:slo"
capture "$work_dir/application/operational-state.json" bash -lc "cd '$ROOT_DIR' && pnpm --silent operations:snapshot"
capture "$work_dir/security/runtime-audit.json" bash -lc "cd '$ROOT_DIR' && pnpm --silent security:audit"
capture "$work_dir/security/runtime-limits.json" bash -lc "cd '$ROOT_DIR' && pnpm --silent runtime:audit"
capture "$work_dir/security/network-exposure.json" bash -lc "cd '$ROOT_DIR' && pnpm --silent network:audit"

find "$ROOT_DIR/.run" -maxdepth 1 -type f \( -name 'metrics-*.json' -o -name 'operational-state.json' \) \
  -exec cp -- {} "$work_dir/application/" \; 2>/dev/null || true

active_api="$(cat "$ROOT_DIR/.run/api-active-upstream" 2>/dev/null || true)"
if [[ "$active_api" =~ ^[0-9]+$ ]] && [ -s "$ROOT_DIR/.run/metrics-${active_api}.json" ]; then
  cp -- "$ROOT_DIR/.run/metrics-${active_api}.json" "$work_dir/application/api-metrics.json"
else
  printf '{"status":"unavailable","reason":"active API metrics snapshot missing"}\n' \
    > "$work_dir/application/api-metrics.json"
fi
if [ -s "$ROOT_DIR/.run/judge-metrics.json" ]; then
  cp -- "$ROOT_DIR/.run/judge-metrics.json" "$work_dir/application/judge-metrics.json"
else
  printf '{"status":"unavailable","reason":"Judge metrics snapshot missing"}\n' \
    > "$work_dir/application/judge-metrics.json"
fi

find /etc/systemd/system -maxdepth 1 -type f -name 'oi-manager-*.service' -print0 2>/dev/null \
  | sort -z | xargs -0 -r sha256sum > "$work_dir/configuration/systemd.sha256"
find /etc/nginx/sites-enabled -maxdepth 1 -type f -print0 2>/dev/null \
  | sort -z | xargs -0 -r sha256sum > "$work_dir/configuration/nginx-sites.sha256"
find /data/backups/oi-manager/automatic -maxdepth 1 -type f -name 'oi_manager_*.dump' \
  -printf '%T@ %s %f\n' 2>/dev/null | sort -nr | head -n 20 > "$work_dir/backups/inventory.txt"
find /data/backups/oi-manager/assets/snapshots -mindepth 1 -maxdepth 1 -type d -name 'snapshot-*' \
  -printf '%T@ %f\n' 2>/dev/null | sort -nr | head -n 20 > "$work_dir/backups/asset-inventory.txt"
if [ -s /data/backups/oi-manager/automatic/restore-verification.json ]; then
  cp -- /data/backups/oi-manager/automatic/restore-verification.json "$work_dir/backups/restore-verification.json"
else
  printf '{"status":"unavailable","reason":"restore verification state missing"}\n' \
    > "$work_dir/backups/restore-verification.json"
fi
if [ -s /data/backups/oi-manager/assets/asset-restore-verification.json ]; then
  cp -- /data/backups/oi-manager/assets/asset-restore-verification.json "$work_dir/backups/asset-restore-verification.json"
else
  printf '{"status":"unavailable","reason":"asset restore verification state missing"}\n' \
    > "$work_dir/backups/asset-restore-verification.json"
fi
if [ -s /data/backups/oi-manager/security-baseline/security-baseline.json ]; then
  cp -- /data/backups/oi-manager/security-baseline/security-baseline.json "$work_dir/security/security-baseline.json"
else
  printf '{"status":"unavailable","reason":"security baseline state missing"}\n' \
    > "$work_dir/security/security-baseline.json"
fi

(cd "$work_dir" && find . -type f ! -name 'evidence.sha256' -print0 | sort -z | xargs -0 sha256sum > evidence.sha256)
tar -C "$work_dir" -czf "$archive_tmp" .
[[ -s "$archive_tmp" ]] || { echo 'Incident evidence archive is empty' >&2; exit 1; }
mv -- "$archive_tmp" "$archive"
chmod 600 "$archive"
sha256sum "$archive" > "$archive.sha256"
chmod 600 "$archive.sha256"

find "$SPOOL_DIR" -maxdepth 1 -type f -name 'incident-20??????T??????Z-*.tar.gz' -mtime "+$KEEP_DAYS" -delete
find "$SPOOL_DIR" -maxdepth 1 -type f -name 'incident-20??????T??????Z-*.tar.gz.sha256' -mtime "+$KEEP_DAYS" -delete

echo "Incident evidence captured: $archive"
