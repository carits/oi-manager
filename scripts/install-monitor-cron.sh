#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MONITOR_SCHEDULE="${MONITOR_SCHEDULE:-*/5 * * * *}"
LOG_FILE="${MONITOR_LOG_FILE:-/data/backups/oi-manager/monitor.log}"
ENV_FILE="${MONITOR_ENV_FILE:-$HOME/.config/oi-manager/operations.env}"

mkdir -p "$(dirname "$LOG_FILE")"
current="$(crontab -l 2>/dev/null || true)"
filtered="$(printf '%s\n' "$current" | grep -v '/scripts/monitor-services.sh' || true)"
env_prefix=""
if [[ -f "$ENV_FILE" ]]; then
  [[ -r "$ENV_FILE" ]] || { echo "Monitor environment is not readable: $ENV_FILE" >&2; exit 2; }
  permissions="$(stat -c '%a' "$ENV_FILE")"
  [[ "$permissions" == "600" || "$permissions" == "400" ]] || {
    echo "Monitor environment must have mode 600 or 400, got $permissions" >&2
    exit 2
  }
  [[ "$ENV_FILE" != *"'"* && "$ENV_FILE" != *$'\n'* ]] || { echo "Unsafe monitor environment path" >&2; exit 2; }
  env_prefix=". '$ENV_FILE' && "
fi
entry="$MONITOR_SCHEDULE ${env_prefix}MONITOR_QUIET_SUCCESS=1 $ROOT_DIR/scripts/monitor-services.sh >> $LOG_FILE 2>&1"

{
  printf '%s\n' "$filtered"
  printf '%s\n' "$entry"
} | sed '/^[[:space:]]*$/d' | crontab -

echo "Installed service monitor cron: $entry"
