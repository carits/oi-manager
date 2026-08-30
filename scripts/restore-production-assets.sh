#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "${ASSET_RESTORE_TRACE:-false}" == true ]] && set -x

ROOT_DIR="${OI_MANAGER_ROOT:-/data/oi-manager-response-refactor}"
SERVER_ROOT="${ASSET_RESTORE_SERVER_ROOT:-$ROOT_DIR/apps/server}"
TESTDATA_DIR="${ASSET_RESTORE_TESTDATA_DIR:-$SERVER_ROOT/testdata}"
UPLOADS_DIR="${ASSET_RESTORE_UPLOADS_DIR:-$SERVER_ROOT/uploads}"
BACKUP_DIR="${ASSET_BACKUP_DIR:-/data/backups/oi-manager/assets}"
SNAPSHOT_ROOT="$BACKUP_DIR/snapshots"
DB_BACKUP_DIR="${ASSET_DB_BACKUP_DIR:-/data/backups/oi-manager/automatic}"
AUDIT_DIR="${ASSET_RESTORE_AUDIT_DIR:-/data/backups/oi-manager/disaster-recovery}"
ALLOW_ISOLATED="${ASSET_RESTORE_ALLOW_ISOLATED:-false}"
SKIP_SERVICE_CONTROL="${ASSET_RESTORE_SKIP_SERVICE_CONTROL:-false}"
SNAPSHOT=""
EXPECTED_DATABASE_SHA256=""
CONFIRM_ROOT=""
APPLY=false

usage() {
  cat <<'USAGE'
Usage:
  restore-production-assets.sh --snapshot /absolute/snapshot-directory \
    --database-sha256 <64-hex> \
    --confirm-root /data/oi-manager-response-refactor/apps/server --apply

The selected asset snapshot must be paired with the database backup SHA-256
that will be restored. The command validates the complete snapshot, preserves a
pre-restore asset snapshot, stops application writes, restores testdata/uploads,
verifies every file and symlink, and rolls back assets if validation fails.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --snapshot) SNAPSHOT="${2:-}"; shift 2 ;;
    --database-sha256) EXPECTED_DATABASE_SHA256="${2:-}"; shift 2 ;;
    --confirm-root) CONFIRM_ROOT="${2:-}"; shift 2 ;;
    --apply) APPLY=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$APPLY" == true ]] || { echo 'Refusing asset replacement without --apply' >&2; exit 2; }
