#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT INT TERM

server_root="$TEST_ROOT/live-server"
backup_root="$TEST_ROOT/assets"
database_root="$TEST_ROOT/database"
audit_root="$TEST_ROOT/audit"
mkdir -p "$server_root/testdata/problem" "$server_root/uploads/public" "$database_root" "$audit_root"
printf 'old-input\n' > "$server_root/testdata/problem/1.in"
printf 'old-upload\n' > "$server_root/uploads/public/a.txt"
database_file="$database_root/oi_manager_20260829_000000.dump"
printf 'paired-database\n' > "$database_file"
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

ASSET_TESTDATA_DIR="$server_root/testdata" ASSET_UPLOADS_DIR="$server_root/uploads" \
  ASSET_BACKUP_DIR="$backup_root" ASSET_DB_BACKUP_DIR="$database_root" \
  ASSET_BACKUP_LOCK_FILE="$TEST_ROOT/initial.lock" "$ROOT_DIR/scripts/backup-assets.sh" >/dev/null
target="$(find "$backup_root/snapshots" -mindepth 1 -maxdepth 1 -type d -name 'snapshot-*' -print -quit)"

printf 'new-input\n' > "$server_root/testdata/problem/1.in"
printf 'new-upload\n' > "$server_root/uploads/public/a.txt"

restore_args=(--snapshot "$target" --database-sha256 "$database_sha" --confirm-root "$server_root" --apply)
ASSET_RESTORE_ALLOW_ISOLATED=true ASSET_RESTORE_SKIP_SERVICE_CONTROL=true \
  ASSET_RESTORE_SERVER_ROOT="$server_root" ASSET_RESTORE_TESTDATA_DIR="$server_root/testdata" \
  ASSET_RESTORE_UPLOADS_DIR="$server_root/uploads" ASSET_BACKUP_DIR="$backup_root" \
  ASSET_DB_BACKUP_DIR="$database_root" ASSET_RESTORE_AUDIT_DIR="$audit_root" \
  OI_MANAGER_ROOT="$ROOT_DIR" "$ROOT_DIR/scripts/restore-production-assets.sh" "${restore_args[@]}" >/dev/null

grep -Fqx old-input "$server_root/testdata/problem/1.in"
grep -Fqx old-upload "$server_root/uploads/public/a.txt"
test -s "$audit_root"/asset_restore_*.log

if ASSET_RESTORE_ALLOW_ISOLATED=true ASSET_RESTORE_SKIP_SERVICE_CONTROL=true \
  ASSET_RESTORE_SERVER_ROOT="$server_root" ASSET_RESTORE_TESTDATA_DIR="$server_root/testdata" \
  ASSET_RESTORE_UPLOADS_DIR="$server_root/uploads" ASSET_BACKUP_DIR="$backup_root" \
  ASSET_DB_BACKUP_DIR="$database_root" ASSET_RESTORE_AUDIT_DIR="$audit_root" \
  OI_MANAGER_ROOT="$ROOT_DIR" "$ROOT_DIR/scripts/restore-production-assets.sh" \
    --snapshot "$target" --database-sha256 "$(printf '0%.0s' {1..64})" --confirm-root "$server_root" --apply >/dev/null 2>&1; then
  echo 'Asset restore accepted a mismatched database SHA-256' >&2
  exit 1
fi

if ASSET_RESTORE_ALLOW_ISOLATED=true ASSET_RESTORE_SKIP_SERVICE_CONTROL=true \
  ASSET_RESTORE_SERVER_ROOT="$server_root" ASSET_RESTORE_TESTDATA_DIR="$server_root/testdata" \
  ASSET_RESTORE_UPLOADS_DIR="$server_root/uploads" ASSET_BACKUP_DIR="$backup_root" \
  ASSET_DB_BACKUP_DIR="$database_root" ASSET_RESTORE_AUDIT_DIR="$audit_root" \
  OI_MANAGER_ROOT="$ROOT_DIR" "$ROOT_DIR/scripts/restore-production-assets.sh" \
    --snapshot "$target" --database-sha256 "$database_sha" --confirm-root "$TEST_ROOT/wrong" --apply >/dev/null 2>&1; then
  echo 'Asset restore accepted an incorrect target confirmation' >&2
  exit 1
fi

echo 'Production asset restore verification passed: paired SHA, isolated replacement and confirmation guards'
