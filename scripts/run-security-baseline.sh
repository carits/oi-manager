#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPORT_DIR="${SECURITY_BASELINE_DIR:-/data/backups/oi-manager/security-baseline}"
STATE_FILE="${SECURITY_BASELINE_STATE_FILE:-$REPORT_DIR/security-baseline.json}"
KEEP_DAYS="${SECURITY_BASELINE_KEEP_DAYS:-90}"
LOCK_FILE="${SECURITY_BASELINE_LOCK_FILE:-/tmp/oi-manager-security-baseline.lock}"
check_timeout_seconds="${SECURITY_BASELINE_CHECK_TIMEOUT_SECONDS:-600}"

[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || { echo 'SECURITY_BASELINE_KEEP_DAYS must be non-negative' >&2; exit 2; }
[[ "$check_timeout_seconds" =~ ^[1-9][0-9]*$ ]] || {
  echo 'SECURITY_BASELINE_CHECK_TIMEOUT_SECONDS must be a positive integer' >&2
  exit 2
}
mkdir -p "$REPORT_DIR"
chmod 700 "$REPORT_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo 'Another security baseline is already running; skipped'; exit 0; }

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
work_dir="$(mktemp -d "$REPORT_DIR/.security.XXXXXX")"
archive_tmp="$REPORT_DIR/.security-baseline-${timestamp}.tar.gz.tmp.$$"
archive="$REPORT_DIR/security-baseline-${timestamp}.tar.gz"
failures=()

cleanup() {
  rm -rf -- "$work_dir"
  rm -f -- "$archive_tmp"
}
trap cleanup EXIT INT TERM

run_check() {
  local name="$1"
  local status
  shift
  if (cd "$ROOT_DIR" && timeout --signal=TERM --kill-after=15s "${check_timeout_seconds}s" "$@") \
    > "$work_dir/${name}.log" 2>&1; then
    return
  else
    status=$?
    if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
      printf '\nCheck timed out after %s seconds (exit %s).\n' "$check_timeout_seconds" "$status" \
        >> "$work_dir/${name}.log"
    fi
    failures+=("$name")
  fi
}

run_check runtime-security pnpm --silent security:audit
run_check runtime-security-contract pnpm --silent security:verify
run_check secret-decryption pnpm --silent security:rotate:check
run_check network-exposure pnpm --silent network:audit
run_check runtime-limits env RUNTIME_AUDIT_REQUIRE_MONITOR_SUCCESS=0 pnpm --silent runtime:audit
run_check operation-timers pnpm --silent operations:timers:verify
run_check external-uptime-workflow pnpm --silent monitor:external:verify
run_check asset-backup-contract pnpm --silent backup:assets:test
run_check tls-tooling pnpm --silent tls:verify
run_check production-dependencies bash scripts/audit-production-dependencies.sh

{
  printf 'schema_version=1\n'
  printf 'generated_at=%s\n' "$(date --iso-8601=seconds)"
  printf 'git_commit=%s\n' "$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  printf 'failed_checks=%s\n' "$(IFS=,; echo "${failures[*]:-}")"
} > "$work_dir/manifest.txt"
(cd "$work_dir" && find . -type f ! -name evidence.sha256 -print0 | sort -z | xargs -0 sha256sum > evidence.sha256)
tar -C "$work_dir" -czf "$archive_tmp" .
mv -- "$archive_tmp" "$archive"
chmod 600 "$archive"
archive_sha="$(sha256sum "$archive" | cut -d' ' -f1)"
status=healthy
if [ "${#failures[@]}" -gt 0 ]; then status=failed; fi
failed_csv="$(IFS=,; echo "${failures[*]:-}")"

node - "$STATE_FILE" "$status" "$(basename "$archive")" "$archive_sha" "$failed_csv" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [file, status, reportName, reportSha256, failedCsv] = process.argv.slice(2)
const payload = {
  schemaVersion: 1,
  status,
  checkedAt: new Date().toISOString(),
  reportName,
  reportSha256,
  failedChecks: failedCsv ? failedCsv.split(',') : [],
}
const temporary = `${file}.next.${process.pid}`
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
fs.renameSync(temporary, file)
NODE

find "$REPORT_DIR" -maxdepth 1 -type f -name 'security-baseline-*.tar.gz' -mtime "+$KEEP_DAYS" -delete
if [ "$status" != healthy ]; then
  echo "Security baseline failed: $failed_csv (report: $archive)" >&2
  exit 1
fi
echo "Security baseline healthy: $archive sha256=$archive_sha"
