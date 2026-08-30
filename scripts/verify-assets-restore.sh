#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

BACKUP_DIR="${ASSET_BACKUP_DIR:-/data/backups/oi-manager/assets}"
SNAPSHOT_DIR="$BACKUP_DIR/snapshots"
DB_BACKUP_DIR="${ASSET_DB_BACKUP_DIR:-/data/backups/oi-manager/automatic}"
STATE_FILE="${ASSET_RESTORE_STATE_FILE:-$BACKUP_DIR/asset-restore-verification.json}"
LOCK_FILE="${ASSET_RESTORE_LOCK_FILE:-/tmp/oi-manager-asset-restore-verification.lock}"
SNAPSHOT="${1:-}"

mkdir -p "$BACKUP_DIR" "$SNAPSHOT_DIR"
chmod 700 "$BACKUP_DIR" "$SNAPSHOT_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo 'Another asset restore verification is already running; skipped'; exit 0; }

snapshot_name=""
manifest_sha256=""
file_count=0
link_count=0
total_bytes=0
database_name=""
database_sha256=""
database_manifest_sha256=""
restore_dir=""

write_state() {
  local status="$1"
  node - "$STATE_FILE" "$status" "$snapshot_name" "$manifest_sha256" "$file_count" "$link_count" "$total_bytes" \
    "$database_name" "$database_sha256" "$database_manifest_sha256" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [file, status, snapshotName, manifestSha256, fileCount, linkCount, totalBytes, databaseBackupName, databaseBackupSha256, databaseManifestSha256] = process.argv.slice(2)
const now = new Date().toISOString()
const payload = {
  schemaVersion: 2,
  status,
  checkedAt: now,
  verifiedAt: status === 'healthy' ? now : null,
  snapshotName: snapshotName || null,
  manifestSha256: manifestSha256 || null,
  fileCount: Number(fileCount || 0),
  linkCount: Number(linkCount || 0),
  totalBytes: Number(totalBytes || 0),
  databaseBackupName: databaseBackupName || null,
  databaseBackupSha256: databaseBackupSha256 || null,
  databaseManifestSha256: databaseManifestSha256 || null,
}
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
const temporary = `${file}.next.${process.pid}`
fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
fs.renameSync(temporary, file)
NODE
}

