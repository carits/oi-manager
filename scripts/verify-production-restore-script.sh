#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="$ROOT_DIR/test-results/disaster-restore"
CONTAINER="oi-manager-e2e-disaster-restore-postgres"
PORT=15436
STARTED=0

if [[ "$RESULTS_DIR" != "$ROOT_DIR/test-results/disaster-restore" ]]; then exit 2; fi
if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
  echo "Refusing to replace existing container $CONTAINER" >&2
  exit 3
fi
cleanup() {
  trap - EXIT INT TERM
  if [[ "$STARTED" == 1 ]]; then docker stop --time 10 "$CONTAINER" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR/audit"

docker run -d --rm --name "$CONTAINER" --label oi-manager.restore-script-test=true \
  -p "127.0.0.1:${PORT}:5432" -e POSTGRES_USER=restore_test \
  -e POSTGRES_PASSWORD=restore_test -e POSTGRES_DB=oi_manager postgres:16-alpine >/dev/null
STARTED=1
for _ in $(seq 1 120); do
  if docker exec "$CONTAINER" pg_isready -U restore_test -d oi_manager >/dev/null 2>&1; then sleep 2; break; fi
  sleep .25
done
docker exec "$CONTAINER" pg_isready -U restore_test -d oi_manager >/dev/null

schema_sql='CREATE TABLE public._prisma_migrations(id text primary key); CREATE TABLE public."User"(id text primary key, marker text);'
docker exec "$CONTAINER" psql -U restore_test -d oi_manager -v ON_ERROR_STOP=1 -c "$schema_sql" >/dev/null
docker exec "$CONTAINER" psql -U restore_test -d oi_manager -v ON_ERROR_STOP=1 -c \
  "INSERT INTO public._prisma_migrations VALUES ('old'); INSERT INTO public.\"User\" VALUES ('user-old','before');" >/dev/null

docker exec "$CONTAINER" createdb -U restore_test candidate_source
docker exec "$CONTAINER" psql -U restore_test -d candidate_source -v ON_ERROR_STOP=1 -c "$schema_sql" >/dev/null
docker exec "$CONTAINER" psql -U restore_test -d candidate_source -v ON_ERROR_STOP=1 -c \
  "INSERT INTO public._prisma_migrations VALUES ('new'); INSERT INTO public.\"User\" VALUES ('user-new','after');" >/dev/null
candidate="$RESULTS_DIR/candidate.dump"
docker exec "$CONTAINER" pg_dump -U restore_test -Fc candidate_source >"$candidate"
sha="$(sha256sum "$candidate" | awk '{print $1}')"
if [[ "${sha: -1}" == 0 ]]; then wrong_sha="${sha%?}1"; else wrong_sha="${sha%?}0"; fi

if RESTORE_DB_CONTAINER="$CONTAINER" RESTORE_DB_USER=restore_test RESTORE_ALLOW_ISOLATED=true \
  RESTORE_SKIP_SERVICE_CONTROL=true RESTORE_SKIP_MIGRATE=true RESTORE_AUDIT_DIR="$RESULTS_DIR/audit" \
  bash "$ROOT_DIR/scripts/restore-production-database.sh" --backup "$candidate" --sha256 "$wrong_sha" \
    --confirm-database oi_manager --apply >/dev/null 2>&1; then
  echo "Restore script accepted the wrong SHA-256" >&2
  exit 1
fi
before="$(docker exec "$CONTAINER" psql -U restore_test -d oi_manager -tAc 'SELECT marker FROM public."User"')"
[[ "$before" == before ]]

RESTORE_DB_CONTAINER="$CONTAINER" RESTORE_DB_USER=restore_test RESTORE_ALLOW_ISOLATED=true \
  RESTORE_SKIP_SERVICE_CONTROL=true RESTORE_SKIP_MIGRATE=true RESTORE_AUDIT_DIR="$RESULTS_DIR/audit" \
  bash "$ROOT_DIR/scripts/restore-production-database.sh" --backup "$candidate" --sha256 "$sha" \
    --confirm-database oi_manager --apply | tee "$RESULTS_DIR/restore.log"

after="$(docker exec "$CONTAINER" psql -U restore_test -d oi_manager -tAc 'SELECT marker FROM public."User"')"
[[ "$after" == after ]]
pre_restore="$(find "$RESULTS_DIR/audit" -maxdepth 1 -type f -name 'oi_manager_pre_restore_*.dump' | head -n1)"
[[ -s "$pre_restore" && -s "${pre_restore}.sha256" ]]
sha256sum -c "${pre_restore}.sha256" >/dev/null
docker exec "$CONTAINER" createdb -U restore_test verify_pre_restore >/dev/null
docker exec -i "$CONTAINER" pg_restore -U restore_test -d verify_pre_restore <"$pre_restore"
pre_marker="$(docker exec "$CONTAINER" psql -U restore_test -d verify_pre_restore -tAc 'SELECT marker FROM public."User"')"
[[ "$pre_marker" == before ]]

printf 'disaster restore verifier passed: before=%s after=%s candidate_sha256=%s\n' "$before" "$after" "$sha"
