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
