# OI Manager repository instructions

## Documentation and completion gate

Every task must leave code, tests, active documentation, and reported runtime facts mutually
consistent. That consistency rule is universal; the amount of ceremony is risk-based.

### Tier 1: local implementation

Use this tier for localized UI or CSS work, small bug fixes, internal refactors, test-only changes,
and other work that does not change a public contract, authorization rule, schema, deployment
procedure, or recorded runtime state.

- Run targeted tests and checks for the changed surface.
- Update an active document only when the change would otherwise make one of its claims false.
- A CHANGELOG entry, STATUS update, last_verified refresh, and full pnpm docs:check are not required
  merely because a repository file changed.

### Tier 2: behavior or contract

Use this tier for public API or runtime contract changes, user-visible behavior, authorization or
privacy rules, and operational command behavior.

- Update the document that owns the changed behavior and add a dated docs/CHANGELOG.md entry.
- Refresh last_verified only on documents actually changed or rechecked.
- Run module tests, type checks, builds, and targeted browser or API checks appropriate to the
  behavior.
- Run the full documentation gate when route, model, API inventory, architecture evidence, or
  another docs:check-owned fact changed.

### Tier 3: architecture, data, or release

Use this tier for architecture boundaries, Prisma schema or data migration, security boundaries,
deployment and rollback procedures, production state, and cross-system changes.

- Update the owning architecture, development, or operations documents and docs/CHANGELOG.md.
- Update docs/STATUS.md only when current capability, limitation, topology, verification, or rollout
  state changed.
- Refresh last_verified on every active document whose claims were changed or explicitly rechecked.
- Run pnpm docs:check, the relevant architecture and migration checks, broad tests or E2E according
  to blast radius, and deployment evidence when a deployment occurred.

Do not create documentation churn solely to satisfy a checklist. An investigation that establishes
no durable project fact needs no record; one that changes a durable fact must update its owner
regardless of tier. Never claim a push, deployment, migration, or test that did not succeed, and
never leave durable behavior or operational facts only in chat, commit messages, terminal output,
or personal notes.

The detailed workflow and record ownership are defined in docs/development/WORKFLOW.md.

## User-facing presentation boundary

User-facing UI is a product boundary, not a direct rendering of domain or API state. The repository
principle is: **business facts in, implementation facts out**.

### Forbidden direct presentation

User-visible presentation must not directly expose database or API field names, raw enum values,
internal UUIDs or relation IDs, contract names, raw backend errors, stack traces, request payloads,
or raw JSON diagnostics. The same rule covers JSX, toast and dialog copy, tables, tooltips, empty and
error states, accessibility labels, CSV/JSON exports, downloadable reports, filenames, emails, and
notifications.

Implementation terms such as `revision`, `statusRevision`, `sourceRevision`, `snapshot`,
`canonicalProblemId`, `stageProblemId`, test-data slots, `graphHash`, `fencingToken`, and
Stable/Evolving storage terminology may remain in domain and data code, but must not cross into
normal user presentation.

### Enum and error rules

Never use a raw fallback such as `LABELS[value] || value`, `LABELS[value] ?? value`, or
`find(...)?.label || value`. Unknown values must map to a safe product fallback such as
`状态待确认`, `其他类型`, or `其他平台`, or be omitted when not useful.

Business UI consumes only a user-safe error message. It must never display raw `error.message`,
server messages, contract names, validation internals, or ORM errors. Unknown errors fail closed to a
generic user message; raw details belong to logs, telemetry, or an explicitly marked administrator
diagnostic disclosure that is hidden by default.

Describe what happened, its consequence, and what the user can do. Do not explain concurrency,
storage, or consistency mechanisms. For example, an expected-revision mismatch becomes “其他人已更新
这部分内容，请重新加载后继续”, and an unchanged snapshot becomes “原有配置不会受影响”.

### Role levels and adapters

- Students and ordinary teachers receive pure business language.
- Problem authors and contest managers may see genuine authoring concepts such as Checker, Subtask,
  input validators, and standard programs, but not hashes, fencing tokens, revisions, canonical IDs,
  or database slots.
- Platform engineers may see technical identifiers only inside an explicit, collapsed advanced
  diagnostics surface.

Normal React business components should consume presentation models or dedicated presentation
helpers, not invent labels from domain objects. Presentation mappers must never return an unknown
input value unchanged. Add a regression case using a future value such as
`FUTURE_INTERNAL_VALUE` whenever an enum presentation mapper is added or changed.

### Completion and baseline rules

Any Tier 2 or Tier 3 task that changes user-visible behavior must inspect every touched presentation
sink: JSX, toast, dialog, table, tooltip, empty state, error state, CSV/JSON export, notification,
accessibility label, and download filename. It must run `pnpm ui:language-check` (normally through
`pnpm ui:state-check`), relevant unit tests, and targeted browser coverage.

New presentation-language violations must never be added to a baseline. Presentation baselines may
only shrink. Do not add an ignore, exception, or alternate wording merely to make a gate pass unless
the value is an approved product concept with a documented reason.

## Architecture migration burn-down

docs/architecture-progress.json is the machine-readable source of truth for current migration
progress. Read it and the latest commits before architecture work instead of reconstructing status
from source-tree size or historical STATUS entries.

Interpret its exit criteria literally:

- Contract/Feature migration requires legacy transport calls to be zero and every intentional raw
  transport to be registered. Feature-local transport is observational and is not a zero target.
- Contest runtime compatibility and Judge compatibility remain incomplete until their explicit
  machine counters reach zero through verified business migrations.
- Remote archive, PITR, external alerting, cloud monitoring, and production HTTPS are complete only
  when every evidence-backed criterion recorded in the JSON is satisfied.

Required architecture workflow:

1. Run pnpm architecture:progress and inspect the generated facts and explicit exit criteria.
2. Choose a coherent boundary violation or compatibility invariant with real product or maintenance
   value. Do not choose work merely because it lowers a transport call count.
3. Preserve authorization, privacy, business errors, immutable history, and API semantics.
4. Add a Feature API or Runtime Contract when it creates real ownership, validation, reuse, or data
   projection. Do not add pass-through wrappers solely to reduce Feature-local transport metrics.
5. Run tests appropriate to the risk, then pnpm architecture:check for architecture work.
6. Regenerate architecture progress only when a measured fact changed, commit the generated JSON,
   and record a compact before/after summary in the appropriate rollout record.

Never add direct transport to App or legacy Route/Component code, bypass an established Feature
boundary, reduce a Contract boundary to make a gate pass, loosen authorization, expose secrets, or
treat an existing Feature directory as proof of completion. Existing Contest and Judge compatibility
points are real unfinished transitions and must not be deleted without migration and verification
evidence. Production evidence flags may become true only when their referenced evidence files contain
verified external proof.
