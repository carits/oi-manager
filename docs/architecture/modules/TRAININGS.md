---
status: current
audience: development
last_verified: 2026-09-19
source_of_truth: apps/server/src/modules/training-engine, apps/server/prisma/schema.prisma, packages/contracts/src/training.ts
---

# Training Engine：Stage 驱动的课堂训练系统

## 背景与产品边界

真实课堂不是一次发布一组题目后等待截止。教师会在同一堂课中依次热身、训练、讲解、重新分组和补题，并根据现场情况暂停、延时、换组、提示或提前结束。

> 训练模块不是流程图编辑器，也不是简单发题器；它是一套以 Stage 表达课堂时间轴、以 Runtime Intervention 提供现场弹性的训练运行系统。

`TrainingSession` 表示一堂课，`Stage` 表示这堂课时间轴上的一个片段。普通刷题训练只是只有一个 Stage 的 Session；“快速创建”和模板只是生成 Stage 的 UI 快捷方式，不形成普通训练/教练带练两套领域模型。`OI / ACM / GENERAL` 只描述题目与评测语义。

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

Stage 生命周期为：

```text
PENDING → RUNNING → COMPLETED | ENDED_EARLY
PENDING → SKIPPED
```

没有回滚。已结束 Stage 需要再次训练时必须复制为新的未来 Stage。人工转换和 Scheduler 共用训练 advisory lock、`statusRevision` CAS 和同一事务语义。

## Stage 规则组合

不使用不断扩展的 `StageMode`。行为由正交规则组合：

- 教学用途：训练、讲解、复盘。
- 学员组织：全班或 Stage 内分组。
- 题目开放：全部开放、顺序开放、教师控制。
- 时间：不限时、Stage 限时，以及显式的单题 `NONE / SOFT / HARD / SWITCH_REQUIRED` 策略。单题策略达到阈值后分别只提示、禁止继续提交或要求先切题；不再依赖写死的 30 分钟判断。
- 完成：AC、目标分、分数里程碑。
- 提示：手动、有效时间、次数或分数。
- 结束：手动、时间、完成度或混合。
- 提交：允许或禁止。

顺序开放支持 `ANY / ALL` 组合的 AC、SCORE、TIME、ATTEMPTS 和 TEACHER 条件。Teaching/Review 可以没有题；Training 必须至少分配一道题。

卡题识别由每题、分组或 Stage 的 `stuckPolicy` 决定，包含最短有效时间、最少提交次数和无提升时长。教练面板只将其作为可解释提醒，不自动换题或换组。

## Stage 分组与进度

基础名单只决定谁参加训练。Group 只属于一个 Stage；新的 grouped Stage 可以显式沿用映射、手工重分或展示可解释建议，系统不能自动替教师决定。

`StageProblem` 是题目与固定 Revision 的稳定身份；同一 Stage 的多个组通过 `ProblemPlan` 复用它。因此换组不会删除提交、草稿或 Progress。当前要求来自当前 Stage/组的 Plan，历史成绩来自稳定 Progress：

- 换组后不属于新组的题进入“本阶段历史”，不计当前组完成度。
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

- 快速创建：名称、学员、题目、截止时间，生成一个全班自由训练 Stage。
- 使用模板：生成 Stage 骨架，题目必须显式添加。内置骨架包括简单刷题、讲练结合、分层课堂、OI 部分分和 ACM 策略训练。设计器可以把当前 Stage、分组和规则保存成个人、学校或团队模板；数据库模板可在创建页复用和停用，但不会复制题目、学员或运行数据。

设计器步骤为“基本信息 → Stage 与规则 → 学员与 Stage 分组 → 提示 → 发布检查”。运行工作台只展示冻结定义与现场干预：完成/提前结束、跳过未来 Stage、复制未来 Stage、延时、换组和当前要求/历史进度。教练完成度以该学员当前 Stage/分组真正要求的题目为分母，不能只统计已经产生的 Progress。报告按 Plan 对名单做左连接，未提交题明确返回 `NOT_STARTED`，并区分“当前要求”和换组前“本阶段历史”。ACM 排名按解题数降序、首 AC 相对开场时间与 AC 前错误提交罚时升序计算，不再按简单完成数冒充榜单。

## API、Contract 与实时事件

JSON API 全部通过 `packages/contracts` 和 Training Feature API。核心结构化写入口：

- `GET /api/training-sessions/:id/design`
- `GET /api/training-session-templates`
- `POST /api/training-sessions/:id/templates`
- `DELETE /api/training-session-templates/:id`
- `POST /api/training-sessions/:id/structure/validate`
- `PUT /api/training-sessions/:id/structure`
- `POST /api/training-sessions/:id/stage-transitions`
- `POST /api/training-sessions/:id/stages/:stageId/group-changes`
- `GET /api/training-sessions/:id/stages/:stageId/group-suggestions`
- `POST /api/training-sessions/:id/stages/:stageId/time-extensions`

`/events` 是登记的 Raw Transport SSE。命令和事件追加保存；SSE 支持游标补偿，断线后客户端重新读取权威 Workspace。

## 权限与可靠性

权限按“管理员/个人 override → Overlay → 当前 Stage/组 Plan → Session 默认规则”解析。硬暂停禁止编辑与提交，软暂停允许编辑但不提交；暂停时间不计入 Session 或 Stage 有效时间。

评测完成后幂等更新 Progress 与 ScoreEvent。Scheduler 是单例 Worker，只对 RUNNING Stage 评估 TIME/COMPLETION/HYBRID；与人工转换竞争时只有一个 CAS 成功。固定 Revision、运行快照、目标分层快照和追加事件共同保证历史可重放。

## 一次性迁移

当前开发阶段直接迁移，不双写旧模型：

1. 有 SCHEDULED/RUNNING/PAUSED Session 时拒绝迁移。
2. 无旧 Group 的 Stage 迁为 `audienceMode=ALL`；旧 Session Group 为每个 Stage 克隆独立 StageGroup。
3. Participant 的旧 groupId 转为逐 Stage Assignment。
4. StageProblem 为全班或每组创建 ProblemPlan。
5. 旧 FREE/SEQUENTIAL/FOCUS/TEACHING/REVIEW 映射为组合规则。
6. 历史 SCORE_PROGRESSIVE 保持 Stage 数量，转为单目标 scoreGoal，避免改写课堂时间线。
7. 对账 Revision、Progress、Submission、Hint 和 Event 引用后删除旧 Group、participant groupId、productMode 和 StageMode 写路径。

迁移不会重测历史提交，也不会伪造回滚事件。
