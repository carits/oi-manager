#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/apps/server/.env.production}"
TEST_SCHEMA="${ASSIGNMENT_TEST_SCHEMA:-assignment_test_$(date +%s)}"
BASE_SCHEMA="${ASSIGNMENT_BASE_SCHEMA:-}"

if [[ ! "$TEST_SCHEMA" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
  echo "Invalid ASSIGNMENT_TEST_SCHEMA" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

DATABASE_URL_VALUE="$(cd "$ROOT_DIR/apps/server" && DOTENV_CONFIG_PATH="$ENV_FILE" node -r dotenv/config -e 'process.stdout.write(process.env.DATABASE_URL || "")')"
if [[ -z "$DATABASE_URL_VALUE" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

TEST_DATABASE_URL="$(DATABASE_URL="$DATABASE_URL_VALUE" TEST_SCHEMA="$TEST_SCHEMA" node -e 'const url = new URL(process.env.DATABASE_URL); url.searchParams.set("schema", process.env.TEST_SCHEMA); process.stdout.write(url.toString())')"
ADMIN_DATABASE_URL="$(DATABASE_URL="$DATABASE_URL_VALUE" node -e 'const url = new URL(process.env.DATABASE_URL); url.searchParams.delete("schema"); process.stdout.write(url.toString())')"

cleanup() {
  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS $TEST_SCHEMA CASCADE" >/dev/null
}
trap cleanup EXIT

cleanup
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE SCHEMA $TEST_SCHEMA" >/dev/null
if [[ -n "$BASE_SCHEMA" ]]; then
  if [[ ! -f "$BASE_SCHEMA" ]]; then
    echo "Base Prisma schema not found: $BASE_SCHEMA" >&2
    exit 1
  fi
  DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma db push --skip-generate --schema "$BASE_SCHEMA"
  PGOPTIONS="-c search_path=$TEST_SCHEMA" psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT_DIR/apps/server/prisma/migrations/20260909_assignment_domain/migration.sql"
else
  DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma migrate deploy --schema prisma/schema.prisma
fi
pnpm --dir "$ROOT_DIR" --filter @oi-manager/shared build
DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma generate --schema prisma/schema.prisma
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run tests/assignment.test.ts tests/background-services.test.ts
