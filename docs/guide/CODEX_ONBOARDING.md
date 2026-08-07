---
status: current
audience: development, operations, codex
last_verified: 2026-08-07
source_of_truth: repository scripts, current remote runtime, AGENTS.md, active docs
---

# Codex Onboarding Guide

This guide is for a new Codex session taking over OI Manager work. It records the SSH target, active server working tree, runtime shape, test flow, deployment flow, push flow, and project-specific traps so the next agent can start safely without chat history.

## Non-negotiables

- Work on the remote server, not in a local Windows project copy.
- Active server: 47.99.222.76.
- Usual SSH alias: alias.
- Direct SSH target if the alias is unavailable: ecs-user@47.99.222.76.
- Active working tree: /data/oi-manager-response-refactor.
- GitHub repository: carits/oi-manager.
- Active branch: main.
- Public http://47.99.222.76/ is a development-server optimized preview, not production business mode.
- Do not say pushed, deployed, tested, or verified unless the command actually succeeded.
- Every repository task must keep docs consistent and run the docs gate required by AGENTS.md.

## Connect And Inspect

Use the configured SSH alias when available:

    ssh alias
    cd /data/oi-manager-response-refactor

Fallback connection form:

    ssh ecs-user@47.99.222.76
    cd /data/oi-manager-response-refactor

Start every handoff by checking state:

    git status --short --branch
    git show -s --format='%h %D %ci %s' HEAD
    curl -fsS http://127.0.0.1:3000/api/health
    curl -fsS http://127.0.0.1:3002/api/health

If the worktree is dirty, assume the changes may belong to the user or a previous Codex session. Do not reset, checkout, delete, or overwrite changes you do not understand.

## Read These First

1. AGENTS.md: repository completion rules and documentation gate.
2. docs/README.md: formal documentation entry point.
3. docs/operations/REMOTE_ENVIRONMENT_MAP.md: how the current server separates dev, preview, and production templates.
4. docs/operations/RUNBOOK.md: ports, logs, restart, database, and backup operations.
5. The active guide, architecture, development, operations, or reference document for the task area.

Do not use docs/archive/ as current truth. If documents conflict, prefer current source code, Prisma schema, scripts, live process state, and docs marked status: current.

## Current Runtime Shape

| Service | Port | Process shape | Notes |
|---------|------|---------------|-------|
| Public Web | 80 -> 3000 | Nginx to local preview | Public entry point |
| Web preview | 3000 | pnpm --filter web preview:start | Optimized Next build |
| Web HMR | 127.0.0.1:3001 | next dev | Local-only development UI |
| Server API | 3002 | tsx watch src/index.ts | Development API process |
| PostgreSQL | 5432 | Docker oi-postgres | Development database |
| go-judge | 5050 | Docker oi-judge | Judge sandbox |

Useful runtime checks:

    ps -ef | grep -E 'pnpm|tsx|next|oi-manager|3000|3001|3002' | grep -v grep
    ss -ltnp | grep -E ':(80|3000|3001|3002|3200|5050|5432)\b'
    tail -n 120 /tmp/oi-dev.log
    tail -n 120 /tmp/oi-web-preview.log

## Standard Work Loop

1. Confirm remote worktree status.
2. Read relevant code and active docs. Use grep and find; rg may not be installed on the server.
3. Make the smallest change that solves the request.
4. Run focused builds or tests.
5. If the change must be visible on public preview, restart the API and/or promote the web preview.
6. Update docs and changelog.
7. Run pnpm docs:check.
8. Run git diff --check.
9. Commit and push origin main.
10. Confirm clean status and health endpoints.

Unless the user explicitly asks for analysis only, carry implementation through verification and push.

## Test Flow

Pick the narrowest test set that covers the risk, then broaden when shared contracts, auth, judge, Prisma, or UI routing changed.

Documentation-only changes:

    pnpm docs:check
    git diff --check

Server or Prisma changes:

    pnpm --filter server prisma:generate
    pnpm --filter server build
    pnpm --filter server test

Web component or page changes:

    pnpm --filter web build
    pnpm --filter web test

Judge changes:

    pnpm --filter @oi-manager/judge build
    pnpm --filter @oi-manager/judge test

Full repository confidence check:

    pnpm build
    pnpm test
    pnpm docs:check

UI smoke and route checks when interaction, layout, auth, or navigation changed:

    pnpm test:ui:smoke
    pnpm test:ui:ux

Live remote UI checks, only when the current running server should be tested instead of isolated E2E:

    pnpm test:ui:live

