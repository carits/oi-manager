#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:-/data/backups/oi-manager/automatic}"
DB_NAME="${DB_NAME:-oi_manager}"
DB_USER="${DB_USER:-oi}"
CONTAINER="${DB_CONTAINER:-oi-postgres}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
LOCK_FILE="${BACKUP_LOCK_FILE:-/tmp/oi-manager-db-backup.lock}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date --iso-8601=seconds)] another database backup is already running; skipped"
  exit 0
fi

timestamp="$(date +%Y%m%d_%H%M%S)"
backup_file="$BACKUP_DIR/${DB_NAME}_${timestamp}.dump"
temp_file="${backup_file}.tmp.$$"
manifest_file="${backup_file}.manifest.json"
manifest_temp="${manifest_file}.tmp.$$"
audit_db="oi_manager_backup_audit_${$}"
[[ "$audit_db" =~ ^oi_manager_backup_audit_[0-9]+$ ]] || { echo 'Unsafe backup audit database name' >&2; exit 2; }

cleanup() {
  rm -f -- "$temp_file"
  rm -f -- "$manifest_temp"
  if [ -n "${audit_db:-}" ]; then
    docker exec "$CONTAINER" dropdb -U "$DB_USER" --if-exists "$audit_db" >/dev/null 2>&1 || true
  fi
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
backup_sha256="$(sha256sum "$temp_file" | cut -d' ' -f1)"
backup_size="$(stat -c '%s' "$temp_file")"

query_count() {
  docker exec "$CONTAINER" psql -U "$DB_USER" -d "$audit_db" -tAc "$1" | tr -d '[:space:]'
}

docker exec "$CONTAINER" createdb -U "$DB_USER" "$audit_db"
docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$audit_db" --no-owner --no-privileges < "$temp_file"

table_count="$(query_count "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
migration_count="$(query_count 'SELECT count(*) FROM public._prisma_migrations')"
user_count="$(query_count 'SELECT count(*) FROM public."User"')"
problem_count="$(query_count 'SELECT count(*) FROM public."Problem"')"
submission_count="$(query_count 'SELECT count(*) FROM public."Submission"')"
file_count="$(query_count 'SELECT count(*) FROM public."File"')"
slot_count="$(query_count 'SELECT count(*) FROM public."ProblemTestSetSlot"')"
docker exec "$CONTAINER" dropdb -U "$DB_USER" "$audit_db"
audit_db=""

node - "$manifest_temp" "$(basename "$backup_file")" "$backup_sha256" "$backup_size" \
  "$table_count" "$migration_count" "$user_count" "$problem_count" "$submission_count" "$file_count" "$slot_count" <<'NODE'
const fs = require('node:fs')
const [file, backupName, backupSha256, backupSize, tables, migrations, users, problems, submissions, files, slots] = process.argv.slice(2)
const payload = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  backupName,
  backupSha256,
  backupSize: Number(backupSize),
  counts: {
    tables: Number(tables),
    migrations: Number(migrations),
    users: Number(users),
    problems: Number(problems),
    submissions: Number(submissions),
    files: Number(files),
    testSetSlots: Number(slots),
  },
}
fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
NODE

mv -- "$temp_file" "$backup_file"
mv -- "$manifest_temp" "$manifest_file"
chmod 600 "$backup_file" "$manifest_file"
trap - EXIT

# Retention is intentionally limited to automatic backups in this exact directory.
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}_*.dump" -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}_*.dump.manifest.json" -mtime "+$KEEP_DAYS" -delete

size="$(du -h "$backup_file" | cut -f1)"
echo "[$(date --iso-8601=seconds)] backup verified: $backup_file ($size, sha256=$backup_sha256, manifest=$(basename "$manifest_file"))"
