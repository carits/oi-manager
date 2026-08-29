#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/data/backups/oi-manager/automatic}"
BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * *}"
BACKUP_VERIFY_SCHEDULE="${BACKUP_VERIFY_SCHEDULE:-0 4 * * 0}"
LOG_FILE="${BACKUP_LOG_FILE:-$BACKUP_DIR/backup.log}"
VERIFY_LOG_FILE="${BACKUP_VERIFY_LOG_FILE:-$BACKUP_DIR/restore-verify.log}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
touch "$LOG_FILE" "$VERIFY_LOG_FILE"
chmod 600 "$LOG_FILE" "$VERIFY_LOG_FILE"
current="$(crontab -l 2>/dev/null || true)"
filtered="$(printf '%s\n' "$current" | grep -vE '/scripts/(backup-db|verify-backup-restore)\.sh' || true)"
entry="$BACKUP_SCHEDULE BACKUP_DIR=$BACKUP_DIR $ROOT_DIR/scripts/backup-db.sh >> $LOG_FILE 2>&1"
verify_entry="$BACKUP_VERIFY_SCHEDULE RESTORE_BACKUP_DIR=$BACKUP_DIR $ROOT_DIR/scripts/verify-backup-restore.sh >> $VERIFY_LOG_FILE 2>&1"

{
  printf '%s\n' "$filtered"
  printf '%s\n' "$entry"
  printf '%s\n' "$verify_entry"
} | sed '/^[[:space:]]*$/d' | crontab -

echo "Installed database backup cron: $entry"
echo "Installed database restore verification cron: $verify_entry"
