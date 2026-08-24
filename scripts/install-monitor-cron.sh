#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MONITOR_SCHEDULE="${MONITOR_SCHEDULE:-*/5 * * * *}"
LOG_FILE="${MONITOR_LOG_FILE:-/data/backups/oi-manager/monitor.log}"

mkdir -p "$(dirname "$LOG_FILE")"
current="$(crontab -l 2>/dev/null || true)"
filtered="$(printf '%s\n' "$current" | grep -v '/scripts/monitor-services.sh' || true)"
entry="$MONITOR_SCHEDULE MONITOR_QUIET_SUCCESS=1 $ROOT_DIR/scripts/monitor-services.sh >> $LOG_FILE 2>&1"

{
  printf '%s\n' "$filtered"
  printf '%s\n' "$entry"
} | sed '/^[[:space:]]*$/d' | crontab -

echo "Installed service monitor cron: $entry"
