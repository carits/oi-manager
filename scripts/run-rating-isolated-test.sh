#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/apps/server/.env.production}"
TEST_SCHEMA="${RATING_TEST_SCHEMA:-rating_test_$(date +%s)}"
TEST_SCOPE="${RATING_TEST_SCOPE:-rating}"
SCHEMA_SETUP="${RATING_SCHEMA_SETUP:-push}"

if [[ ! "$TEST_SCHEMA" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
  echo "Invalid RATING_TEST_SCHEMA" >&2
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
if [[ "$SCHEMA_SETUP" == "push" ]]; then
  # The repository still contains pre-baseline migrations that cannot bootstrap
  # a brand-new database. Isolated feature tests therefore materialize the
  # current schema directly; production upgrade SQL is validated separately
  # against a schema-only copy of production before deployment.
  DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma db push --skip-generate --schema prisma/schema.prisma
elif [[ "$SCHEMA_SETUP" == "migrate" ]]; then
  DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma migrate deploy --schema prisma/schema.prisma
else
  echo "Invalid RATING_SCHEMA_SETUP: expected push or migrate" >&2
  exit 1
fi
pnpm --dir "$ROOT_DIR" --filter @oi-manager/shared build
DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma generate --schema prisma/schema.prisma

if [[ "$TEST_SCOPE" == "full" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run
elif [[ "$TEST_SCOPE" == "rating" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run tests/rating-domain.test.ts
else
  echo "Invalid RATING_TEST_SCOPE: expected rating or full" >&2
  exit 1
fi
