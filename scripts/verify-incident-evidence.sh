#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT INT TERM

INCIDENT_EVIDENCE_DIR="$TEST_ROOT/spool" \
INCIDENT_EVIDENCE_LOCK_FILE="$TEST_ROOT/incident.lock" \
INCIDENT_SINCE_HOURS=1 \
INCIDENT_REASON='verification capture' \
  "$ROOT_DIR/scripts/capture-incident-evidence.sh"

archive="$(find "$TEST_ROOT/spool" -maxdepth 1 -type f -name 'incident-*.tar.gz' -print -quit)"
[[ -n "$archive" && -s "$archive" ]]
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
[[ "$(stat -c '%a' "$archive")" == 600 ]]

tar -tzf "$archive" > "$TEST_ROOT/list.txt"
for required in \
  ./manifest.txt \
  ./evidence.sha256 \
  ./application/readiness.json \
  ./application/projection.json \
  ./application/operational-state.json \
  ./application/api-metrics.json \
  ./application/judge-metrics.json \
  ./security/runtime-audit.json \
  ./services/oi-manager-judge.service.state; do
  grep -Fxq "$required" "$TEST_ROOT/list.txt"
done

if grep -Ei '(^|/)(\.env|.*cookie.*|.*secret.*|.*token.*|id_rsa|id_ed25519)(/|$)' "$TEST_ROOT/list.txt"; then
  echo 'Incident evidence archive contains a forbidden secret-bearing path' >&2
  exit 1
fi

mkdir -p "$TEST_ROOT/extracted"
tar -xzf "$archive" -C "$TEST_ROOT/extracted"
(cd "$TEST_ROOT/extracted" && sha256sum -c evidence.sha256 >/dev/null)

echo 'Incident evidence verification passed: required diagnostics, checksums and secret-path exclusion'
