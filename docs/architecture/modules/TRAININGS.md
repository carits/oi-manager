---
status: current
audience: development
last_verified: 2026-09-23
source_of_truth: apps/server/src/modules/training-engine, apps/server/prisma/schema.prisma, packages/contracts/src/training.ts
---

# Training Engine：Stage 驱动的课堂训练系统

## 背景与产品边界

真实课堂不是一次发布一组题目后等待截止。教师会在同一堂课中依次热身、训练、讲解、重新分组和补题，并根据现场情况暂停、延时、换组、提示或提前结束。

> 训练模块不是流程图编辑器，也不是简单发题器；它是一套以 Stage 表达课堂时间轴、以 Runtime Intervention 提供现场弹性的训练运行系统。

`TrainingSession` 表示一堂课，`Stage` 是代码与数据层的领域名，产品界面统一称“阶段”，表示这堂课时间轴上的一个片段。普通刷题训练只是只有一个阶段的 Session；“快速创建 / 自定义多阶段 / 阶段模板”都只是生成阶段 Definition 的 UI 入口，不形成普通训练/教练带练两套领域模型。`OI / ACM / GENERAL` 只描述题目与评测语义。

```text
TrainingSession
└─ Stage[]（课堂时间轴）
   ├─ kind: training | teaching | review
   ├─ audience: all | grouped
   ├─ StageGroup / ParticipantAssignment
   ├─ StageProblem → pinned TestSet Revision
   ├─ ProblemPlan（组内顺序与组合式规则）
   ├─ RuntimeSnapshot（开始时不可变）
   ├─ TimeAdjustment / GroupChange
   └─ Progress / Hint / Command / Overlay / Event
```

## Definition 与 Runtime Intervention

Definition 是 Stage 开始前的教学设计：用途、受众、题目、开放方式、时间、完成条件、提示和提交规则。Stage 开始时在同一事务中生成完整配置投影和 SHA-256；运行中及历史 Stage 的定义永久冻结。

Runtime Intervention 是课堂现场干预：暂停/恢复、Focus、消息、Hint、个人解锁/跳题、临时禁交、延时和换组。它不得替换题目、修改规则或切换 Stage 类型。延时追加 `StageTimeAdjustment`，不覆盖原计划时间。

Stage 生命周期统一为：

```text
PENDING → RUNNING → ENDED
PENDING → SKIPPED
```

`ENDED` 的原因由结构化 `endReason` 表达：`TIME_REACHED / COMPLETION_REACHED / HYBRID_REACHED / TEACHER_ENDED / TEACHER_ENDED_EARLY / SESSION_ENDED / SYSTEM_ENDED`；教师填写的文字说明单独保存在 `endNote`。没有回滚，也不再把“提前结束/正常完成”编码成两种终态。已结束 Stage 需要再次训练时必须复制为新的未来 Stage。人工转换和 Scheduler 共用训练 advisory lock、`statusRevision` CAS 和同一事务语义。

## Stage 规则组合

不使用不断扩展的 `StageMode`。行为由正交规则组合：

- 教学用途：训练、讲解、复盘。
- 学员组织：全班或 Stage 内分组。
- 题目开放：全部开放、顺序开放、教师控制。
- 时间：不限时、阶段限时，以及显式的单题 `REMIND / RECOMMEND_SWITCH / LOCK_SUBMISSION / FORCE_SWITCH` 动作。旧 `SOFT / HARD / SWITCH_REQUIRED` 只由迁移/防御性读取兼容，并规范化为 canonical action；不再依赖写死的 30 分钟判断。
- 完成：AC、目标分、分数里程碑。
- 提示：手动、有效时间、次数或分数。
- 结束：手动、时间、完成度或混合。
- 提交：允许或禁止。

顺序开放支持 `ANY / ALL` 组合的 AC、SCORE、TIME、ATTEMPTS 和 TEACHER 条件。Teaching/Review 可以没有题；Training 必须至少分配一道题。

卡题识别由每题、分组或 Stage 的 `stuckPolicy` 决定，包含最短有效时间、最少提交次数和无提升时长。教练面板只将其作为可解释提醒，不自动换题或换组。

## Stage 分组与进度

基础名单只决定谁参加训练。Group 只属于一个 Stage；新的 grouped Stage 可以显式沿用映射、手工重分或展示可解释建议，系统不能自动替教师决定。

