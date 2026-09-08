#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/apps/server/.env.production}"
TEST_SCHEMA="${ASSIGNMENT_TEST_SCHEMA:-assignment_test_$(date +%s)}"

if [[ ! "$TEST_SCHEMA" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
  echo "Invalid ASSIGNMENT_TEST_SCHEMA" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

TEST_DATABASE_URL="$(TEST_SCHEMA="$TEST_SCHEMA" node -e 'const url = new URL(process.env.DATABASE_URL); url.searchParams.set("schema", process.env.TEST_SCHEMA); process.stdout.write(url.toString())')"

cleanup() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS $TEST_SCHEMA CASCADE" >/dev/null
}
trap cleanup EXIT

cleanup
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE SCHEMA $TEST_SCHEMA" >/dev/null
DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma migrate deploy --schema prisma/schema.prisma
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" test -- assignment.test.ts background-services.test.ts
