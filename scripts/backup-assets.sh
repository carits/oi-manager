#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TESTDATA_DIR="${ASSET_TESTDATA_DIR:-$ROOT_DIR/apps/server/testdata}"
UPLOADS_DIR="${ASSET_UPLOADS_DIR:-$ROOT_DIR/apps/server/uploads}"
BACKUP_DIR="${ASSET_BACKUP_DIR:-/data/backups/oi-manager/assets}"
SNAPSHOT_DIR="$BACKUP_DIR/snapshots"
DB_BACKUP_DIR="${ASSET_DB_BACKUP_DIR:-/data/backups/oi-manager/automatic}"
KEEP_DAYS="${ASSET_BACKUP_KEEP_DAYS:-14}"
LOCK_FILE="${ASSET_BACKUP_LOCK_FILE:-/tmp/oi-manager-asset-backup.lock}"
DISABLE_LINK_DEST="${ASSET_DISABLE_LINK_DEST:-0}"

[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || { echo 'ASSET_BACKUP_KEEP_DAYS must be non-negative' >&2; exit 2; }
backup_candidate="$(realpath -m "$BACKUP_DIR")"
[[ "$backup_candidate" != / ]] || { echo 'Asset backup directory cannot be the filesystem root' >&2; exit 2; }
testdata_real="$(realpath "$TESTDATA_DIR")"
uploads_real="$(realpath "$UPLOADS_DIR")"
for source in "$TESTDATA_DIR" "$UPLOADS_DIR"; do
  [ -d "$source" ] || { echo "Asset source is missing: $source" >&2; exit 1; }
  resolved="$(realpath "$source")"
  [[ "$resolved" != / && "$backup_candidate" != "$resolved" && "$backup_candidate" != "$resolved"/* ]] || {
    echo "Unsafe or recursive asset source: $resolved" >&2
    exit 1
  }
done
while IFS= read -r -d '' link; do
  target="$(realpath "$link")"
  if [[ "$target" != "$testdata_real"/* && "$target" != "$uploads_real"/* ]]; then
    echo "Asset symbolic link escapes the protected roots: $link -> $target" >&2
    exit 1
  fi
done < <(find "$testdata_real" "$uploads_real" -type l -print0)

mkdir -p "$SNAPSHOT_DIR"
chmod 700 "$BACKUP_DIR" "$SNAPSHOT_DIR"
resolved_backup="$(realpath "$BACKUP_DIR")"
resolved_snapshots="$(realpath "$SNAPSHOT_DIR")"
[[ "$resolved_backup" != / && "$resolved_snapshots" == "$resolved_backup/snapshots" ]] || {
  echo "Unsafe asset backup root: $resolved_snapshots" >&2
  exit 2
}

exec 9>"$LOCK_FILE"
flock -n 9 || { echo 'Another asset backup is already running; skipped'; exit 0; }

# An asset snapshot is only useful when it can be paired with a database dump
# from the same backup chain. Ignore legacy/unpublished dumps without a
# manifest, then fail closed if the newest complete pair cannot be verified.
database_backup=""
while IFS= read -r candidate; do
  if [ -s "${candidate}.manifest.json" ]; then
    database_backup="$candidate"
    break
  fi
done < <(find "$DB_BACKUP_DIR" -maxdepth 1 -type f -name 'oi_manager_*.dump' -printf '%T@ %p\n' 2>/dev/null \
  | sort -nr | cut -d' ' -f2-)
[ -n "$database_backup" ] || {
  echo "No database backup with a creation manifest found in $DB_BACKUP_DIR" >&2
  exit 1
}
database_name="$(basename "$database_backup")"
database_sha256="$(sha256sum "$database_backup" | cut -d' ' -f1)"
database_size="$(stat -c '%s' "$database_backup")"
database_manifest="${database_backup}.manifest.json"
database_manifest_sha256="$(sha256sum "$database_manifest" | cut -d' ' -f1)"
node - "$database_manifest" "$database_name" "$database_sha256" "$database_size" <<'NODE'
const fs = require('node:fs')
const [file, expectedName, expectedSha256, expectedSize] = process.argv.slice(2)
const value = JSON.parse(fs.readFileSync(file, 'utf8'))
if (value.schemaVersion !== 1 || value.backupName !== expectedName ||
    value.backupSha256 !== expectedSha256 || Number(value.backupSize) !== Number(expectedSize)) {
  throw new Error('Database backup creation manifest does not match the selected dump')
}
NODE

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
snapshot_name="snapshot-${timestamp}-${$}"
final="$SNAPSHOT_DIR/$snapshot_name"
temporary="$(mktemp -d "$SNAPSHOT_DIR/.snapshot.XXXXXX")"
cleanup() { rm -rf -- "$temporary"; }
trap cleanup EXIT INT TERM

previous="$(find "$SNAPSHOT_DIR" -mindepth 1 -maxdepth 1 -type d -name 'snapshot-20??????T??????Z*' -printf '%T@ %f\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
[ "$DISABLE_LINK_DEST" = 1 ] && previous=""
link_options=()
if [ -n "$previous" ]; then link_options=("--link-dest=$SNAPSHOT_DIR/$previous/testdata"); fi
mkdir -p "$temporary/testdata"
rsync -aHc --no-perms --delete --numeric-ids --exclude='/.staging/' --exclude='/tmp-checkers/' \
  "${link_options[@]}" "$TESTDATA_DIR/" "$temporary/testdata/"

link_options=()
if [ -n "$previous" ]; then link_options=("--link-dest=$SNAPSHOT_DIR/$previous/uploads"); fi
mkdir -p "$temporary/uploads"
rsync -aHc --no-perms --delete --numeric-ids --exclude='/temp/' \
  "${link_options[@]}" "$UPLOADS_DIR/" "$temporary/uploads/"

(cd "$temporary" && find testdata uploads -type f -print0 | sort -z | xargs -0 -r sha256sum > manifest.sha256)
(cd "$temporary" && find testdata uploads -type l -printf '%p -> %l\n' | LC_ALL=C sort > links.manifest)
file_count="$(find "$temporary/testdata" "$temporary/uploads" -type f | wc -l)"
link_count="$(find "$temporary/testdata" "$temporary/uploads" -type l | wc -l)"
total_bytes="$(find "$temporary/testdata" "$temporary/uploads" -type f -printf '%s\n' | awk '{ total += $1 } END { print total + 0 }')"
manifest_sha256="$(sha256sum "$temporary/manifest.sha256" | cut -d' ' -f1)"
links_sha256="$(sha256sum "$temporary/links.manifest" | cut -d' ' -f1)"

node - "$temporary/metadata.json" "$snapshot_name" "$file_count" "$link_count" "$total_bytes" "$manifest_sha256" \
  "$links_sha256" "$database_name" "$database_sha256" "$database_manifest_sha256" <<'NODE'
const fs = require('node:fs')
const [file, snapshotName, fileCount, linkCount, totalBytes, manifestSha256, linksSha256, databaseBackupName, databaseBackupSha256, databaseManifestSha256] = process.argv.slice(2)
const payload = {
  schemaVersion: 1,
  status: 'complete',
  createdAt: new Date().toISOString(),
  snapshotName,
  fileCount: Number(fileCount),
  linkCount: Number(linkCount),
  totalBytes: Number(totalBytes),
  manifestSha256,
  linksSha256,
  databaseBackupName: databaseBackupName || null,
  databaseBackupSha256: databaseBackupSha256 || null,
  databaseManifestSha256: databaseManifestSha256 || null,
  roots: ['testdata', 'uploads'],
}
fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
NODE

chmod -R go-rwx "$temporary"
mv -- "$temporary" "$final"
trap - EXIT INT TERM

find "$SNAPSHOT_DIR" -mindepth 1 -maxdepth 1 -type d -name 'snapshot-20??????T??????Z*' -mtime "+$KEEP_DAYS" -print0 \
  | while IFS= read -r -d '' candidate; do
      candidate_real="$(realpath "$candidate")"
      candidate_name="$(basename "$candidate_real")"
      [[ "$candidate_real" == "$resolved_snapshots"/* && "$candidate_name" =~ ^snapshot-20[0-9]{6}T[0-9]{6}Z(-[0-9]+)?$ ]] || {
        echo "Refusing to remove unexpected snapshot path: $candidate_real" >&2
        exit 2
      }
      rm -rf -- "$candidate_real"
    done

printf 'asset_snapshot=%s files=%s links=%s bytes=%s manifest_sha256=%s database_backup=%s\n' \
  "$final" "$file_count" "$link_count" "$total_bytes" "$manifest_sha256" "${database_name:-none}"
