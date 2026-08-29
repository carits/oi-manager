#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE_SCHEDULE="${LOG_ARCHIVE_SCHEDULE:-15 4 * * *}"
LOG_FILE="${LOG_ARCHIVE_CRON_LOG:-/data/backups/oi-manager/log-archive.log}"
ENV_FILE="${LOG_ARCHIVE_ENV_FILE:-$HOME/.config/oi-manager/operations.env}"

[[ -f "$ENV_FILE" && -r "$ENV_FILE" ]] || { echo "Log archive environment is missing or unreadable: $ENV_FILE" >&2; exit 2; }
permissions="$(stat -c '%a' "$ENV_FILE")"
[[ "$permissions" == "600" || "$permissions" == "400" ]] || {
  echo "Log archive environment must have mode 600 or 400, got $permissions" >&2
  exit 2
}
[[ "$ENV_FILE" != *"'"* && "$ENV_FILE" != *$'\n'* ]] || { echo "Unsafe log archive environment path" >&2; exit 2; }

# Validate the configured command without printing its value.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
[[ -n "${LOG_ARCHIVE_COMMAND:-}" ]] || { echo "LOG_ARCHIVE_COMMAND is not configured" >&2; exit 2; }
[[ -n "${LOG_ARCHIVE_VERIFY_COMMAND:-}" ]] || { echo "LOG_ARCHIVE_VERIFY_COMMAND is not configured" >&2; exit 2; }
for command_path in "$LOG_ARCHIVE_COMMAND" "$LOG_ARCHIVE_VERIFY_COMMAND"; do
  [[ "$command_path" == /* && -f "$command_path" && -x "$command_path" ]] || {
    echo "Log archive commands must be absolute executable files" >&2
    exit 2
  }
done

mkdir -p "$(dirname "$LOG_FILE")"
chmod 700 "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"
current="$(crontab -l 2>/dev/null || true)"
filtered="$(printf '%s\n' "$current" | grep -v '/scripts/archive-operations-logs.sh' || true)"
entry="$ARCHIVE_SCHEDULE set -a; . '$ENV_FILE'; set +a; $ROOT_DIR/scripts/archive-operations-logs.sh >> $LOG_FILE 2>&1"
{
  printf '%s\n' "$filtered"
  printf '%s\n' "$entry"
} | sed '/^[[:space:]]*$/d' | crontab -

echo "Installed off-host log archive cron without printing credentials"