cleanup() {
  if [ -n "$restore_dir" ] && [ -d "$restore_dir" ]; then rm -rf -- "$restore_dir"; fi
}
finish() {
  local result="$?"
  trap - EXIT
  cleanup
  if [ "$result" -eq 0 ]; then write_state healthy; else write_state failed || true; fi
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT TERM

if [ -z "$SNAPSHOT" ]; then
  SNAPSHOT="$(find "$SNAPSHOT_DIR" -mindepth 1 -maxdepth 1 -type d -name 'snapshot-20??????T??????Z*' -printf '%T@ %f\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
  [ -n "$SNAPSHOT" ] && SNAPSHOT="$SNAPSHOT_DIR/$SNAPSHOT"
fi
if [ -z "$SNAPSHOT" ] || [ ! -d "$SNAPSHOT" ]; then
  echo 'No complete asset snapshot found for restore verification.' >&2
  exit 1
fi

snapshot_real="$(realpath "$SNAPSHOT")"
snapshot_root_real="$(realpath "$SNAPSHOT_DIR")"
snapshot_name="$(basename "$snapshot_real")"
[[ "$snapshot_real" == "$snapshot_root_real"/* && "$snapshot_name" =~ ^snapshot-20[0-9]{6}T[0-9]{6}Z(-[0-9]+)?$ ]] || {
  echo "Unsafe asset snapshot path: $snapshot_real" >&2
  exit 2
}
for required in metadata.json manifest.sha256 links.manifest testdata uploads; do
  [ -e "$snapshot_real/$required" ] || { echo "Asset snapshot is incomplete: $required" >&2; exit 1; }
done

manifest_sha256="$(sha256sum "$snapshot_real/manifest.sha256" | cut -d' ' -f1)"
links_sha256="$(sha256sum "$snapshot_real/links.manifest" | cut -d' ' -f1)"
if ! IFS=$'\t' read -r expected_name expected_files expected_links expected_bytes expected_manifest expected_links_sha database_name database_sha256 database_manifest_sha256 < <(
  node - "$snapshot_real/metadata.json" <<'NODE'
const fs = require('node:fs')
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const fields = [value.snapshotName, value.fileCount, value.linkCount, value.totalBytes, value.manifestSha256, value.linksSha256, value.databaseBackupName || '', value.databaseBackupSha256 || '', value.databaseManifestSha256 || '']
if (value.schemaVersion !== 1 || value.status !== 'complete' || !/^snapshot-20\d{6}T\d{6}Z(?:-\d+)?$/.test(String(fields[0])) ||
    !Number.isInteger(Number(fields[1])) || !Number.isInteger(Number(fields[2])) || !Number.isInteger(Number(fields[3])) ||
    !/^[a-f0-9]{64}$/.test(String(fields[4])) || !/^[a-f0-9]{64}$/.test(String(fields[5]))) throw new Error('Invalid asset snapshot metadata')
process.stdout.write(`${fields.join('\t')}\n`)
NODE
); then
  echo 'Asset snapshot metadata could not be parsed.' >&2
  exit 1
fi
if [ "$expected_name" != "$snapshot_name" ] || [ "$expected_manifest" != "$manifest_sha256" ] || [ "$expected_links_sha" != "$links_sha256" ]; then
  echo 'Asset snapshot identity or manifest hash mismatch.' >&2
  exit 1
fi
if [ -z "$database_name" ] || ! [[ "$database_sha256" =~ ^[a-f0-9]{64}$ ]] || ! [[ "$database_manifest_sha256" =~ ^[a-f0-9]{64}$ ]]; then
  echo 'Asset snapshot is not linked to a verified database backup.' >&2
  exit 1
fi
database_path="$DB_BACKUP_DIR/$database_name"
if [ ! -f "$database_path" ] || [ "$(sha256sum "$database_path" | cut -d' ' -f1)" != "$database_sha256" ]; then
  echo 'Asset snapshot database backup is missing or changed.' >&2
  exit 1
fi
database_manifest="${database_path}.manifest.json"
if [ ! -s "$database_manifest" ] || [ "$(sha256sum "$database_manifest" | cut -d' ' -f1)" != "$database_manifest_sha256" ]; then
  echo 'Asset snapshot database creation manifest is missing or changed.' >&2
  exit 1
fi
node - "$database_manifest" "$database_name" "$database_sha256" "$(stat -c '%s' "$database_path")" <<'NODE'
const fs = require('node:fs')
const [file, expectedName, expectedSha256, expectedSize] = process.argv.slice(2)
const value = JSON.parse(fs.readFileSync(file, 'utf8'))
if (value.schemaVersion !== 1 || value.backupName !== expectedName || value.backupSha256 !== expectedSha256 ||
    Number(value.backupSize) !== Number(expectedSize)) throw new Error('Database backup creation manifest mismatch')
NODE

restore_dir="$(mktemp -d "$BACKUP_DIR/.restore.XXXXXX")"
mkdir -p "$restore_dir/testdata" "$restore_dir/uploads"
rsync -a --numeric-ids "$snapshot_real/testdata/" "$restore_dir/testdata/"
rsync -a --numeric-ids "$snapshot_real/uploads/" "$restore_dir/uploads/"
cp -- "$snapshot_real/manifest.sha256" "$restore_dir/manifest.sha256"
cp -- "$snapshot_real/links.manifest" "$restore_dir/links.manifest"
(cd "$restore_dir" && sha256sum -c manifest.sha256 >/dev/null)
(cd "$restore_dir" && find testdata uploads -type l -printf '%p -> %l\n' | LC_ALL=C sort > links.restored)
cmp --silent "$restore_dir/links.manifest" "$restore_dir/links.restored"

file_count="$(find "$restore_dir/testdata" "$restore_dir/uploads" -type f | wc -l)"
link_count="$(find "$restore_dir/testdata" "$restore_dir/uploads" -type l | wc -l)"
total_bytes="$(find "$restore_dir/testdata" "$restore_dir/uploads" -type f -printf '%s\n' | awk '{ total += $1 } END { print total + 0 }')"
if [ "$file_count" != "$expected_files" ] || [ "$link_count" != "$expected_links" ] || [ "$total_bytes" != "$expected_bytes" ]; then
  echo "Restored asset inventory mismatch: expected=${expected_files}/${expected_links}/${expected_bytes} actual=${file_count}/${link_count}/${total_bytes}" >&2
  exit 1
fi

printf 'asset_snapshot=%s files=%s links=%s bytes=%s database_backup=%s\n' \
  "$snapshot_name" "$file_count" "$link_count" "$total_bytes" "$database_name"
