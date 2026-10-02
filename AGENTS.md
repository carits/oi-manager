# OI Manager 仓库协作规则

## 规则优先级

- 本文件是 `/data/oi-manager` 仓库的项目级规则，优先于用户主目录中的全局基线。
- 如果更深层目录存在 `AGENTS.md` 或 `CLAUDE.md`，处理该目录内容时以更深层规则为准。
- 未被项目规则明确覆盖的事项，遵循下述全局行为基线。
- 不得为了满足较低优先级规则而绕过本文件规定的文档、架构、测试、迁移或发布门禁。

## 全局 Agent 行为基线

### 交互偏好

- **语言**：始终使用中文回复；新增或修改的代码注释、工程文档和用户可见文案同步使用中文。既有英文标识、协议字段、第三方术语及必须保持兼容的原文不做机械翻译。
- **行动优先**：用户给出明确且已授权的操作指令时，默认直接使用工具执行，而不是只列出操作步骤。
- **精炼交付**：回复聚焦执行结果、关键决策、验证证据和真实阻塞，不重复输出无关的通用背景。

### 操作与安全底线

- **先读后改**：修改已有文件前，先读取完成当前改动所需的文件、项目规则和相关上下文。大型文件按需读取相关范围，禁止盲写或整文件覆盖。
- **增量安全**：只修改当前任务明确涉及的文件和行为；保留工作树中其他用户或并行任务的已有改动，不擅自还原、格式化或顺手重构无关内容。
- **删除守卫**：不得自行推断并永久删除文件、目录或数据。只有用户在当前任务中明确指定删除目标和范围，或项目内已批准的迁移方案明确要求删除时，才能执行；执行前仍须核对精确目标和引用影响。
- **环境隔离**：Python 优先使用项目已激活或声明的 Conda、uv、venv 环境；Node.js 使用项目锁定的版本与包管理器。不得全局提权安装会污染系统环境的依赖。
- **真实记录**：不得声称未实际完成的测试、提交、推送、迁移或部署；验证失败或外部条件缺失时必须如实说明。

### 远程仓库协作

- 修改前先检查当前分支和 `git status`，确认并行任务、未提交改动和目标文件所有权。
- 不覆盖、暂存或提交当前任务范围外的改动；需要提交时只显式暂存本任务文件。
- 代码、测试和部署应遵循仓库文档记录的远程开发流程；不得把本机临时环境的结果冒充远端或生产验证。
- 涉及数据库、部署、外部服务或不可逆操作时，遵守本文件后续更严格的专项规则和对应运行手册。

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
