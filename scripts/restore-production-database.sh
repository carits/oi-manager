#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="${OI_MANAGER_ROOT:-/data/oi-manager-response-refactor}"
DB_CONTAINER="${RESTORE_DB_CONTAINER:-oi-postgres}"
DB_USER="${RESTORE_DB_USER:-oi}"
DB_NAME="${RESTORE_DB_NAME:-oi_manager}"
AUDIT_DIR="${RESTORE_AUDIT_DIR:-/data/backups/oi-manager/disaster-recovery}"
SKIP_SERVICE_CONTROL="${RESTORE_SKIP_SERVICE_CONTROL:-false}"
SKIP_MIGRATE="${RESTORE_SKIP_MIGRATE:-false}"
ALLOW_ISOLATED="${RESTORE_ALLOW_ISOLATED:-false}"
BACKUP_FILE=""
EXPECTED_SHA256=""
CONFIRM_DATABASE=""
APPLY=false

usage() {
  cat <<'USAGE'
Usage:
  restore-production-database.sh --backup /absolute/path.dump \
    --sha256 <64-hex> --confirm-database oi_manager --apply

The command first restores and validates the archive in a temporary database,
then stops application writes, creates a pre-restore backup, replaces the exact
target database, applies migrations, validates it, and starts the previous slot.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup) BACKUP_FILE="${2:-}"; shift 2 ;;
    --sha256) EXPECTED_SHA256="${2:-}"; shift 2 ;;
    --confirm-database) CONFIRM_DATABASE="${2:-}"; shift 2 ;;
    --apply) APPLY=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$APPLY" != true ]]; then
  echo "Refusing database replacement without --apply" >&2
  exit 2
fi
if [[ "$DB_NAME" != "oi_manager" || "$CONFIRM_DATABASE" != "$DB_NAME" ]]; then
  echo "Target confirmation mismatch; expected --confirm-database oi_manager" >&2
  exit 2
fi
if [[ ! "$EXPECTED_SHA256" =~ ^[a-f0-9]{64}$ ]]; then
  echo "--sha256 must be a lowercase 64-character SHA-256" >&2
  exit 2
