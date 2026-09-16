#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The deployed API and isolated production-like tests must resolve the same
# authoritative runtime connection. `.env.production` is a legacy local file
# and may contain retired credentials; callers can still pass an explicit file.
ENV_FILE="${1:-$ROOT_DIR/apps/server/.env}"
TEST_SCHEMA="${ASSIGNMENT_TEST_SCHEMA:-assignment_test_$(date +%s)}"
BASE_SCHEMA="${ASSIGNMENT_BASE_SCHEMA:-}"
TEST_SCOPE="${ASSIGNMENT_TEST_SCOPE:-assignment}"
# Historical migrations intentionally preserve several retired bootstrap paths
# and are not a valid clean-schema fixture. Isolated application tests exercise
# the current authoritative Prisma shape unless a migration rehearsal opts in.
SCHEMA_SETUP="${ASSIGNMENT_SCHEMA_SETUP:-current}"

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
if [[ "$SCHEMA_SETUP" == "current" ]]; then
  DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma db push --skip-generate --schema prisma/schema.prisma
  # `prisma db push` creates the current relational shape but intentionally
  # omits the database-level immutability triggers used by production. Replay
  # the trigger-only tails so release-invariant tests exercise the deployed
  # contract instead of a weaker test database.
  sed -n '/CREATE OR REPLACE FUNCTION "carits_prevent_posted_transaction_mutation"/,$p' \
    "$ROOT_DIR/apps/server/prisma/migrations/20260815_carits_contribution_foundation/migration.sql" \
    | PGOPTIONS="-c search_path=$TEST_SCHEMA" psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null
  sed -n '/CREATE OR REPLACE FUNCTION "evaluation_credit_wallet_entry_immutable"/,/FOR EACH ROW EXECUTE FUNCTION "evaluation_credit_ledger_entry_immutable"();/p' \
    "$ROOT_DIR/apps/server/prisma/migrations/20260908_contribution_carits_evaluation_loop/migration.sql" \
    | PGOPTIONS="-c search_path=$TEST_SCHEMA" psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null
  sed -n '/-- Reinstall the posted-transaction guard/,/^COMMIT;/p' \
    "$ROOT_DIR/apps/server/prisma/migrations/20260908_contribution_carits_evaluation_loop/migration.sql" \
    | PGOPTIONS="-c search_path=$TEST_SCHEMA" psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null
  sed -n '/CREATE OR REPLACE FUNCTION "solution_snapshot_immutable"/,/^COMMIT;/p' \
    "$ROOT_DIR/apps/server/prisma/migrations/20260909_solution_editorial_domain/migration.sql" \
    | PGOPTIONS="-c search_path=$TEST_SCHEMA" psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null
  sed -n '/CREATE OR REPLACE FUNCTION "blog_version_content_immutable"/,/^COMMIT;/p' \
    "$ROOT_DIR/apps/server/prisma/migrations/20260909_z_blog_knowledge_domain/migration.sql" \
    | PGOPTIONS="-c search_path=$TEST_SCHEMA" psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null
  sed -n '/CREATE OR REPLACE FUNCTION reject_blog_submission_snapshot_mutation()/,$p' \
    "$ROOT_DIR/apps/server/prisma/migrations/20260910_blog_submission_snapshots/migration.sql" \
    | PGOPTIONS="-c search_path=$TEST_SCHEMA" psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null
  # `prisma db push` materializes the canonical Contest-only Rating relations.
  # No Training/Contest compatibility triggers are installed in current-schema tests.
elif [[ "$SCHEMA_SETUP" != "migrations" ]]; then
  echo "Invalid ASSIGNMENT_SCHEMA_SETUP: expected migrations or current" >&2
  exit 1
elif [[ -n "$BASE_SCHEMA" ]]; then
  if [[ ! -f "$BASE_SCHEMA" ]]; then
    echo "Base Prisma schema not found: $BASE_SCHEMA" >&2
    exit 1
  fi
  DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma db push --skip-generate --schema "$BASE_SCHEMA"
  PGOPTIONS="-c search_path=$TEST_SCHEMA" psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT_DIR/apps/server/prisma/migrations/20260909_assignment_domain/migration.sql"
else
  DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma migrate deploy --schema prisma/schema.prisma
