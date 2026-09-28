---
status: reference
audience: development, testing, operations
last_verified: 2026-09-22
source_of_truth: codex/full-project-usability-hardening branch
---

# 全项目可用性加固审计（历史参考）

> 本文是 2026-09-22 的代码静态审计快照，保留英文原始证据以便追溯。它不代表当前发布状态，也不应作为当前功能是否完成的判断依据；当前状态以 `docs/STATUS.md`、对应模块文档和最近一次发布记录为准。

## Scope and completion state

This pass audits and hardens the repository at code/static-review level across usability, functionality, organization isolation, canonical identity, compatibility residue, file access and operational safety.

As of 2026-09-22, the **code/static hardening pass is complete for the audited surfaces**. The branch has also reconciled current `main` (merge base `6238e97fe413978d29c98ec2f92514612cf2fdc2`) so it is no longer behind the default branch.

This statement does **not** mean runtime verification has passed. Per the explicit scope of this pass, tests, builds, Prisma migrations, migration rehearsals, deployment and production probes were not executed.

## Completed code and static-review work

### Training Engine

- Retired `FROM_BEGINNING`; one global Current Stage is authoritative.
- Runtime Focus/Lock/Unlock/per-user Skip/Unlock are restricted to Current Stage.
- Explicit SKIP satisfies sequential prerequisites without rewriting historical submissions.
- Reactivated participants align to the current Stage.
- Future/locked/sequentially unavailable problems are redacted at the API boundary, including while `SCHEDULED` or `PAUSED`.
- Workspace permissions are evaluated in memory after one Participant/Override/Progress load instead of re-querying per StageProblem.
- StageProblem pins canonical Problem plus title/statement snapshots; each submission acquires current Evolving (Stable fallback).
- Draft identity is `Session + User + StageProblem`, preventing same-Problem cross-Stage collisions.
- OI Subtask selections and score goals are dependency-closed.
- Hint definitions support create/edit/delete only while the owning Stage is pending; runtime definitions freeze after start.
- TEAM commands resolve against the current Session team.
- Workspace/list dependencies surface errors instead of silently rendering partial/empty data.
- Teacher workspace exposes current runtime/group/completion/score-goal state, filters and CSV/JSON report export.
- Concrete organization route coverage was added instead of relying on two generic dynamic route patterns.
- A static audit covered 72 Server route files for declared route-param / `req.params` mismatches; the Training design-problem mismatch was fixed and no additional instance was found in that pass.

### Active organization isolation

Campus resources now use the **active organization context** as the boundary rather than “the account has some membership in that organization”.

Hardened paths include:

- Team list/detail/member role/invitations/admin invitations/member teams and direct teamId access.
- Team problem lists and Team Import batches/read/confirm flows.
- Assignment is organization-only: list/create/direct-id subroutes require an active organization workspace, and multi-organization accounts are fixed to the active organization.
- Training Engine session/list/template scope.
- Remaining Activity/Contest compatibility and Rating contest routes.
- Activity Submission detail.
- ProblemList list/detail/share/delete/team filter and Assignment creation.
- Organization solved ranking, Rating leaderboard and contest Rating management.
- Dashboard team aggregates and organization wallet context.

Multi-organization regression definitions were added for the affected flows.

### Canonical identity and ranking

- Solved rankings use `problemInternalId`; external fallback is `oj:problemId`, so equal problem codes on different OJs are not collapsed.
- Campus solved rankings use canonical `workspaceScope='campus' + organizationId`, not legacy Training ownership.
- Problem submission history first matches `problemInternalId`, then the stored TestSet slot/graph/fencing identity.
- External `oj + problemId` fallback is only allowed when the identity is unambiguous; platform originals and school copies no longer mix histories.
- Contest/Rating paths retain canonical Contest/Judge facts from current main.

### Files and operational safety

- Canonical Contest files support organization/platform contests without requiring a Team.
- Contest file list/upload/delete/metadata/download share the same Contest access and active-organization rules.
- Physical files are removed if Prisma metadata creation fails.
- Multer temporary files are removed in `finally`.
- Browser session directories/files are forced to 0700/0600.
- CORS allows the `X-OI-Organization-ID` header.
- OJ auto verification distinguishes unsupported platforms from invalid credentials; unsupported accounts remain `unverified`.
- Auto Verify ticks are serialized and scheduler shutdown waits for the in-flight verification.

### Usability and failure states

