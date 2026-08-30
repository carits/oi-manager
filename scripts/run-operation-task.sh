#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${OI_MANAGER_ROOT:-/data/oi-manager-response-refactor}"
task="${1:-}"

case "$task" in
  monitor)
    export MONITOR_QUIET_SUCCESS="${MONITOR_QUIET_SUCCESS:-1}"
    exec "$ROOT_DIR/scripts/monitor-services.sh"
    ;;
  backup-db)
    export BACKUP_DIR="${BACKUP_DIR:-/data/backups/oi-manager/automatic}"
    exec "$ROOT_DIR/scripts/backup-db.sh"
    ;;
  backup-assets)
    export ASSET_BACKUP_DIR="${ASSET_BACKUP_DIR:-/data/backups/oi-manager/assets}"
    export ASSET_DB_BACKUP_DIR="${ASSET_DB_BACKUP_DIR:-/data/backups/oi-manager/automatic}"
    exec "$ROOT_DIR/scripts/backup-assets.sh"
    ;;
  verify-db)
    export RESTORE_BACKUP_DIR="${RESTORE_BACKUP_DIR:-/data/backups/oi-manager/automatic}"
    exec "$ROOT_DIR/scripts/verify-backup-restore.sh"
    ;;
  verify-assets)
    export ASSET_BACKUP_DIR="${ASSET_BACKUP_DIR:-/data/backups/oi-manager/assets}"
    export ASSET_DB_BACKUP_DIR="${ASSET_DB_BACKUP_DIR:-/data/backups/oi-manager/automatic}"
    exec "$ROOT_DIR/scripts/verify-assets-restore.sh"
    ;;
  security-baseline)
    export SECURITY_BASELINE_DIR="${SECURITY_BASELINE_DIR:-/data/backups/oi-manager/security-baseline}"
    exec "$ROOT_DIR/scripts/run-security-baseline.sh"
    ;;
  logs-archive)
    exec "$ROOT_DIR/scripts/archive-operations-logs.sh"
    ;;
  *)
    echo "Unsupported operation task: ${task:-missing}" >&2
    exit 2
    ;;
esac
