#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SPOOL_DIR="${LOG_ARCHIVE_SPOOL_DIR:-/data/backups/oi-manager/log-archive-spool}"
SINCE_HOURS="${LOG_ARCHIVE_SINCE_HOURS:-24}"
KEEP_DAYS="${LOG_ARCHIVE_KEEP_DAYS:-7}"
UPLOAD_COMMAND="${LOG_ARCHIVE_COMMAND:-}"
VERIFY_COMMAND="${LOG_ARCHIVE_VERIFY_COMMAND:-}"
LOCK_FILE="${LOG_ARCHIVE_LOCK_FILE:-/tmp/oi-manager-log-archive.lock}"

[[ "$SINCE_HOURS" =~ ^[1-9][0-9]*$ ]] || { echo "LOG_ARCHIVE_SINCE_HOURS must be positive" >&2; exit 2; }
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || { echo "LOG_ARCHIVE_KEEP_DAYS must be non-negative" >&2; exit 2; }
mkdir -p "$SPOOL_DIR"
chmod 700 "$SPOOL_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another log archive is already running; skipped"
  exit 0
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
host_label="$(hostname -f 2>/dev/null || hostname)"
work_dir="$(mktemp -d "$SPOOL_DIR/.collect.XXXXXX")"
archive_tmp="$SPOOL_DIR/.oi-manager-logs-${host_label}-${timestamp}.tar.gz.tmp.$$"
archive="$SPOOL_DIR/oi-manager-logs-${host_label}-${timestamp}.tar.gz"

cleanup() {
  rm -rf -- "$work_dir"
  rm -f -- "$archive_tmp"
}
trap cleanup EXIT

run_privileged() {
  if [[ "$(id -u)" == "0" ]]; then "$@"; else sudo -n "$@"; fi
}

mkdir -p "$work_dir/journal" "$work_dir/docker" "$work_dir/nginx" "$work_dir/local"
units=(
  oi-manager-api-router.service
  oi-manager-server@3302.service
  oi-manager-server@3303.service
  oi-manager-worker.service
  oi-manager-executor@1.service
  oi-manager-judge.service
  oi-manager-web.service
)
for unit in "${units[@]}"; do
  run_privileged journalctl --no-pager --utc --since "$SINCE_HOURS hours ago" -u "$unit" \
    > "$work_dir/journal/${unit}.log" 2>&1 || true
done

for container in oi-postgres oi-judge; do
  docker logs --timestamps --since "${SINCE_HOURS}h" "$container" \
    > "$work_dir/docker/${container}.log" 2>&1 || true
done

for source in /var/log/nginx/access.log /var/log/nginx/error.log; do
  if run_privileged test -f "$source"; then
    run_privileged tail -n 20000 "$source" > "$work_dir/nginx/$(basename "$source")" 2>&1 || true
  fi
done

for source in \
  /data/backups/oi-manager/monitor.log \
  /data/backups/oi-manager/automatic/backup.log \
  "$ROOT_DIR/.run/oi-web-canary.log"; do
  if [[ -f "$source" ]]; then tail -n 20000 "$source" > "$work_dir/local/$(basename "$source")"; fi
done

{
  printf 'generated_at=%s\n' "$(date --iso-8601=seconds)"
  printf 'host=%s\n' "$host_label"
  printf 'since_hours=%s\n' "$SINCE_HOURS"
  printf 'git_commit=%s\n' "$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  printf 'web_build_id=%s\n' "$(cat "$ROOT_DIR/apps/web/.next-current/BUILD_ID" 2>/dev/null || echo unknown)"
} > "$work_dir/manifest.txt"

tar -C "$work_dir" -czf "$archive_tmp" .
[[ -s "$archive_tmp" ]] || { echo "Log archive is empty" >&2; exit 1; }
mv -- "$archive_tmp" "$archive"
sha256sum "$archive" > "$archive.sha256"
chmod 600 "$archive" "$archive.sha256"

if [[ -z "$UPLOAD_COMMAND" ]]; then
  echo "Log archive retained locally but no LOG_ARCHIVE_COMMAND is configured: $archive" >&2
  exit 2
fi
if [[ -z "$VERIFY_COMMAND" ]]; then
  echo "Log archive retained locally but no LOG_ARCHIVE_VERIFY_COMMAND is configured: $archive" >&2
  exit 2
fi

validate_trusted_executable() {
  local label="$1"
  local command_path="$2"
  if [[ "$command_path" != /* || ! -f "$command_path" || ! -x "$command_path" ]]; then
    echo "$label must be an absolute executable file: $command_path" >&2
    exit 2
  fi
}

validate_trusted_executable LOG_ARCHIVE_COMMAND "$UPLOAD_COMMAND"
validate_trusted_executable LOG_ARCHIVE_VERIFY_COMMAND "$VERIFY_COMMAND"

export LOG_ARCHIVE_PATH="$archive"
export LOG_ARCHIVE_CHECKSUM_PATH="$archive.sha256"
export LOG_ARCHIVE_SHA256="$(cut -d' ' -f1 "$archive.sha256")"
export LOG_ARCHIVE_SIZE="$(stat -c '%s' "$archive")"
export LOG_ARCHIVE_HOST="$host_label"
export LOG_ARCHIVE_NAME="$(basename "$archive")"

"$UPLOAD_COMMAND"
"$VERIFY_COMMAND"
touch "$archive.uploaded"

find "$SPOOL_DIR" -maxdepth 1 -type f -name 'oi-manager-logs-*.tar.gz.uploaded' -mtime "+$KEEP_DAYS" -print0 | while IFS= read -r -d '' marker; do
  uploaded_archive="${marker%.uploaded}"
  rm -f -- "$marker" "$uploaded_archive" "$uploaded_archive.sha256"
done

echo "Log archive uploaded and independently verified remotely: $archive"
