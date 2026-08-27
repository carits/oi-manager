---
status: current
audience: operations
last_verified: 2026-08-28
source_of_truth: scripts/restore-production-database.sh
---

# Production database disaster restore

This runbook replaces the exact production database only after an archive has
passed checksum, archive-list and disposable candidate-database validation.
It is intentionally separate from the routine backup restore verification.

## Safety contract

- Run from `/data/oi-manager-response-refactor` as root.
- The archive must resolve below `/data/backups/oi-manager/`.
- The target is fixed to container `oi-postgres` and database `oi_manager`.
- Supply the expected SHA-256 and repeat the exact database name.
- The script stops API writes and Judge consumers before replacement.
- It creates and checksums an immutable pre-restore dump before dropping the
  target database.
- A database failure triggers automatic rollback from that dump. If rollback
  fails, application writes remain stopped for manual recovery.
- Never run this procedure merely to prove the tooling. Use
  `pnpm disaster:restore:verify` for an isolated destructive test.

## Preflight

1. Record the incident/maintenance window and the explicitly authorized backup.
2. Verify current runtime state:

   ```bash
   cd /data/oi-manager-response-refactor
   pnpm runtime:audit
   pnpm monitor:once
   ```

3. Verify the archive independently:

   ```bash
   sha256sum /data/backups/oi-manager/<archive>.dump
   docker exec -i oi-postgres pg_restore -l \
     </data/backups/oi-manager/<archive>.dump >/dev/null
   ```

4. Run the isolated verifier if this script version has not already passed:

   ```bash
   pnpm disaster:restore:verify
   ```

## Authorized execution

Only after the owner names the archive and explicitly authorizes overwriting
the production database:

```bash
sudo pnpm disaster:restore -- \
  --backup /data/backups/oi-manager/<archive>.dump \
  --sha256 <64-lowercase-hex> \
  --confirm-database oi_manager \
  --apply
```

The audit directory `/data/backups/oi-manager/disaster-recovery/` contains the
restore log, pre-restore dump and checksum. Preserve these files with the
incident record.

## Post-restore verification

```bash
pnpm runtime:audit
pnpm monitor:once
curl --fail http://127.0.0.1:3002/api/readiness
curl --fail http://127.0.0.1:3000/api/health
```

Then run the documented read-only public smoke checks. Do not initiate bulk
rejudge, Hack promotion or other writes unless they are part of the separately
authorized recovery scope.
