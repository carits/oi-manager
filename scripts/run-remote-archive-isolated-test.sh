#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/apps/server/.env}"
DB_CONTAINER="${REMOTE_ARCHIVE_DB_CONTAINER:-oi-postgres}"
DB_USER="${REMOTE_ARCHIVE_DB_USER:-oi}"
TEST_DB="oi_manager_remote_archive_test_${$}"

[[ "$TEST_DB" =~ ^oi_manager_remote_archive_test_[0-9]+$ ]] || {
  echo "Unsafe remote archive test database name." >&2
  exit 1
}
[[ -f "$ENV_FILE" ]] || {
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
}

DATABASE_URL_VALUE="$(cd "$ROOT_DIR/apps/server" && DOTENV_CONFIG_PATH="$ENV_FILE" node -r dotenv/config -e 'process.stdout.write(process.env.DATABASE_URL || "")')"
[[ -n "$DATABASE_URL_VALUE" ]] || {
  echo "DATABASE_URL is required" >&2
  exit 1
}
TEST_DATABASE_URL="$(DATABASE_URL="$DATABASE_URL_VALUE" TEST_DB="$TEST_DB" node -e 'const url = new URL(process.env.DATABASE_URL); url.pathname = `/${process.env.TEST_DB}`; process.stdout.write(url.toString())')"

cleanup() {
  docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$TEST_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
docker exec "$DB_CONTAINER" createdb -U "$DB_USER" "$TEST_DB"
(
  cd "$ROOT_DIR"
  DATABASE_URL="$DATABASE_URL_VALUE" BOOTSTRAP_DATABASE_NAME_OVERRIDE="$TEST_DB" pnpm db:bootstrap
  pnpm --filter @oi-manager/contracts build
  pnpm --filter @oi-manager/shared build
  DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter server exec prisma generate --schema prisma/schema.prisma
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter server exec vitest run \
    tests/api-contract-layer.test.ts \
    tests/submission.test.ts \
    tests/remote-archive-retirement.test.ts
)