`StageProblem` 是题目与固定 Revision 的稳定身份；创建/保存 Definition 时同时固定题名和题面快照，历史训练不再跟随题库当前题面漂移。同一 Stage 的多个组通过 `ProblemPlan` 复用它。草稿也以 `Session + User + StageProblem` 为身份，因此同一道 Problem 出现在不同 Stage 时不会互相覆盖。换组不会删除提交、草稿或 Progress。当前要求来自当前 Stage/组的 Plan，历史成绩来自稳定 Progress：

- Requirement 统一为 `REQUIRED / SATISFIED / BYPASSED / RETIRED`：换组后不属于新组的旧题为 `RETIRED`，教师 Skip 为 `BYPASSED`，历史 Progress 永不删除。
- Dashboard、Scheduler Completion、Peer Progress 与 Report 必须读取同一个 Requirement resolver，不能分别从 Progress 数量推导完成度。
- 两组共有题继续使用已有 Progress。
- `immediate` 立即刷新当前要求；`next_stage` 只预写目标 Stage 分组。
- 每次换组保存原组、目标组、操作者、原因、生效方式，并通过 SSE 通知。
- 分组建议按前序完成题数、累计分数、尝试次数和有效训练时间进行稳定排序，再用蛇形分配平衡各组；接口只返回建议和逐人原因，教师确认前绝不写入 Stage 定义。

OI 部分分使用一个题目的 `scoreGoals`（例如 30 → 60 → 100），不拆成多个 Stage。提交时将当前目标层级、允许 Subtask 与投影哈希写入 Submission/JudgeRun，保证历史评测可复现。

## 结构编辑与固定版本

- DRAFT、SCHEDULED 可以编辑尚未开始的 Stage。
- RUNNING、PAUSED 只能编辑、追加、复制、重排或删除未来 `PENDING` Stage。
- 运行中和历史 Stage 不可修改或重排。
- 删除带 Hint 或预分组引用的未来 Stage 必须先返回影响摘要并明确确认。
- 题目只能通过“平台 + 题号”精确解析加入；不提供题库浏览或题单选题。
- 每个 StageProblem 固定 TestSet Revision；题库新版只提示，管理员主动更新前不改变训练。

保存通过稳定 Stage/Assignment ID 做事务型差异更新，服务器按数组重建连续顺序，并使用训练锁与 `statusRevision` 防止并发覆盖。

## 创建、运行台与报告

统一入口是“创建训练”：

- 快速创建（单阶段·全班统一）：名称、学员、题目、截止时间，生成一个全班阶段并直接发布。
- 自定义多阶段：先创建草稿；创建弹窗即可一次建立 1～30 个阶段，每个阶段独立选择“全班统一 / 分组训练”。分组阶段可以先建立“基础组 / 提高组 / …”等组骨架；具体学生归属、题目、时长和规则在设计器中继续配置，确认后统一发布。训练开始后仍可追加新的未来 `PENDING` 阶段。
- 使用阶段模板：生成阶段骨架，题目必须显式添加。内置骨架包括简单刷题、讲练结合、分层课堂、OI 部分分和 ACM 策略训练。设计器可以把当前阶段、分组和规则保存成个人、学校或团队模板；数据库模板可在创建页复用和停用，但不会复制题目、学员或运行数据。

设计器步骤为“基本信息 → Stage 与规则 → 学员与 Stage 分组 → 提示 → 发布检查”。Hint Definition 只允许在所属 Stage 为 `PENDING` 时新增、编辑或删除；Stage 开始后 Definition 冻结，运行时只能开放/关闭已有提示。运行工作台只展示冻结定义与现场干预：完成/提前结束、跳过未来 Stage、复制未来 Stage、延时、换组和当前要求/历史进度。教练完成度以该学员当前 Stage/分组真正要求的题目为分母，不能只统计已经产生的 Progress。报告按 Plan 对名单做左连接，未提交题明确返回 `NOT_STARTED`，并区分“当前要求”和换组前“本阶段历史”；教师工作台支持导出学员明细 CSV 和包含完整时间线/换组记录的 JSON。ACM 排名按解题数降序、首 AC 相对开场时间与 AC 前错误提交罚时升序计算，不再按简单完成数冒充榜单。

## API、Contract 与实时事件

