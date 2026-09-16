# OI Manager repository instructions

## Documentation gate

Every completed repository task must leave the documentation consistent with the resulting code,
configuration, tests, and runtime state. This includes implementation, bug fixes, tests, operations,
deployment, dependency changes, and investigations that establish new project facts.

Before declaring a task complete:

1. Add a dated entry to `docs/CHANGELOG.md` with the task outcome and verification performed.
2. Update the relevant active guide, architecture, development, operations, or reference document.
3. Update `docs/STATUS.md` when capabilities, limitations, test counts, ports, runtime state, or
   deployment state changed.
4. Refresh `last_verified` on every active document whose claims were rechecked or changed.
5. Run `pnpm docs:check` and report the result.

Do not state that a change was deployed, pushed, or fully tested unless that action actually
succeeded. A task is not complete while its durable behavior or current operational facts exist
only in chat, commit messages, terminal output, or personal notes.

The detailed workflow and record ownership are defined in `docs/development/WORKFLOW.md`.

## Architecture migration burn-down

`docs/architecture-progress.json` is the machine-readable source of truth for current migration
progress. Before architecture work, read that file and the latest commits instead of reconstructing
status from large source trees or historical STATUS entries.

The migration is complete only when all explicit exit criteria in that JSON are true:

- legacy and Feature UI/Model transport calls are both zero;
- Contest runtime compatibility points are zero;
- all five production HTTPS evidence flags are true.

Required workflow:

1. Run `pnpm architecture:progress` and inspect `topDebt`.
2. Choose a coherent domain batch with high call reduction; do not migrate isolated lines merely to
   improve the number.
3. Preserve authorization, business errors, immutable history and API semantics.
4. Move UI/Model transport into the Feature API and add or extend a shared Runtime Contract.
5. Run targeted and production-isomorphic tests, then `pnpm architecture:check`.
6. Run `pnpm architecture:progress`, commit the generated JSON, and include its compact before/after
   summary in the rollout record.

Never add direct transport to App/legacy Component/Feature UI or Model code, reduce a Contract
boundary to make a gate pass, loosen authorization, expose secrets, or treat an existing Feature
directory as proof that its migration is complete. Production HTTPS flags may only become true when
`docs/operations/production-https-evidence.json` contains verified external evidence.