fi
if [[ "$BACKUP_FILE" != /* || ! -f "$BACKUP_FILE" || ! -s "$BACKUP_FILE" ]]; then
  echo "--backup must be an existing, non-empty absolute file" >&2
  exit 2
fi
BACKUP_FILE="$(readlink -f -- "$BACKUP_FILE")"
if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "Unable to resolve the backup archive" >&2
  exit 2
fi
case "$BACKUP_FILE" in
  /data/backups/oi-manager/*) ;;
  *)
    if [[ "$ALLOW_ISOLATED" != true ]]; then
      echo "Production restore archives must be below /data/backups/oi-manager" >&2
      exit 2
    fi
    ;;
esac

if [[ "$ALLOW_ISOLATED" != true ]]; then
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "Production database replacement must run as root" >&2
    exit 2
  fi
  case "$(readlink -m -- "$AUDIT_DIR")" in
    /data/backups/oi-manager/disaster-recovery|/data/backups/oi-manager/disaster-recovery/*) ;;
    *) echo "Production restore audit files must remain below /data/backups/oi-manager/disaster-recovery" >&2; exit 2 ;;
  esac
fi

if [[ "$DB_CONTAINER" != "oi-postgres" ]]; then
  if [[ "$ALLOW_ISOLATED" != true ]]; then
    echo "Refusing a non-production container without RESTORE_ALLOW_ISOLATED=true" >&2
    exit 2
  fi
  owner_label="$(docker inspect "$DB_CONTAINER" --format '{{index .Config.Labels "oi-manager.restore-script-test"}}' 2>/dev/null || true)"
  if [[ "$owner_label" != "true" ]]; then
    echo "Isolated restore container lacks the ownership label" >&2
    exit 2
  fi
fi
if [[ "$SKIP_SERVICE_CONTROL" == true && "$ALLOW_ISOLATED" != true ]]; then
  echo "Skipping service control is permitted only for an owned isolated test" >&2
  exit 2
fi
if [[ "$SKIP_MIGRATE" == true && "$ALLOW_ISOLATED" != true ]]; then
  echo "Skipping migrations is permitted only for an owned isolated test" >&2
  exit 2
fi

actual_sha256="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
if [[ "$actual_sha256" != "$EXPECTED_SHA256" ]]; then
  echo "Backup SHA-256 mismatch" >&2
  exit 2
fi
docker exec -i "$DB_CONTAINER" pg_restore -l <"$BACKUP_FILE" >/dev/null

mkdir -p "$AUDIT_DIR"
chmod 700 "$AUDIT_DIR"
exec 9>"$AUDIT_DIR/restore.lock"
if ! flock -n 9; then
  echo "Another disaster restore is already running" >&2
  exit 3
fi

timestamp="$(date +%Y%m%d_%H%M%S)"
candidate_db="oi_manager_restore_candidate_${$}"
if [[ ! "$candidate_db" =~ ^oi_manager_restore_candidate_[0-9]+$ ]]; then exit 2; fi
pre_restore_backup="$AUDIT_DIR/${DB_NAME}_pre_restore_${timestamp}.dump"
log_file="$AUDIT_DIR/restore_${timestamp}.log"
active_slot="$(cat "$ROOT_DIR/.run/api-active-upstream" 2>/dev/null || echo 3302)"
if [[ "$active_slot" != 3302 && "$active_slot" != 3303 ]]; then
  echo "Invalid active API slot: $active_slot" >&2
  exit 2
fi

services_stopped=false
replacement_started=false
rollback_required=false

log() {
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*" | tee -a "$log_file"
}

validate_database() {
  local database="$1"
  local tables migrations users
  tables="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$database" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
  migrations="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$database" -tAc 'SELECT count(*) FROM public._prisma_migrations')"
  users="$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$database" -tAc 'SELECT count(*) FROM public."User"')"
  [[ "$tables" =~ ^[0-9]+$ && "$migrations" =~ ^[0-9]+$ && "$users" =~ ^[0-9]+$ ]]
  (( tables > 0 && migrations > 0 && users > 0 ))
  log "validated database=$database tables=$tables migrations=$migrations users=$users"
}

terminate_connections() {
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" >/dev/null
}

replace_target_from() {
  local archive="$1"
  terminate_connections
  docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$DB_NAME"
  docker exec "$DB_CONTAINER" createdb -U "$DB_USER" "$DB_NAME"
  docker exec -i "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges <"$archive"
}

start_services() {
  [[ "$SKIP_SERVICE_CONTROL" == true ]] && return 0
  systemctl start "oi-manager-server@${active_slot}.service"
  systemctl start oi-manager-api-router.service
  systemctl start oi-manager-worker.service
  systemctl start oi-manager-executor@1.service
  systemctl start oi-manager-judge.service
  systemctl start oi-manager-web.service
  local ready=false
  for _ in $(seq 1 60); do
    if curl --fail --silent --max-time 3 http://127.0.0.1:3002/api/readiness >/dev/null \
      && curl --fail --silent --max-time 3 http://127.0.0.1:3000/api/health >/dev/null; then
      ready=true
      break
    fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then
    echo "Application services did not become ready within 60 seconds" >&2
    return 1
  fi
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$candidate_db" >/dev/null 2>&1 || true
  if [[ "$status" -ne 0 && "$rollback_required" == true && -s "$pre_restore_backup" ]]; then
    log "restore failed; rolling back from $pre_restore_backup"
    if replace_target_from "$pre_restore_backup" && validate_database "$DB_NAME"; then
      rollback_required=false
      start_services || true
      log "rollback completed"
    else
      log "ROLLBACK FAILED; application writes remain stopped"
    fi
  elif [[ "$status" -ne 0 && "$services_stopped" == true ]]; then
    start_services || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

log "candidate validation started backup=$BACKUP_FILE sha256=$actual_sha256"
docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$candidate_db" >/dev/null
docker exec "$DB_CONTAINER" createdb -U "$DB_USER" "$candidate_db"
docker exec -i "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$candidate_db" --no-owner --no-privileges <"$BACKUP_FILE"
validate_database "$candidate_db"

if [[ "$SKIP_SERVICE_CONTROL" != true ]]; then
  log "stopping application writes; active_slot=$active_slot"
  services_stopped=true
  systemctl stop oi-manager-judge.service oi-manager-executor@1.service oi-manager-worker.service oi-manager-api-router.service \
    oi-manager-server@3302.service oi-manager-server@3303.service
fi

log "creating pre-restore backup=$pre_restore_backup"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" >"${pre_restore_backup}.tmp"
docker exec -i "$DB_CONTAINER" pg_restore -l <"${pre_restore_backup}.tmp" >/dev/null
mv "${pre_restore_backup}.tmp" "$pre_restore_backup"
chmod 600 "$pre_restore_backup"
sha256sum "$pre_restore_backup" >"${pre_restore_backup}.sha256"
chmod 600 "${pre_restore_backup}.sha256"
rollback_required=true
replacement_started=true

log "replacing exact database=$DB_NAME"
replace_target_from "$BACKUP_FILE"
if [[ "$SKIP_MIGRATE" != true ]]; then
  (cd "$ROOT_DIR/apps/server" && pnpm exec prisma migrate deploy) | tee -a "$log_file"
fi
validate_database "$DB_NAME"
rollback_required=false
start_services
services_stopped=false
log "restore completed backup=$BACKUP_FILE pre_restore_backup=$pre_restore_backup"

trap - EXIT INT TERM
docker exec "$DB_CONTAINER" dropdb -U "$DB_USER" --if-exists "$candidate_db" >/dev/null
