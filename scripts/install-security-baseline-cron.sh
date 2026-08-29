#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCHEDULE="${SECURITY_BASELINE_SCHEDULE:-0 5 * * 1}"
REPORT_DIR="${SECURITY_BASELINE_DIR:-/data/backups/oi-manager/security-baseline}"
LOG_FILE="${SECURITY_BASELINE_LOG_FILE:-$REPORT_DIR/security-baseline.log}"

mkdir -p "$REPORT_DIR"
chmod 700 "$REPORT_DIR"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"
current="$(crontab -l 2>/dev/null || true)"
filtered="$(printf '%s\n' "$current" | grep -v '/scripts/run-security-baseline.sh' || true)"
entry="$SCHEDULE SECURITY_BASELINE_DIR=$REPORT_DIR $ROOT_DIR/scripts/run-security-baseline.sh >> $LOG_FILE 2>&1"
{
  printf '%s\n' "$filtered"
  printf '%s\n' "$entry"
} | sed '/^[[:space:]]*$/d' | crontab -
echo "Installed security baseline cron: $entry"
