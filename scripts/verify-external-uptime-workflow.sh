#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT_DIR/.github/workflows/external-uptime.yml"

[[ -s "$WORKFLOW" ]] || { echo 'External uptime workflow is missing' >&2; exit 1; }
ruby -e 'require "psych"; Psych.parse_file(ARGV.fetch(0))' "$WORKFLOW"

for required in \
  "cron: '*/5 * * * *'" \
  'workflow_dispatch:' \
  'issues: write' \
  'cancel-in-progress: false' \
  'continue-on-error: true' \
  'OI_MANAGER_PUBLIC_ORIGIN' \
  'probe_json' \
  '.schemaVersion == 1' \
  'probe_html' \
  'gh issue create' \
  'gh issue close' \
  "steps.probe.outcome == 'failure'"; do
  grep -Fq "$required" "$WORKFLOW" || { echo "External uptime workflow contract is missing: $required" >&2; exit 1; }
done

if grep -Fq ':3000/login' "$WORKFLOW"; then
  echo 'External uptime probe must use the single Nginx ingress, not public port 3000' >&2
  exit 1
fi

if grep -Fq 'secrets.' "$WORKFLOW"; then
  echo 'External uptime probe must not depend on repository secrets' >&2
  exit 1
fi

echo 'External uptime workflow verification passed: schedule, public probes and incident/recovery state machine'