[[ "$EXPECTED_DATABASE_SHA256" =~ ^[a-f0-9]{64}$ ]] || { echo '--database-sha256 must be lowercase SHA-256' >&2; exit 2; }
[[ "$SNAPSHOT" == /* && -d "$SNAPSHOT" ]] || { echo '--snapshot must be an existing absolute directory' >&2; exit 2; }

server_real="$(realpath -m "$SERVER_ROOT")"
testdata_real="$(realpath -m "$TESTDATA_DIR")"
uploads_real="$(realpath -m "$UPLOADS_DIR")"
snapshot_root_real="$(realpath "$SNAPSHOT_ROOT")"
snapshot_real="$(realpath "$SNAPSHOT")"
snapshot_name="$(basename "$snapshot_real")"

[[ "$CONFIRM_ROOT" == "$server_real" ]] || { echo "Target confirmation mismatch; expected --confirm-root $server_real" >&2; exit 2; }
[[ "$snapshot_real" == "$snapshot_root_real"/* && "$snapshot_name" =~ ^snapshot-20[0-9]{6}T[0-9]{6}Z(-[0-9]+)?$ ]] || { echo 'Snapshot is outside the managed asset backup root' >&2; exit 2; }
[[ "$testdata_real" != / && "$uploads_real" != / && "$testdata_real" != "$uploads_real" ]] || { echo 'Unsafe asset destination roots' >&2; exit 2; }

if [[ "$ALLOW_ISOLATED" != true ]]; then
  [[ "$(id -u)" == 0 ]] || { echo 'Production asset restore must run as root' >&2; exit 2; }
  [[ "$server_real" == /data/oi-manager-response-refactor/apps/server ]] || { echo 'Production server root mismatch' >&2; exit 2; }
  [[ "$testdata_real" == "$server_real/testdata" && "$uploads_real" == "$server_real/uploads" ]] || { echo 'Production asset destination mismatch' >&2; exit 2; }
  [[ "$SKIP_SERVICE_CONTROL" != true ]] || { echo 'Cannot skip service control for production restore' >&2; exit 2; }
fi

metadata_file="$snapshot_real/metadata.json"
[[ -s "$metadata_file" ]] || { echo 'Snapshot metadata is missing' >&2; exit 2; }
if ! IFS=$'\t' read -r database_name expected_database_manifest_sha256 < <(node - "$metadata_file" "$snapshot_name" "$EXPECTED_DATABASE_SHA256" <<'NODE'
const fs = require('node:fs')
const [file, snapshotName, databaseSha] = process.argv.slice(2)
const value = JSON.parse(fs.readFileSync(file, 'utf8'))
if (value.status !== 'complete' || value.snapshotName !== snapshotName) throw new Error('Snapshot identity mismatch')
if (value.databaseBackupSha256 !== databaseSha) throw new Error('Snapshot/database SHA-256 pairing mismatch')
if (!value.databaseBackupName || value.databaseBackupName !== require('node:path').basename(value.databaseBackupName)) throw new Error('Invalid database backup name')
if (!/^[a-f0-9]{64}$/.test(value.databaseManifestSha256 || '')) throw new Error('Invalid database backup manifest SHA-256')
process.stdout.write(`${value.databaseBackupName}\t${value.databaseManifestSha256}\n`)
NODE
); then
  echo 'Snapshot metadata could not be validated' >&2
  exit 2
fi
database_path="$DB_BACKUP_DIR/$database_name"
[[ -f "$database_path" ]] || { echo "Paired database backup is missing: $database_path" >&2; exit 2; }
[[ "$(sha256sum "$database_path" | cut -d' ' -f1)" == "$EXPECTED_DATABASE_SHA256" ]] || { echo 'Paired database backup bytes changed' >&2; exit 2; }
database_manifest="${database_path}.manifest.json"
[[ -s "$database_manifest" ]] || { echo "Paired database backup manifest is missing: $database_manifest" >&2; exit 2; }
[[ "$(sha256sum "$database_manifest" | cut -d' ' -f1)" == "$expected_database_manifest_sha256" ]] || { echo 'Paired database backup manifest changed' >&2; exit 2; }
node - "$database_manifest" "$database_name" "$EXPECTED_DATABASE_SHA256" "$(stat -c '%s' "$database_path")" <<'NODE'
const fs = require('node:fs')
const [file, expectedName, expectedSha256, expectedSize] = process.argv.slice(2)
const value = JSON.parse(fs.readFileSync(file, 'utf8'))
if (value.schemaVersion !== 1 || value.backupName !== expectedName || value.backupSha256 !== expectedSha256 ||
    Number(value.backupSize) !== Number(expectedSize)) throw new Error('Database backup creation manifest mismatch')
NODE

mkdir -p "$AUDIT_DIR"
chmod 700 "$AUDIT_DIR"
exec 9>"$AUDIT_DIR/asset-restore.lock"
flock -n 9 || { echo 'Another asset restore is already running' >&2; exit 3; }

ASSET_BACKUP_DIR="$BACKUP_DIR" ASSET_DB_BACKUP_DIR="$DB_BACKUP_DIR" \
  ASSET_RESTORE_STATE_FILE="$BACKUP_DIR/asset-restore-verification.json" \
  "$ROOT_DIR/scripts/verify-assets-restore.sh" "$snapshot_real" >/dev/null

timestamp="$(date +%Y%m%d_%H%M%S)"
log_file="$AUDIT_DIR/asset_restore_${timestamp}.log"
active_slot="$(cat "$ROOT_DIR/.run/api-active-upstream" 2>/dev/null || echo 3302)"
[[ "$active_slot" == 3302 || "$active_slot" == 3303 ]] || { echo "Invalid active API slot: $active_slot" >&2; exit 2; }
services_stopped=false
rollback_required=false
pre_restore_snapshot=""

log() { printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*" | tee -a "$log_file"; }

start_services() {
  [[ "$SKIP_SERVICE_CONTROL" == true ]] && return 0
  systemctl start "oi-manager-server@${active_slot}.service" oi-manager-api-router.service \
    oi-manager-worker.service oi-manager-executor@1.service oi-manager-judge.service oi-manager-web.service
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 3 http://127.0.0.1:3002/api/readiness >/dev/null \
      && curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null; then return 0; fi
    sleep 1
  done
  echo 'Application services did not become ready after asset restore' >&2
  return 1
}

stop_services() {
  [[ "$SKIP_SERVICE_CONTROL" == true ]] && return 0
  systemctl stop oi-manager-web.service oi-manager-judge.service oi-manager-executor@1.service \
    oi-manager-worker.service oi-manager-api-router.service "oi-manager-server@${active_slot}.service"
}

restore_from_snapshot() {
  local source="$1"
  mkdir -p "$testdata_real" "$uploads_real"
  rsync -aHc --delete --numeric-ids "$source/testdata/" "$testdata_real/"
  rsync -aHc --delete --numeric-ids "$source/uploads/" "$uploads_real/"
  (cd "$server_real" && sha256sum -c "$source/manifest.sha256" >/dev/null)
  local restored_links="$AUDIT_DIR/.asset-links-restored.$$"
  (cd "$server_real" && find testdata uploads -type l -printf '%p -> %l\n' | LC_ALL=C sort > "$restored_links")
  cmp --silent "$source/links.manifest" "$restored_links"
  rm -f -- "$restored_links"
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ "$status" -ne 0 && "$rollback_required" == true && -n "$pre_restore_snapshot" ]]; then
    log "asset restore failed; rolling back from $pre_restore_snapshot"
    if restore_from_snapshot "$pre_restore_snapshot"; then
      rollback_required=false
      start_services || true
      log 'asset rollback completed'
    else
      log 'ASSET ROLLBACK FAILED; application writes remain stopped'
    fi
  elif [[ "$status" -ne 0 && "$services_stopped" == true ]]; then
    start_services || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

pre_output="$(ASSET_TESTDATA_DIR="$testdata_real" ASSET_UPLOADS_DIR="$uploads_real" \
  ASSET_BACKUP_DIR="$BACKUP_DIR" ASSET_DB_BACKUP_DIR="$DB_BACKUP_DIR" \
  ASSET_BACKUP_LOCK_FILE="$AUDIT_DIR/pre-asset-backup.lock" "$ROOT_DIR/scripts/backup-assets.sh")"
pre_restore_snapshot="$(sed -n 's/^asset_snapshot=\([^ ]*\).*/\1/p' <<<"$pre_output")"
[[ -d "$pre_restore_snapshot" ]] || { echo 'Failed to create pre-restore asset snapshot' >&2; exit 4; }
log "validated target=$snapshot_name database=$database_name pre_restore=$(basename "$pre_restore_snapshot")"

stop_services
services_stopped=true
rollback_required=true
restore_from_snapshot "$snapshot_real"
start_services
rollback_required=false
services_stopped=false
log "asset restore completed snapshot=$snapshot_name database_sha256=$EXPECTED_DATABASE_SHA256"
