#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

DB_CONTAINER="${RESTORE_DB_CONTAINER:-oi-postgres}"
DB_USER="${RESTORE_DB_USER:-oi}"
BACKUP_DIR="${RESTORE_BACKUP_DIR:-/data/backups/oi-manager/automatic}"
BACKUP_FILE="${1:-}"
STATE_FILE="${RESTORE_VERIFICATION_STATE_FILE:-$BACKUP_DIR/restore-verification.json}"
LOCK_FILE="${RESTORE_VERIFICATION_LOCK_FILE:-/tmp/oi-manager-restore-verification.lock}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo 'Another restore verification is already running; skipped'; exit 0; }

backup_name=""
backup_sha256=""
backup_size=0
table_count=0
migration_count=0
user_count=0

write_state() {
  local status="$1"
  node - "$STATE_FILE" "$status" "$backup_name" "$backup_sha256" "$backup_size" "$table_count" "$migration_count" "$user_count" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [file, status, backupName, backupSha256, backupSize, tables, migrations, users] = process.argv.slice(2)
const now = new Date().toISOString()
const payload = {
  schemaVersion: 1,
  status,
  checkedAt: now,
  verifiedAt: status === 'healthy' ? now : null,
  backupName: backupName || null,
  backupSha256: backupSha256 || null,
  backupSize: Number(backupSize || 0),
  tables: Number(tables || 0),
  migrations: Number(migrations || 0),
  users: Number(users || 0),
}
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
const temporary = `${file}.next.${process.pid}`
fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
fs.renameSync(temporary, file)
NODE
}

if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'oi_manager_*.dump' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
fi
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  write_state failed
  echo "No backup archive found for restore verification." >&2
  exit 1
fi

backup_name="$(basename "$BACKUP_FILE")"
backup_sha256="$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)"
backup_size="$(stat -c '%s' "$BACKUP_FILE")"

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
finish() {
  local result="$?"
  trap - EXIT
  cleanup
  if [ "$result" -eq 0 ]; then write_state healthy; else write_state failed || true; fi
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT TERM

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
