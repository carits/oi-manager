#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="${BOOTSTRAP_DB_CONTAINER:-oi-postgres}"
DB_USER="${BOOTSTRAP_DB_USER:-oi}"
BACKUP_DIR="${RESTORE_BACKUP_DIR:-/data/backups/oi-manager/automatic}"
BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
  BACKUP_FILE="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'oi_manager_*.dump' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
fi
[[ -f "$BACKUP_FILE" ]] || { echo "No backup archive found for install-path verification." >&2; exit 1; }

clean_db="oi_manager_path_audit_clean_${$}"
restore_db="oi_manager_path_audit_restore_${$}"
[[ "$clean_db" =~ ^oi_manager_path_audit_clean_[0-9]+$ && "$restore_db" =~ ^oi_manager_path_audit_restore_[0-9]+$ ]] || {
  echo "Unsafe audit database name." >&2; exit 1;
}
audit_dir="$(mktemp -d /tmp/oi-db-path-audit.XXXXXX)"
container_archive="/tmp/${restore_db}.dump"

cleanup() {
  docker exec "$DB_CONTAINER" rm -f -- "$container_archive" >/dev/null 2>&1 || true
  docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$clean_db" >/dev/null 2>&1 || true
  docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$restore_db" >/dev/null 2>&1 || true
  if [[ "$audit_dir" == /tmp/oi-db-path-audit.* ]]; then rm -rf -- "$audit_dir"; fi
}
trap cleanup EXIT

docker exec "$DB_CONTAINER" createdb -U "$DB_USER" "$clean_db"
docker exec "$DB_CONTAINER" createdb -U "$DB_USER" "$restore_db"
docker cp "$BACKUP_FILE" "$DB_CONTAINER:$container_archive" >/dev/null
docker exec "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$restore_db" --no-owner --no-privileges "$container_archive"

(
  cd "$ROOT_DIR"
  BOOTSTRAP_DATABASE_NAME_OVERRIDE="$clean_db" \
    pnpm --filter server exec tsx scripts/bootstrap-clean-database.ts --apply --seed
  MIGRATION_DATABASE_NAME_OVERRIDE="$restore_db" \
    pnpm --filter server exec tsx scripts/verify-migration-target.ts
)

for database in "$clean_db" "$restore_db"; do
  docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$database" -At \
    <"$ROOT_DIR/scripts/sql/public-schema-signature.sql" >"$audit_dir/${database}.signature"
done

clean_hash="$(sha256sum "$audit_dir/${clean_db}.signature" | cut -d' ' -f1)"
restore_hash="$(sha256sum "$audit_dir/${restore_db}.signature" | cut -d' ' -f1)"
if ! cmp -s "$audit_dir/${clean_db}.signature" "$audit_dir/${restore_db}.signature"; then
  diff -u "$audit_dir/${clean_db}.signature" "$audit_dir/${restore_db}.signature" | head -200 >&2 || true
  echo "Clean-install and restored-upgrade schemas differ." >&2
  exit 1
fi

printf 'backup=%s clean_database=%s restored_database=%s schema_sha256=%s schema_match=true\n' \
  "$BACKUP_FILE" "$clean_db" "$restore_db" "$clean_hash"
[[ "$clean_hash" == "$restore_hash" ]]
