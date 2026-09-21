---
status: current
audience: development, testing, operations
last_verified: 2026-09-22
source_of_truth: codex/full-project-usability-hardening branch
---

# Full-project usability hardening audit

## Scope

This record separates code/static-review completion from runtime verification. The hardening pass intentionally does **not** execute tests, Prisma migrations, migration rehearsal, deployment, or production probes.

## Completed code and static-review work

- Training design-problem route parameter mismatch fixed and regression coverage added.
- Training Workspace permission evaluation changed from per-problem database reloads to one Participant/Override/Progress load plus in-memory evaluation for all StageProblems.
- Future Stage and locked-problem metadata remains redacted before permission approval, including SCHEDULED and PAUSED sessions.
- TEAM runtime commands use the current TrainingSession.teamId instead of requiring an unreachable UI target id.
- Training process report supports student-detail CSV and full JSON export.
- Training hint definitions remain editable only while their owning Stage is pending; runtime uses open/close interventions after start.
- StageProblem statement/title snapshots and StageProblem-scoped drafts are retained as the history boundary.
- OI subtask selection dependency closure and runtime-stage restrictions added during this hardening branch.
- Makeup-homework failure feedback uses the in-app toast system instead of native alert.
- Static route-parameter audit covered 72 Server route files; after the Training fix, no additional declared-route-param / req.params mismatch was found by this audit.
- Removed 17 obsolete executable scripts that were deprecated, relied on retired School/Teacher/Student/Admin models, performed one-off seed/fix work, or directly mutated business data outside current governance.
- Retained current controlled migration/audit tooling where it has an explicit current-model purpose and guardrails such as dry-run, snapshots, blocking conditions, transactions, or read-only behavior.
- CLAUDE.md and the organization migration documentation no longer point to retired migrate-organization scripts.

## Explicitly not executed in this pass

The following are **not verified** and must not be represented as passed:

- Contracts / Server / Web typecheck.
- Server Vitest suites, including the newly added Training regressions.
- Web unit/component tests.
- Playwright E2E, cross-role/organization flows, responsive UI checks.
- Production build.
- docs:check, architecture:check, architecture progress generation/verification.
- Prisma migration execution.
- Migration rehearsal against a restored database.
- Historical Training hardening backfill/reconstruction validation.
- Deployment, canary, health/readiness, worker/judge probes, external uptime probes.

## Migration-specific risk record

The repository contains `20260921_training_usability_hardening`, but this pass does not execute it.

Before applying it, verify at minimum:

1. Back up and restore into an isolated database.
2. Confirm the migration refuses or safely handles active SCHEDULED/RUNNING/PAUSED TrainingSession states as designed.
3. Reconcile StageProblem identity when the same Problem appears in multiple Stages.
4. Treat historical statement snapshot backfill as migration-time reconstruction only; it cannot recreate statement versions that were never historically stored.
5. Reconcile drafts, Progress, Submission, Hint, Event and RuntimeSnapshot references.
6. Run idempotence / rerun checks where the migration or companion tooling is intended to be rerunnable.
7. Run the Training lifecycle, visibility, grouping, draft-isolation and TEAM command regression suites after migration.

## Deferred structural refactoring

These are deliberately not classified as unfinished user-facing bugs in this pass:

- Large `training-engine.service.ts` should eventually be split by definition/runtime/progress/grouping/reporting responsibilities.
- Large Judge orchestration should eventually be decomposed into compile/execute/check/aggregate/result services.
- Feature-local transport usage is an observational architecture metric, not a target to reduce through empty wrapper layers.

Those refactors should be performed only with full test execution because their blast radius is substantially larger than the static hardening changes above.

## Exit condition for this branch

Code/static-review work can be considered complete when:
- no remaining stale references to removed executable scripts are present in active docs/package scripts,
- STATUS and CHANGELOG record the hardening pass,
- this audit record remains explicit about unexecuted verification.

The branch must **not** be called production-ready until the runtime verification and migration rehearsal items above have been completed and recorded.
