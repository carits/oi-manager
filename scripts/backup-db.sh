#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-/data/backups/oi-manager/automatic}"
DB_NAME="${DB_NAME:-oi_manager}"
DB_USER="${DB_USER:-oi}"
CONTAINER="${DB_CONTAINER:-oi-postgres}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
LOCK_FILE="${BACKUP_LOCK_FILE:-/tmp/oi-manager-db-backup.lock}"

mkdir -p "$BACKUP_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date --iso-8601=seconds)] another database backup is already running; skipped"
  exit 0
fi

timestamp="$(date +%Y%m%d_%H%M%S)"
backup_file="$BACKUP_DIR/${DB_NAME}_${timestamp}.dump"
temp_file="${backup_file}.tmp.$$"

cleanup() {
  rm -f -- "$temp_file"
}
trap cleanup EXIT

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "[$(date --iso-8601=seconds)] backup failed: container $CONTAINER does not exist" >&2
  exit 1
fi
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" != "true" ]; then
  echo "[$(date --iso-8601=seconds)] backup failed: container $CONTAINER is not running" >&2
  exit 1
fi
if ! docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null; then
  echo "[$(date --iso-8601=seconds)] backup failed: database is not ready" >&2
  exit 1
fi

# PostgreSQL custom format is compressed and supports pg_restore listing.
# The temporary file stays in the destination filesystem so the final rename is atomic.
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$temp_file"
if [ ! -s "$temp_file" ]; then
  echo "[$(date --iso-8601=seconds)] backup failed: pg_dump produced an empty file" >&2
  exit 1
fi
docker exec -i "$CONTAINER" pg_restore -l < "$temp_file" >/dev/null
mv -- "$temp_file" "$backup_file"
trap - EXIT

# Retention is intentionally limited to automatic backups in this exact directory.
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}_*.dump" -mtime "+$KEEP_DAYS" -delete

size="$(du -h "$backup_file" | cut -f1)"
echo "[$(date --iso-8601=seconds)] backup verified: $backup_file ($size)"
