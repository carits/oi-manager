#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/data/backups/oi-manager/automatic}"
BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * *}"
BACKUP_VERIFY_SCHEDULE="${BACKUP_VERIFY_SCHEDULE:-0 4 * * 0}"
ASSET_BACKUP_DIR="${ASSET_BACKUP_DIR:-/data/backups/oi-manager/assets}"
ASSET_BACKUP_SCHEDULE="${ASSET_BACKUP_SCHEDULE:-15 3 * * *}"
ASSET_VERIFY_SCHEDULE="${ASSET_VERIFY_SCHEDULE:-30 4 * * 0}"
LOG_FILE="${BACKUP_LOG_FILE:-$BACKUP_DIR/backup.log}"
VERIFY_LOG_FILE="${BACKUP_VERIFY_LOG_FILE:-$BACKUP_DIR/restore-verify.log}"
ASSET_LOG_FILE="${ASSET_BACKUP_LOG_FILE:-$ASSET_BACKUP_DIR/asset-backup.log}"
ASSET_VERIFY_LOG_FILE="${ASSET_VERIFY_LOG_FILE:-$ASSET_BACKUP_DIR/asset-restore-verify.log}"

mkdir -p "$BACKUP_DIR" "$ASSET_BACKUP_DIR"
chmod 700 "$BACKUP_DIR" "$ASSET_BACKUP_DIR"
touch "$LOG_FILE" "$VERIFY_LOG_FILE" "$ASSET_LOG_FILE" "$ASSET_VERIFY_LOG_FILE"
chmod 600 "$LOG_FILE" "$VERIFY_LOG_FILE" "$ASSET_LOG_FILE" "$ASSET_VERIFY_LOG_FILE"
current="$(crontab -l 2>/dev/null || true)"
filtered="$(printf '%s\n' "$current" | grep -vE '/scripts/(backup-db|verify-backup-restore|backup-assets|verify-assets-restore)\.sh' || true)"
entry="$BACKUP_SCHEDULE BACKUP_DIR=$BACKUP_DIR $ROOT_DIR/scripts/backup-db.sh >> $LOG_FILE 2>&1"
verify_entry="$BACKUP_VERIFY_SCHEDULE RESTORE_BACKUP_DIR=$BACKUP_DIR $ROOT_DIR/scripts/verify-backup-restore.sh >> $VERIFY_LOG_FILE 2>&1"
asset_entry="$ASSET_BACKUP_SCHEDULE ASSET_BACKUP_DIR=$ASSET_BACKUP_DIR ASSET_DB_BACKUP_DIR=$BACKUP_DIR $ROOT_DIR/scripts/backup-assets.sh >> $ASSET_LOG_FILE 2>&1"
asset_verify_entry="$ASSET_VERIFY_SCHEDULE ASSET_BACKUP_DIR=$ASSET_BACKUP_DIR ASSET_DB_BACKUP_DIR=$BACKUP_DIR $ROOT_DIR/scripts/verify-assets-restore.sh >> $ASSET_VERIFY_LOG_FILE 2>&1"

{
  printf '%s\n' "$filtered"
  printf '%s\n' "$entry"
  printf '%s\n' "$verify_entry"
  printf '%s\n' "$asset_entry"
  printf '%s\n' "$asset_verify_entry"
} | sed '/^[[:space:]]*$/d' | crontab -

echo "Installed database backup cron: $entry"
echo "Installed database restore verification cron: $verify_entry"
echo "Installed asset backup cron: $asset_entry"
echo "Installed asset restore verification cron: $asset_verify_entry"
