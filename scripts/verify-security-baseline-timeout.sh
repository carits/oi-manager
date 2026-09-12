#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf -- "$test_dir"' EXIT INT TERM

mkdir -p "$test_dir/bin" "$test_dir/reports"
cat > "$test_dir/bin/pnpm" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = audit ]; then
  sleep 30
fi
exit 0
SH
chmod +x "$test_dir/bin/pnpm"

started_at="$(date +%s)"
set +e
PATH="$test_dir/bin:$PATH" \
  SECURITY_BASELINE_DIR="$test_dir/reports" \
  SECURITY_BASELINE_STATE_FILE="$test_dir/reports/state.json" \
  SECURITY_BASELINE_LOCK_FILE="$test_dir/security-baseline.lock" \
  SECURITY_BASELINE_CHECK_TIMEOUT_SECONDS=1 \
  bash "$ROOT_DIR/scripts/run-security-baseline.sh" > "$test_dir/output.log" 2>&1
status=$?
set -e
elapsed="$(( $(date +%s) - started_at ))"

[ "$status" -eq 1 ] || { echo "expected failed baseline, got exit $status" >&2; exit 1; }
[ "$elapsed" -lt 15 ] || { echo "timeout verification took ${elapsed}s" >&2; exit 1; }
node - "$test_dir/reports/state.json" <<'NODE'
const fs = require('node:fs')
const state = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (state.status !== 'failed') throw new Error(`unexpected status: ${state.status}`)
if (!state.failedChecks.includes('production-dependencies')) {
  throw new Error(`missing timed-out check: ${state.failedChecks.join(',')}`)
}
NODE

archive="$(find "$test_dir/reports" -maxdepth 1 -name 'security-baseline-*.tar.gz' -print -quit)"
[ -n "$archive" ] || { echo 'security baseline archive was not created' >&2; exit 1; }
tar -xOf "$archive" ./production-dependencies.log | grep -q 'Check timed out after 1 seconds'
echo 'Security baseline timeout verification passed'