Manual browser checks are still required when the user specifically asks to control Chrome or verify the visible behavior. If browser control is unavailable, report that honestly and provide the builds, health checks, and missing coverage.

## Common Commands

Dependencies and Prisma client:

    pnpm install --frozen-lockfile
    pnpm --filter server prisma:generate

Builds:

    pnpm --filter server build
    pnpm --filter web build
    pnpm --filter @oi-manager/judge build
    pnpm build

Development services:

    pnpm restart
    pnpm stop

Public preview deployment to 3000:

    pnpm preview:build
    pnpm preview:promote
    curl -fsS http://127.0.0.1:3000/api/health

Database migrations:

    cd apps/server
    pnpm prisma migrate deploy

Commit and push:

    git status --short
    git diff --check
    git add <files>
    git commit -m "type: concise summary"
    git push origin main

## Deployment Words Mean Specific Things

When the user says to push or deploy, distinguish these operations:

- GitHub push: git push origin main.
- Public web preview update: pnpm preview:build && pnpm preview:promote.
- API/Judge runtime update: usually pnpm restart after backend, Prisma, dependency, or judge changes.

A successful build is not a deployment. Only say public 3000 is updated after preview promote and health checks pass.

## Documentation Gate

AGENTS.md requires each completed repository task to leave durable docs consistent with code and runtime state. Usually this means:

- Add a dated entry in docs/CHANGELOG.md with the outcome and verification.
- Update the relevant active guide, architecture, development, operations, or reference document.
- Update docs/STATUS.md when capabilities, limitations, ports, runtime state, deployment state, or verification snapshots changed.
- Refresh last_verified for every active doc you changed or rechecked.
- Run pnpm docs:check and report it.

For this guide itself, keep docs/README.md linked to it and keep the changelog entry current.

## Safety Rules

- Never print JWTs, cookies, OJ cookies, database passwords, Judge tokens, encryption keys, or full secret env files.
- Do not copy real .env files from old directories into the active tree without explicit risk review.
- Do not run git reset --hard, git checkout -- ., docker-compose down -v, or broad rm -rf commands.
- Before deleting files, verify the path is inside the intended repository or explicitly requested target directory.
- Put security and privacy enforcement in backend APIs first; frontend display logic is not enough.

## Code Map

| Area | Path | Purpose |
|------|------|---------|
| Web | apps/web/src | Next.js App Router, React components, frontend API client |
| Server | apps/server/src | Express routes, middleware, business modules |
| Prisma | apps/server/prisma | schema, migrations, seed data |
| Judge | apps/judge/src | Judge client and go-judge integration |
| Shared | packages/shared | shared types and constants |
| E2E | e2e | Playwright tests and fixtures |
| Docs | docs | single formal documentation tree |

## Recent High-Risk Areas

- Sidebar drawer and workspace switching: layout components under apps/web/src/components/layout.
- Modal focus and form input behavior: apps/web/src/components/ui/Modal.tsx.
- Personal-mode profile privacy: profile APIs and /profile/user/:id; personal mode must not expose real name, school, phone, or email.
- Judge metrics: keep CPU time, wall time, and peak memory sources consistent. UI convention uses MS and MB.
- Testdata management: apps/server/src/routes/testdata.ts and apps/web/src/components/problem/JudgeSettingsTab.tsx; current behavior includes staging, conflict confirmation, ZIP import, single/all downloads, and SHA-256.

## Browser Verification

Useful browser checks:

- Login lands on the expected role workspace.
- Console has no obvious errors.
- Modal inputs do not lose focus or reset.
- Sidebar expansion preserves or compresses content as designed.
- Personal mode does not show campus private fields.
- Submit, rejudge, testdata upload, and download flows are actually usable.

## Common Traps

- NODE_ENV=production on 3000 only means optimized Next preview; it is not production business mode.
- /data/oi-manager contains old real env files but is not the active runtime tree.
- Web preview and Web HMR are different processes. Restarting dev does not update public 3000.
- Prisma schema or dependency changes usually need generate/build/restart, not just watch reload.
- PowerShell -> SSH -> bash quoting can corrupt commands. Be especially careful with Chinese text; check for question-mark mojibake before committing.
- File APIs for testdata, attachments, and PDFs must check permission before touching disk.

## Final Response Checklist

Keep the final response short but concrete:

- What changed.
- What verification ran.
- Whether public 3000 was deployed.
- Whether GitHub was pushed, including commit hash.
- Any verification not performed.

Avoid vague wording such as "should be fine" or "probably deployed". In this project, state follows command results.
