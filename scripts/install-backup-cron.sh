#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/data/backups/oi-manager/automatic}"
BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * *}"
LOG_FILE="${BACKUP_LOG_FILE:-$BACKUP_DIR/backup.log}"

mkdir -p "$BACKUP_DIR"
current="$(crontab -l 2>/dev/null || true)"
filtered="$(printf '%s\n' "$current" | grep -v '/scripts/backup-db.sh' || true)"
entry="$BACKUP_SCHEDULE BACKUP_DIR=$BACKUP_DIR $ROOT_DIR/scripts/backup-db.sh >> $LOG_FILE 2>&1"

{
  printf '%s\n' "$filtered"
  printf '%s\n' "$entry"
} | sed '/^[[:space:]]*$/d' | crontab -

echo "Installed database backup cron: $entry"
