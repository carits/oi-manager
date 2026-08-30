#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="$ROOT_DIR/deploy/systemd"

bash -n "$ROOT_DIR/scripts/run-operation-task.sh" "$ROOT_DIR/scripts/install-operation-timers.sh"
if "$ROOT_DIR/scripts/run-operation-task.sh" unsupported-task >/dev/null 2>&1; then
  echo 'Operation dispatcher accepted an unsupported task' >&2
  exit 1
fi

units=(
  "$UNIT_DIR/oi-manager-operations@.service"
  "$UNIT_DIR/oi-manager-monitor.timer"
  "$UNIT_DIR/oi-manager-backup-db.timer"
  "$UNIT_DIR/oi-manager-backup-assets.timer"
  "$UNIT_DIR/oi-manager-verify-db.timer"
  "$UNIT_DIR/oi-manager-verify-assets.timer"
  "$UNIT_DIR/oi-manager-security-baseline.timer"
  "$UNIT_DIR/oi-manager-log-archive.timer"
)
systemd-analyze verify "${units[@]}"

for timer in "${units[@]:1}"; do
  grep -Fqx 'Persistent=true' "$timer"
  grep -Eq '^Unit=oi-manager-operations@[-a-z]+\.service$' "$timer"
done
grep -Fqx 'ReadOnlyPaths=/data/oi-manager-response-refactor' "$UNIT_DIR/oi-manager-operations@.service"
grep -Fqx 'ReadWritePaths=/data/oi-manager-response-refactor/.run /data/backups/oi-manager' "$UNIT_DIR/oi-manager-operations@.service"
grep -Fq 'Wants=network-online.target docker.service' "$UNIT_DIR/oi-manager-operations@.service"
if grep -Fq 'Requires=docker.service' "$UNIT_DIR/oi-manager-operations@.service"; then
  echo 'Monitor operations must not require Docker to start' >&2
  exit 1
fi

echo 'Operation timer verification passed: allowlisted dispatcher, persistent schedules and sandboxed service'
