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

## AI context budget and incremental review

For Codex/AI work, minimize repeated context reconstruction without sacrificing correctness.

Default workflow:

1. Read this file first.
2. Generate an incremental context pack with `pnpm ai:context -- --module <module> --base <last-reviewed-sha> --head HEAD`.
3. Read only the stable specs, changed files, tests, and verified Gap items listed by that pack.
4. Expand to adjacent modules only when a concrete dependency, schema/contract/auth change, or call chain requires it.
5. For "latest progress" reviews, compare from the last reviewed commit instead of rescanning the whole repository.
6. When a durable verified gap is added or closed, update `docs/ai-context/GAPS.md`.
7. Do not treat historical chat context as current code truth.

The detailed protocol is `docs/development/AI_CONTEXT_PROTOCOL.md`; module path/spec ownership is in
`docs/ai-context/modules.json`.

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