fi
pnpm --dir "$ROOT_DIR" --filter @oi-manager/contracts build
pnpm --dir "$ROOT_DIR" --filter @oi-manager/shared build
DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec prisma generate --schema prisma/schema.prisma
if [[ "$TEST_SCOPE" == "full" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run
elif [[ "$TEST_SCOPE" == "release-invariants" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run tests/economy-loop.test.ts tests/solution-editorial-domain.test.ts tests/blog-knowledge-domain.test.ts
elif [[ "$TEST_SCOPE" == "assignment" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    tests/api-contract-layer.test.ts tests/assignment.test.ts tests/background-services.test.ts
elif [[ "$TEST_SCOPE" == "problem-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    tests/api-contract-layer.test.ts tests/problem-judge-api.test.ts \
    tests/problem-library-isolation.test.ts tests/problem-testset-revision.test.ts tests/testdata.test.ts
elif [[ "$TEST_SCOPE" == "platform-problem-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/problem-library-isolation.test.ts \
    tests/security-boundaries.test.ts tests/oj-fetcher-queue.service.test.ts
elif [[ "$TEST_SCOPE" == "oj-account-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/oj-accounts.test.ts
elif [[ "$TEST_SCOPE" == "chat-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/chat.test.ts
elif [[ "$TEST_SCOPE" == "organization-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/organization-creation.test.ts \
    tests/organization-join.test.ts tests/platform-organization-access.test.ts
elif [[ "$TEST_SCOPE" == "notification-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/notification.test.ts \
    tests/organization-join.test.ts
elif [[ "$TEST_SCOPE" == "workspace-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/dashboard-workspace.test.ts \
    tests/admin-access.test.ts tests/organization-join.test.ts
elif [[ "$TEST_SCOPE" == "auth-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/auth.test.ts tests/admin-access.test.ts
elif [[ "$TEST_SCOPE" == "user-profile-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/user-profile.test.ts
elif [[ "$TEST_SCOPE" == "team-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/teams.test.ts
elif [[ "$TEST_SCOPE" == "data-market-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/data-market-policy.test.ts tests/data-market.test.ts
elif [[ "$TEST_SCOPE" == "contribution-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/economy-api.test.ts \
    tests/economy-loop.test.ts tests/evaluation-budget.test.ts
elif [[ "$TEST_SCOPE" == "platform-binding-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/remote-archive.test.ts
elif [[ "$TEST_SCOPE" == "ranking-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/rating-domain.test.ts \
    tests/economy-api.test.ts tests/teams.test.ts tests/regression.test.ts
elif [[ "$TEST_SCOPE" == "ai-governance-contract" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism tests/api-contract-layer.test.ts tests/ai-token-service.test.ts \
    tests/economy-api.test.ts tests/evaluation-budget.test.ts
elif [[ "$TEST_SCOPE" == "authorization" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    tests/authorization-boundary.test.ts tests/auth.test.ts tests/organization-creation.test.ts \
    tests/organization-join.test.ts tests/platform-organization-access.test.ts tests/permissions.test.ts \
    tests/security-boundaries.test.ts tests/submission.test.ts
elif [[ "$TEST_SCOPE" == "contest-cutover" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism \
    tests/application-composition.test.ts \
    tests/oj-adapters-registry.test.ts tests/contest-query-facade.test.ts \
    tests/contest-canonical-submission-identity.test.ts \
    tests/rating-domain.test.ts tests/data-market.test.ts tests/dashboard-workspace.test.ts \
    tests/school-contest.test.ts tests/contest.test.ts tests/blog-knowledge-domain.test.ts \
    tests/submission.test.ts tests/judge-run-domain.test.ts
elif [[ "$TEST_SCOPE" == "contest-core" ]]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --dir "$ROOT_DIR/apps/server" exec vitest run \
    --no-file-parallelism \
    tests/application-composition.test.ts tests/contest-query-facade.test.ts \
    tests/contest-canonical-submission-identity.test.ts \
    tests/school-contest.test.ts tests/contest.test.ts
else
  echo "Invalid ASSIGNMENT_TEST_SCOPE: expected assignment, problem-contract, platform-problem-contract, oj-account-contract, chat-contract, organization-contract, notification-contract, workspace-contract, auth-contract, user-profile-contract, team-contract, data-market-contract, contribution-contract, platform-binding-contract, ranking-contract, ai-governance-contract, authorization, release-invariants, contest-core, contest-cutover or full" >&2
  exit 1
fi
