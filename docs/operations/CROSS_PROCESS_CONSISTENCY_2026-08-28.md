---
status: reference
audience: development, operations
last_verified: 2026-08-28
source_of_truth: e2e/stress/blue-green-finalization.spec.ts, e2e/stress/infrastructure-faults.spec.ts
---

# Cross-process Judge, Hack and Revision verification

> Historical verification snapshot. Revision promotion and `latestTestSetRevisionId` assertions were retired by
> the 2026-09-28 Stable/Evolving slot migration; current cross-process tests must assert slot fencing and barriers.

This verification closes the remaining cross-process write-consistency item.
Every destructive write ran in the dedicated `e2e` schema, isolated ports,
isolated testdata storage and owned temporary go-judge/PostgreSQL containers.
Production records and the public schema were not modified.

## Blue/green duplicate finalization

Command:

```bash
pnpm test:stress:blue-green
```

The isolated stack started two API processes behind the stable router, one
background Worker protected by the PostgreSQL singleton lock and one real
go-judge. The test sent the same completed Submission results and the same
accepted Hack result to both API processes.

Verified invariants:

- 100 duplicate Submission result pairs produced 100 terminal submissions.
- A stale result could not overwrite a terminal Accepted result.
- One Hack result delivered concurrently to blue and green produced exactly
  one Hack Testcase and exactly one next TestSet Revision.
- Replaying the Hack result produced no additional Revision.
- The promoted Revision became `Problem.latestTestSetRevisionId`.
- Router switch, rollback, pinned WebSocket drain code 1012, Judge reconnect and
  Worker singleton replacement remained healthy.

Result on 2026-08-28: `1 passed (34.0s)`.

## PostgreSQL and sandbox interruption

Command:

```bash
pnpm test:stress:faults
```

The fault proxy reset one sandbox request and interrupted the dedicated
PostgreSQL connection while result persistence was in progress.

Verified invariants:

- Sandbox transport interruption was retried without losing or mis-scoring the
  Submission.
- PostgreSQL interruption during Submission persistence was retried to one
  terminal Accepted result.
- PostgreSQL interruption during Hack finalization emitted the documented
  persistence retry event, then promoted exactly one Testcase and one Revision
  after recovery.
- No `.pending` Hack file remained after promotion.
- API readiness returned 200 after both fault injections.

Result on 2026-08-28 after correcting the test process's isolated Judge token:
`1 passed (22.4s)`.

## Scope boundary

These tests prove application-level behavior under real separate processes and
transport faults. They do not replace the separately tracked production
database overwrite exercise, cloud-console audit, external alert delivery,
off-host log retention or TLS work, each of which still requires explicit
external authority or configuration.