JSON API 全部通过 `packages/contracts` 和 Training Feature API。核心结构化写入口：

- `GET /api/training-sessions/:id/design`
- `GET /api/training-session-templates`
- `POST /api/training-sessions/:id/templates`
- `DELETE /api/training-session-templates/:id`
- `POST /api/training-sessions/:id/structure/validate`
- `PUT /api/training-sessions/:id/structure`
- `POST /api/training-sessions/:id/stage-transitions`
- `POST /api/training-sessions/:id/stages/:stageId/end`
- `POST /api/training-sessions/:id/stages/:stageId/clone`
- `POST /api/training-sessions/:id/stages/:stageId/move-participant`
- `POST /api/training-sessions/:id/stages/:stageId/group-changes`
- `GET /api/training-sessions/:id/stages/:stageId/group-suggestions`
- `POST /api/training-sessions/:id/stages/:stageId/time-extensions`

`/events` 是登记的 Raw Transport SSE。命令和事件追加保存；SSE 支持游标补偿，断线后客户端重新读取权威 Workspace。

## 服务边界与命令调度

Runtime Command 不再通过主服务中的巨型条件链执行。`training-command.service.ts` 提供 dispatcher，`training-command.handlers.ts` 承载暂停/恢复、Focus、Overlay、个人干预、卡题解除和 Hint 等 handler；`training-engine.service.ts` 只负责权限/目标规范化、事务上下文组装、调度以及 Command/Event 落库。规则求值独立在 `domain/training-rule-engine.ts`，事件常量集中在 `training-events.ts`，监控集中在 `training-metrics.ts`。

领域事件与原始 Command 审计同时保留。生命周期和课堂干预会显式产生 `training.session.started/paused/resumed/ended`、`training.stage.started/ended/skipped`、`training.problem.unlocked/skipped/stuck/stuck_cleared`、`training.hint.opened`、`training.message.shown` 等事件，报告和审计不需要反推 Command payload。

## 权限与可靠性

权限按“管理员/个人 override → Runtime Overlay → Problem/Group/Stage EffectiveRule → Session 默认规则”解析。学生只有在权限求值确认题目可见后才获得题号、平台、题名和题面快照；未来 Stage、锁题、顺序未解锁和教师控制未开放题目在 API 边界即脱敏，即使 Session 处于 `SCHEDULED` 或 `PAUSED` 也不能绕过。Workspace 一次加载 Participant、Override 与 Progress 后批量完成全部 StageProblem 权限求值，避免按题重新加载 Session/Progress 的 N+1。`TrainingSession.currentStageId` 是唯一当前阶段真相；`SCHEDULED` 时保持 `null`，只有真正执行 `start` 后才指向第一个运行阶段。`Participant.currentStageId` 仅作为兼容镜像。硬暂停禁止编辑与提交，软暂停允许编辑但不提交；暂停时间不计入 Session 或 Stage 有效时间。ENDED/ARCHIVED 后所有 Runtime Command fail-closed。

评测完成后幂等更新 Progress 与 ScoreEvent。Scheduler 是单例 Worker，只对 RUNNING Stage 评估 TIME/COMPLETION/HYBRID；与人工转换竞争时只有一个 CAS 成功。固定 Revision、运行快照、目标分层快照和追加事件共同保证历史可重放。

## 上线前验证与可观测性

Training Engine 的代码完成不等于可发布。每次涉及 Stage/规则/迁移的发布至少执行：

```bash
pnpm training:inventory
pnpm training:consistency
pnpm training:benchmark
```

- `training:inventory` 记录 Session、阶段、阶段分组、Assignment、StageProblem、Progress、Event、Template 以及 Legacy Training 的数量，并输出 PostgreSQL relation size，作为迁移前后对账基线。
- `training:consistency` 必须为 0 error；至少检查 RUNNING Session 无 currentStage、同 Session 多 RUNNING 阶段、终态 Session 仍有 RUNNING 阶段、GROUPED 阶段未分组学员、跨阶段 Group Assignment、孤儿 Progress。
- `training:benchmark` 默认包含 50 名学生 × 100 道题的规则/权限基准，并可通过真实 Session 环境变量测 Workspace 与 Dashboard p95。
- `TRAINING_STAGE_ENGINE_ROLLOUT=read_only` 可在发布观察期禁止新建/修改 Definition，但不会中断已经存在的 Runtime Session。
- 监控至少暴露 `training_session_active_count`、`training_stage_transition_total`、`training_command_total`、`training_command_failure_total`、`training_sse_connections`、`training_permission_latency`、`training_workspace_query_count`、`training_group_move_total`。

