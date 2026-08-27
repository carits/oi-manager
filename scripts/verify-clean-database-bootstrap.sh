#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="${BOOTSTRAP_DB_CONTAINER:-oi-postgres}"
DB_USER="${BOOTSTRAP_DB_USER:-oi}"
audit_db="oi_manager_clean_bootstrap_audit_${$}"
[[ "$audit_db" =~ ^oi_manager_clean_bootstrap_audit_[0-9]+$ ]] || { echo "Unsafe audit database name." >&2; exit 1; }

cleanup() {
  docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$audit_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker exec "$DB_CONTAINER" createdb -U "$DB_USER" "$audit_db"
(
  cd "$ROOT_DIR"
  BOOTSTRAP_DATABASE_NAME_OVERRIDE="$audit_db" \
    pnpm --filter server exec tsx scripts/bootstrap-clean-database.ts --apply --seed
)

table_count="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$audit_db" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
migration_count="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$audit_db" -tAc 'SELECT count(*) FROM public._prisma_migrations')"
expected_migrations="$(find "$ROOT_DIR/apps/server/prisma/migrations" -mindepth 2 -maxdepth 2 -name migration.sql | wc -l)"
user_count="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$audit_db" -tAc 'SELECT count(*) FROM public."User"')"

[[ "$table_count" -gt 1 ]]
[[ "$migration_count" -eq "$expected_migrations" ]]
[[ "$user_count" -gt 0 ]]

if (
  cd "$ROOT_DIR"
  BOOTSTRAP_DATABASE_NAME_OVERRIDE="$audit_db" \
    pnpm --filter server exec tsx scripts/bootstrap-clean-database.ts >/dev/null 2>&1
); then
  echo "Bootstrap unexpectedly accepted a non-empty database." >&2
  exit 1
fi

printf 'temporary_database=%s tables=%s migrations=%s users=%s nonempty_guard=passed\n' \
  "$audit_db" "$table_count" "$migration_count" "$user_count"
