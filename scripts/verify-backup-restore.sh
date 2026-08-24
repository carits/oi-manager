#!/usr/bin/env bash
set -Eeuo pipefail

DB_CONTAINER="${RESTORE_DB_CONTAINER:-oi-postgres}"
DB_USER="${RESTORE_DB_USER:-oi}"
BACKUP_DIR="${RESTORE_BACKUP_DIR:-/data/backups/oi-manager/automatic}"
BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'oi_manager_*.dump' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
fi
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "No backup archive found for restore verification." >&2
  exit 1
fi

restore_db="oi_manager_restore_audit_${$}"
if ! [[ "$restore_db" =~ ^oi_manager_restore_audit_[0-9]+$ ]]; then
  echo "Unsafe temporary restore database name: $restore_db" >&2
  exit 1
fi
container_archive="/tmp/${restore_db}.dump"

cleanup() {
  docker exec "$DB_CONTAINER" rm -f -- "$container_archive" >/dev/null 2>&1 || true
  docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$restore_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$restore_db'" | grep -q 1; then
  echo "Temporary restore database already exists: $restore_db" >&2
  exit 1
fi

docker exec "$DB_CONTAINER" createdb -U "$DB_USER" "$restore_db"
docker cp "$BACKUP_FILE" "$DB_CONTAINER:$container_archive" >/dev/null
docker exec "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$restore_db" \
  --no-owner --no-privileges "$container_archive"

table_count="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$restore_db" -tAc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
migration_count="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$restore_db" -tAc \
  'SELECT count(*) FROM public._prisma_migrations')"
user_count="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$restore_db" -tAc \
  'SELECT count(*) FROM public."User"')"

if [ "$table_count" -le 0 ] || [ "$migration_count" -le 0 ]; then
  echo "Restored database failed structural validation." >&2
  exit 1
fi

printf 'backup=%s temporary_database=%s tables=%s migrations=%s users=%s\n' \
  "$BACKUP_FILE" "$restore_db" "$table_count" "$migration_count" "$user_count"
