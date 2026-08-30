#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT INT TERM

mkdir -p "$TEST_ROOT/source/testdata/problem-a" "$TEST_ROOT/source/uploads/public" "$TEST_ROOT/db" "$TEST_ROOT/assets"
printf '1 2\n' > "$TEST_ROOT/source/testdata/problem-a/1.in"
printf '3\n' > "$TEST_ROOT/source/testdata/problem-a/1.out"
printf 'attachment-v1\n' > "$TEST_ROOT/source/uploads/public/a.txt"
ln -s ../uploads/public "$TEST_ROOT/source/testdata/upload-link"
database_file="$TEST_ROOT/db/oi_manager_20260829_000000.dump"
printf 'database-backup\n' > "$database_file"
database_sha="$(sha256sum "$database_file" | cut -d' ' -f1)"
database_size="$(stat -c '%s' "$database_file")"
node - "${database_file}.manifest.json" "$(basename "$database_file")" "$database_sha" "$database_size" <<'NODE'
const fs = require('node:fs')
const [file, backupName, backupSha256, backupSize] = process.argv.slice(2)
fs.writeFileSync(file, `${JSON.stringify({
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  backupName,
  backupSha256,
  backupSize: Number(backupSize),
  counts: { tables: 0, migrations: 0, users: 0, problems: 0, submissions: 0, files: 0, testSetRevisions: 0 },
}, null, 2)}\n`, { mode: 0o600 })
NODE

run_backup() {
  ASSET_TESTDATA_DIR="$TEST_ROOT/source/testdata" \
  ASSET_UPLOADS_DIR="$TEST_ROOT/source/uploads" \
  ASSET_BACKUP_DIR="$TEST_ROOT/assets" \
  ASSET_DB_BACKUP_DIR="$TEST_ROOT/db" \
  ASSET_BACKUP_LOCK_FILE="$TEST_ROOT/backup.lock" \
    "$ROOT_DIR/scripts/backup-assets.sh" >/dev/null
}

run_verify() {
  ASSET_BACKUP_DIR="$TEST_ROOT/assets" \
  ASSET_DB_BACKUP_DIR="$TEST_ROOT/db" \
  ASSET_RESTORE_STATE_FILE="$TEST_ROOT/assets/asset-restore-verification.json" \
  ASSET_RESTORE_LOCK_FILE="$TEST_ROOT/restore.lock" \
    "$ROOT_DIR/scripts/verify-assets-restore.sh" >/dev/null
}

run_backup
first="$(find "$TEST_ROOT/assets/snapshots" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tail -n 1)"
run_verify
grep -Fq '"status": "healthy"' "$TEST_ROOT/assets/asset-restore-verification.json"

sleep 1
printf 'attachment-v2\n' > "$TEST_ROOT/source/uploads/public/a.txt"
run_backup
second="$(find "$TEST_ROOT/assets/snapshots" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tail -n 1)"
[ "$first" != "$second" ]
grep -Fqx 'attachment-v1' "$TEST_ROOT/assets/snapshots/$first/uploads/public/a.txt"
grep -Fqx 'attachment-v2' "$TEST_ROOT/assets/snapshots/$second/uploads/public/a.txt"
[[ "$(readlink "$TEST_ROOT/assets/snapshots/$second/testdata/upload-link")" == ../uploads/public ]]
[[ "$(stat -c '%i' "$TEST_ROOT/assets/snapshots/$first/testdata/problem-a/1.in")" == \
    "$(stat -c '%i' "$TEST_ROOT/assets/snapshots/$second/testdata/problem-a/1.in")" ]]
run_verify

printf 'corrupted\n' > "$TEST_ROOT/assets/snapshots/$second/uploads/public/a.txt"
if run_verify; then
  echo 'Corrupted asset snapshot incorrectly passed restore verification' >&2
  exit 1
fi
grep -Fq '"status": "failed"' "$TEST_ROOT/assets/asset-restore-verification.json"
[ "$(stat -c '%a' "$TEST_ROOT/assets/asset-restore-verification.json")" = 600 ]

echo 'Asset backup verification passed: immutable snapshots, full restore and corruption failure state'
