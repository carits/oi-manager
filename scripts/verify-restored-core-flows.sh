#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="$ROOT_DIR/test-results/restore-audit"
CONTAINER_NAME="${RESTORE_CORE_CONTAINER:-oi-manager-e2e-restore-postgres}"
CONTAINER_LABEL="oi-manager.restore-audit=true"
GO_JUDGE_NAME="oi-manager-e2e-restore-go-judge"
POSTGRES_PORT="${RESTORE_CORE_POSTGRES_PORT:-15435}"
POSTGRES_USER="restore_audit"
POSTGRES_PASSWORD="restore_audit_only_password"
POSTGRES_DB="oi_manager"
BACKUP_DIR="${RESTORE_BACKUP_DIR:-/data/backups/oi-manager/automatic}"
BACKUP_FILE="${1:-}"
STARTED=0

if [[ "$RESULTS_DIR" != "$ROOT_DIR/test-results/restore-audit" ]]; then
  echo "Unsafe restore audit results directory: $RESULTS_DIR" >&2
  exit 2
fi
if [[ ! "$CONTAINER_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  echo "Unsafe restore audit container name: $CONTAINER_NAME" >&2
  exit 2
fi
if [[ "$POSTGRES_PORT" != "15435" ]]; then
  echo "Restore audit is pinned to dedicated PostgreSQL port 15435" >&2
  exit 2
fi

if [[ -z "$BACKUP_FILE" ]]; then
  BACKUP_FILE="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'oi_manager_*.dump' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
fi
if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "No production backup archive found for core restore verification" >&2
  exit 2
fi
if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  echo "Refusing to replace existing container $CONTAINER_NAME" >&2
  exit 3
fi
if ss -ltn "sport = :$POSTGRES_PORT" | grep -q LISTEN; then
  echo "Dedicated restore audit port $POSTGRES_PORT is already in use" >&2
  exit 3
fi

cleanup() {
  trap - EXIT INT TERM
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$GO_JUDGE_NAME"; then
    label="$(docker inspect "$GO_JUDGE_NAME" --format '{{index .Config.Labels "oi-manager.restore-audit"}}' 2>/dev/null || true)"
    if [[ "$label" == "true" ]]; then docker stop --time 10 "$GO_JUDGE_NAME" >/dev/null 2>&1 || true; fi
  fi
  if [[ "$STARTED" == 1 ]]; then
    docker stop --time 10 "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if docker ps -a --format '{{.Names}}' | grep -Fxq "$GO_JUDGE_NAME"; then
  go_judge_label="$(docker inspect "$GO_JUDGE_NAME" --format '{{index .Config.Labels "oi-manager.restore-audit"}}' 2>/dev/null || true)"
  if [[ "$go_judge_label" != "true" ]]; then
    echo "Refusing to replace non-audit container $GO_JUDGE_NAME" >&2
    exit 3
  fi
  docker stop --time 10 "$GO_JUDGE_NAME" >/dev/null
fi

rm -rf -- "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR"
backup_sha256="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
restore_started_ms="$(date +%s%3N)"

docker run --detach --rm \
  --name "$CONTAINER_NAME" \
  --label "$CONTAINER_LABEL" \
  --publish "127.0.0.1:${POSTGRES_PORT}:5432" \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1g \
  --env "POSTGRES_USER=$POSTGRES_USER" \
  --env "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
  --env "POSTGRES_DB=$POSTGRES_DB" \
  postgres:16-alpine >"$RESULTS_DIR/postgres.container-id"
STARTED=1

postgres_ready=0
for _ in $(seq 1 120); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    postgres_ready=1
    break
  fi
  sleep 0.25
done
if [[ "$postgres_ready" != 1 ]]; then
  docker logs "$CONTAINER_NAME" >&2 || true
  echo "Restore audit PostgreSQL did not become ready" >&2
  exit 4
fi
# The official image briefly exposes the bootstrap server before restarting
# PostgreSQL as PID 1. Wait through that handoff before copying/restoring data.
sleep 1
postgres_ready=0
for _ in $(seq 1 120); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    postgres_ready=1
    break
  fi
  sleep 0.25
done
if [[ "$postgres_ready" != 1 ]]; then
  docker logs "$CONTAINER_NAME" >&2 || true
  echo "Restore audit PostgreSQL did not survive its bootstrap handoff" >&2
  exit 4
fi

container_archive="/tmp/restore-audit.dump"
docker cp "$BACKUP_FILE" "$CONTAINER_NAME:$container_archive" >/dev/null
docker exec "$CONTAINER_NAME" pg_restore \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges "$container_archive"
docker exec "$CONTAINER_NAME" rm -f -- "$container_archive"

restored_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public"
e2e_url="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}?schema=e2e"

(
  cd "$ROOT_DIR/apps/server"
  DATABASE_URL="$restored_url" pnpm exec prisma migrate deploy
  DATABASE_URL="$restored_url" pnpm exec prisma migrate status
) | tee "$RESULTS_DIR/migrate.log"

restore_finished_ms="$(date +%s%3N)"
table_count="$(docker exec "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
migration_count="$(docker exec "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT count(*) FROM public._prisma_migrations')"
user_count="$(docker exec "$CONTAINER_NAME" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT count(*) FROM public."User"')"

E2E_DATABASE_URL="$e2e_url" pnpm test:ui:prepare | tee "$RESULTS_DIR/e2e-prepare.log"
E2E_DATABASE_URL="$e2e_url" \
RESTORED_DATABASE_URL="$restored_url" \
pnpm exec playwright test --config=playwright.restore.config.ts | tee "$RESULTS_DIR/playwright.log"

finished_at="$(date --iso-8601=seconds)"
cat >"$RESULTS_DIR/manifest.json" <<JSON
{
  "backup": "${BACKUP_FILE}",
  "backupSha256": "${backup_sha256}",
  "restoreDurationMs": $((restore_finished_ms - restore_started_ms)),
  "tables": ${table_count},
  "migrations": ${migration_count},
  "users": ${user_count},
  "postgresPort": ${POSTGRES_PORT},
  "productionSchemaReadOnly": true,
  "writeSchema": "e2e",
  "completedAt": "${finished_at}"
}
JSON

printf 'backup=%s sha256=%s restore_ms=%s tables=%s migrations=%s users=%s result=%s\n' \
  "$BACKUP_FILE" "$backup_sha256" "$((restore_finished_ms - restore_started_ms))" \
  "$table_count" "$migration_count" "$user_count" "$RESULTS_DIR/manifest.json"
