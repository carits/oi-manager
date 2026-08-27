#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="${RESTORE_DB_CONTAINER:-oi-postgres}"
DB_USER="${RESTORE_DB_USER:-oi}"
BACKUP_DIR="${RESTORE_BACKUP_DIR:-/data/backups/oi-manager/automatic}"
BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  BACKUP_FILE="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'oi_manager_*.dump' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
fi
[[ -f "$BACKUP_FILE" ]] || { echo "No backup archive found for secret-rotation verification." >&2; exit 1; }

audit_db="oi_manager_secret_rotation_audit_${$}"
[[ "$audit_db" =~ ^oi_manager_secret_rotation_audit_[0-9]+$ ]] || { echo "Unsafe audit database name." >&2; exit 1; }
container_archive="/tmp/${audit_db}.dump"
audit_dir="$(mktemp -d /tmp/oi-secret-rotation-audit.XXXXXX)"
chmod 700 "$audit_dir"

cleanup() {
  docker exec "$DB_CONTAINER" rm -f -- "$container_archive" >/dev/null 2>&1 || true
  docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$audit_db" >/dev/null 2>&1 || true
  rm -rf -- "$audit_dir"
}
trap cleanup EXIT

docker exec "$DB_CONTAINER" createdb -U "$DB_USER" "$audit_db"
docker cp "$BACKUP_FILE" "$DB_CONTAINER:$container_archive" >/dev/null
docker exec "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$audit_db" --no-owner --no-privileges "$container_archive"

cp -L "$ROOT_DIR/apps/server/.env" "$audit_dir/server.env"
chmod 600 "$audit_dir/server.env"
account_count="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$audit_db" -tAc 'SELECT count(*) FROM public."OjAccount" WHERE password IS NOT NULL AND "passwordIV" IS NOT NULL')"

(
  cd "$ROOT_DIR"
  RUNTIME_SERVER_ENV="$audit_dir/server.env" \
  RUNTIME_DATABASE_NAME_OVERRIDE="$audit_db" \
  RUNTIME_SECRET_BACKUP_DIR="$audit_dir/backups" \
    pnpm --filter server exec tsx scripts/rotate-runtime-secrets.ts --apply >"$audit_dir/apply.json"
  RUNTIME_SERVER_ENV="$audit_dir/server.env" \
  RUNTIME_DATABASE_NAME_OVERRIDE="$audit_db" \
    pnpm --filter server exec tsx scripts/rotate-runtime-secrets.ts >"$audit_dir/check.json"
)

grep -Fq "\"rotatedAccounts\": ${account_count}" "$audit_dir/apply.json"
grep -Fq '"backupCreated": true' "$audit_dir/apply.json"
grep -Fq "\"decryptableAccounts\": ${account_count}" "$audit_dir/check.json"
grep -Fq '"ready": true' "$audit_dir/check.json"

printf 'backup=%s temporary_database=%s rotated_accounts=%s verification=passed\n' "$BACKUP_FILE" "$audit_db" "$account_count"