迁移测试必须在独立 PostgreSQL schema 中实际执行 migration SQL；不得仅通过字符串扫描代替。上线与演练禁止使用 `prisma migrate reset`、`prisma db push --force-reset` 或任何等价的破坏性重建路径。

## 一次性迁移

当前开发阶段直接迁移，不双写旧模型。2026-09-21 的 usability hardening migration 已写入仓库，但按本轮审计约束**尚未实际执行或演练**；以下仍是待执行迁移规则：

1. 有 SCHEDULED/RUNNING/PAUSED Session 时拒绝迁移。
2. 无旧 Group 的 Stage 迁为 `audienceMode=ALL`；旧 Session Group 为每个 Stage 克隆独立 StageGroup。
3. Participant 的旧 groupId 转为逐 Stage Assignment。
4. StageProblem 为全班或每组创建 ProblemPlan。
5. 旧 FREE/SEQUENTIAL/FOCUS/TEACHING/REVIEW 映射为组合规则。
6. 历史 SCORE_PROGRESSIVE 保持 Stage 数量，转为单目标 scoreGoal，避免改写课堂时间线。
7. 对账 Revision、Progress、Submission、Hint 和 Event 引用后删除旧 Group、participant groupId、productMode 和 StageMode 写路径。

迁移不会重测历史提交，也不会伪造回滚事件。

## 2026-09-21 usability hardening 补充约束

- Session 只维护一条全局 Current Stage 时间线；迟到加入只支持 `CURRENT_STAGE` 或 `TEACHER_ASSIGN`，不再支持每个学员从第一 Stage 独立推进。
- Runtime Focus、Lock/Unlock、个人 Skip/Unlock 只能作用于 Current Stage；跨 Stage 请求由服务端拒绝。
- TEAM 级 Runtime Command 的目标由当前 Session 的 `teamId` 规范化，前端不要求用户再次选择同一个团队 ID。
- OI Subtask 选择在前后端都补齐依赖闭包，避免只选择依赖方而漏掉 prerequisite。
- 已新增针对上述语义的 Server/E2E 回归用例定义；**本轮未实际执行这些测试**。
- 历史数据迁移仍需单独演练：旧 `problemId` 草稿映射到重复出现的 StageProblem 时存在语义歧义；历史题面快照回填只能代表 migration-time reconstruction，不能追溯迁移前已丢失的旧题面版本。

## 运行时入口与迁移边界

当前运行时只使用 Stage 驱动的训练接口。新的写入入口为：

- /api/training-sessions
- /api/training-session-templates

旧的 /api/trainings 接口已经停用，集合路径和所有嵌套路径统一返回 HTTP 410，并返回错误码 TRAINING_LEGACY_API_RETIRED；不会再猜测跳转到新地址。

旧训练模型仅由一次性迁移服务读取，用于生成 TrainingSession、Stage、Assignment、ProblemPlan 和历史引用。迁移不重新评测、不伪造提交、不双写旧接口。迁移完成前保留旧模型及其迁移引用，以便审计与对账；运行时读写不再依赖旧路由。

## Training Engine V2（Stage 驱动统一模型）

TrainingSession 表示一堂课，Stage 是不可回滚的时间轴；普通训练只是一个 Stage，模板只生成可编辑骨架，不形成第二套产品模式。新版本使用稳定的 TrainingSessionGroup，并以 TrainingSessionStageGroup 表示 Stage × Group 的独立运行单元。学员通过 TrainingSessionParticipant.groupId 绑定当前稳定分组；每个单元独立记录状态、有效时长、结束原因和题目计划。Stage 开始时冻结定义，运行中的定义不可修改；需要重复训练时复制为新的未来 Stage。

Stage 的教学用途、分组范围、开放策略、完成规则、提示规则和时间规则分别表达，不能继续扩展单一 StageMode 枚举。换组只改变当前或未来 Stage 的分组分配，不删除 Progress、提交或历史要求；运行期命令不能替换题目或改变训练规则。旧 groupingModelVersion=1 训练保持兼容读取，新建训练使用 V2 矩阵。