- Contest rejudge user loading errors no longer appear as “no users”.
- Problem Judge Assets reports failures for Test Graph, templates, programs, Candidate Pool, Wrong Corpus and AI usage while retaining safe partial successes.
- Chat sticker-pack loading failure is explicit.
- Training list/template/team/dashboard/peer/hint/draft failures are explicit; draft switching includes cancellation/version protection.
- Data Market and workspace switching error states were hardened by parallel commits on this branch.
- Campus student Team view is no longer confused with personal mode.
- Native alert usage in the audited Contest path was replaced with in-app feedback.

### Compatibility and maintenance cleanup

- Removed obsolete direct-database School/Student/Teacher/Admin repair, seed and migration scripts that were retired or violated current data-governance rules.
- Retained current controlled migration/audit tools only where they have explicit scope and guardrails such as dry-run, snapshots, blocking conditions, transactions or read-only behavior.
- Retired internal compatibility paths and one-off maintenance services from current main were reconciled into this branch.
- `CLAUDE.md` and organization-migration documentation no longer point to retired executable migration scripts.
- Current main Stage-driven Training finalization, internal compatibility retirement, browser-session, CORS, file-upload and OJ-verifier hardening were reconciled before closing the static pass.

## Static audit conclusions for account-level features

The following were reviewed and intentionally **not** forced into active-organization scope because their product semantics are account-level:

- Blog/Knowledge authoring: authors may explicitly choose any organization in which they hold an active membership.
- `/ratings/me` and own Rating history: account-level aggregation/history across the user's Rating accounts.
- Data Market organization licensing: explicit organization selection with capability checks.
- Evaluation Credits: account-level resource.

Contribution organization rankings/events and Carits organization wallet already use current-organization guards and required no additional boundary change.

## Regression definitions added or reconciled

Regression code now covers, among other cases:

- Training runtime invariants, visibility, drafts, statement snapshots and Hint freeze.
- Multi-organization Team, Assignment, Training/Contest, Submission, ProblemList, Rating and Team Import isolation.
- Canonical solved-ranking and Problem submission identity.
- Organization Contest file list/metadata access.
- CORS organization header and persisted browser-session permissions.
- Concrete organization routes.

These files were written/reconciled but **not executed in this pass**.

## Explicitly not executed

The following remain unverified and must not be represented as passed:

- Contracts / Server / Web typecheck.
- Server Vitest suites.
- Web unit/component tests.
- Playwright E2E, cross-role/organization flows and responsive checks.
- Production build.
- `docs:check`, `architecture:check`, architecture progress generation/verification.
- Prisma migration execution.
- Migration rehearsal against a restored database.
- Historical Training hardening backfill/reconstruction verification.
- Deployment, canary, health/readiness, worker/judge and external uptime probes.

## Migration-specific risk record

The repository contains `20260921_training_usability_hardening`; this pass does not execute it.

Before applying it:

1. Back up and restore into an isolated database.
2. Verify behavior with SCHEDULED/RUNNING/PAUSED TrainingSessions.
3. Reconcile old draft identity when the same Problem appears in multiple Stages.
4. Treat historical statement backfill as migration-time reconstruction; it cannot recreate historical versions that were never stored.
5. Reconcile Draft, Progress, Submission, Hint, Event and RuntimeSnapshot references.
6. Verify any intended rerunnable migration/helper is idempotent.
7. Run the Training lifecycle, visibility, grouping, draft-isolation and command regression suites after migration.

Additional Team Import organization-scope and current-main migration changes were incorporated into source history, but no migration from this hardening branch was executed by this pass.

## Deferred structural refactoring

These are engineering refactors, not unresolved user-facing defects in this pass:

- Split the large Training Engine service by definition/runtime/progress/grouping/reporting responsibilities.
- Split Judge orchestration into compile/execute/check/aggregate/result responsibilities.
- Continue reducing Feature-local transport only when it creates a meaningful domain/API boundary; do not manufacture empty wrapper layers to improve a metric.

Because these refactors have broad blast radius, they should be undertaken only with full test execution.

## Exit state

Static/code hardening exit conditions are satisfied:

- current `main` is reconciled into the branch;
- identified code/usability/organization-boundary defects from this pass have fixes;
- regression definitions exist for the high-risk behavior;
- stale executable compatibility paths/scripts were removed or documented;
- STATUS, CHANGELOG and this ledger identify the hardening work;
- unexecuted verification is explicitly recorded.

The branch must remain Draft / not production-ready until the runtime verification and migration rehearsal items above are completed and recorded.
