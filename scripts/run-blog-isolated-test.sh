#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/apps/server/.env.production}"
TEST_SCHEMA="${BLOG_TEST_SCHEMA:-blog_test_$(date +%s)}"

if [[ ! "$TEST_SCHEMA" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
  echo "Invalid BLOG_TEST_SCHEMA" >&2
  exit 1
fi

DATABASE_URL_VALUE="${BLOG_DATABASE_URL:-}"
if [[ -z "$DATABASE_URL_VALUE" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Environment file not found: $ENV_FILE" >&2
    exit 1
  fi
  DATABASE_URL_VALUE="$(cd "$ROOT_DIR/apps/server" && DOTENV_CONFIG_PATH="$ENV_FILE" node -r dotenv/config -e 'process.stdout.write(process.env.DATABASE_URL || "")')"
fi
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
DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma db push --skip-generate --schema prisma/schema.prisma
# `prisma db push` intentionally does not execute custom database triggers.
# Install the Blog immutability tail from its migration so this focused test
# exercises the same database invariant as a deployed schema.
sed -n '/CREATE OR REPLACE FUNCTION "blog_version_content_immutable"/,/^COMMIT;/p' \
  "$ROOT_DIR/apps/server/prisma/migrations/20260909_z_blog_knowledge_domain/migration.sql" \
  | PGOPTIONS="-c search_path=$TEST_SCHEMA" psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null
sed -n '/CREATE OR REPLACE FUNCTION reject_blog_submission_snapshot_mutation()/,$p' \
  "$ROOT_DIR/apps/server/prisma/migrations/20260910_blog_submission_snapshots/migration.sql" \
  | PGOPTIONS="-c search_path=$TEST_SCHEMA" psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null
pnpm --dir "$ROOT_DIR" --filter @oi-manager/contracts build
pnpm --dir "$ROOT_DIR" --filter @oi-manager/shared build
DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma generate --schema prisma/schema.prisma
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
  tests/api-contract-layer.test.ts tests/blog-knowledge-domain.test.ts
