---
status: current
audience: development
last_verified: 2026-09-26
source_of_truth: apps/server/src/modules/training-engine, apps/server/prisma/schema.prisma, packages/contracts/src/training.ts
---

# Training Engine V2：Group × Stage 训练运行系统

## 背景与最终模型

真实课堂会同时存在多个分组，并且各组可能处在不同训练阶段。单一的 Session 当前阶段、Stage 自身运行状态或 Participant 当前阶段镜像都无法表达这一事实。

> TrainingSession 是一堂训练；Stage 只定义有序教学元数据；稳定 Group 承载学员归属；StageGroup 是 Group × Stage 的唯一配置与运行事实。

```text
TrainingSession
├─ Participant ──belongs to──> stable Group
├─ Stage[]（有序元数据：名称、说明、kind）
└─ StageGroup[]（Stage × Group）
   ├─ mode / access / submission / completion / transition rules
   ├─ PENDING / RUNNING / PAUSED / ENDED / SKIPPED
   ├─ planned / active elapsed / end reason
   └─ ProblemPlan[] ──> StageProblem ──> pinned TestSet Revision
```

普通训练只是一个 Stage 和一个 Group；模板只生成可编辑骨架，不形成另一套产品模式。Contest 与 Training Engine 已彻底分离，训练接口只使用 `/api/training-sessions/*`。

## 不变量

- Participant 必须且只能属于当前 Session 的一个有效稳定 Group。
- 一个 Session 的每个有效 Group 与每个 Stage 恰好形成一个 StageGroup。
- 同一 Group 最多有一个 `RUNNING` 或 `PAUSED` StageGroup；不同 Group 可以处于不同 Stage。
- Stage 不保存 audience、规则、生命周期或当前运行位置。
- Session 和 Participant 不保存 currentStage；当前阶段由该 Group 的活动 StageGroup 推导。
- StageGroup 是训练方式、访问、提交、时间、完成、转换与运行状态的唯一真相。
- ProblemPlan 必须通过 `stageGroupId` 指向 StageGroup，并与 StageProblem 属于同一 Stage。
- 已经运行或结束的 StageGroup 不允许通过设计矩阵改写。
- 换组只改变稳定 Group 归属并追加 GroupChange；Progress、Draft、Submission 与历史要求不删除。
- 已结束单元不回滚；需要再次训练时创建未来单元。

数据库约束和 `training:consistency` 同时检查跨 Session 引用、重复 StageGroup、同组多个活动单元、孤儿 Progress 与跨 Stage ProblemPlan。

## 设计与运行

设计 DTO 只包含：

```text
participants
groups
stages
stageGroups
```

Stage 只编辑名称、说明、用途、顺序和 canonical StageProblem。StageGroup 矩阵编辑每个 Group 在每个 Stage 的训练模式、题目计划、访问/提交/完成/转换规则及时间设置。

发布不会产生全局 currentStage。运行时由教师针对 Group 启动、推进、暂停、恢复或结束 StageGroup。Session 级暂停/恢复会保存各 Group 的本地状态：原本局部暂停的 Group 在全局恢复后仍保持暂停。

拆组会继承来源 Group 的当前与未来 StageGroup 配置；合组只允许两个 Group 当前位于同一 Stage。换组到同一 Stage 时复用已有 Progress；跨 Stage 换组不会重置目标 StageGroup 的运行 epoch。

## 题目、进度与评测

StageProblem 保存 canonical Problem 和固定 TestSet Revision。多个 StageGroup 可以通过各自 ProblemPlan 复用同一 StageProblem，规则包括顺序、解锁、目标分、分数里程碑、Subtask、单题时间、卡题与提示策略。

Progress 绑定 Participant + StageProblem，不绑定 Group，因此换组不丢成绩。当前要求由 Participant 当前 Group 的活动 StageGroup 及 ProblemPlan 计算，历史 Progress 单独保留。训练提交继续固化 TrainingSession、StageProblem 和实际 TestSet Revision。

题目添加只支持“平台 + 题号”精确解析；不提供题库浏览或题单选题。

## 并发、权限与实时事件

所有结构和运行写入使用 Session advisory lock 与 `statusRevision` CAS。客户端提交的 Stage、Group、StageGroup、Revision 均由服务端重新校验归属。并发推进、暂停、拆组、合组与矩阵保存只有一个事务成功。

JSON API 使用 `packages/contracts` Runtime Contract，Web 只通过 Training Feature API。SSE 是登记的 Raw Transport，用持久 Event 序号补偿断线；重连后客户端重新读取 Workspace 权威状态。

学生只能读取当前 Group 已开放的题目和规则。未来单元、锁题、隐藏题号及其他 Group 的内部配置不得通过 DTO 泄露。

## 创建、设计器与工作台

统一入口为“创建训练”：

- 快速创建：生成一个 Group × 一个 Stage。
- 模板创建：只生成 Stage/Group 骨架，题目必须显式添加。
- 设计器：基本信息 → Stage → 稳定分组 → StageGroup 矩阵 → 提示/发布检查。
- 工作台：按 Group 展示各自当前 Stage、时间、完成度和运行操作，不显示全局“上一阶段/当前阶段”。

报告按 StageGroup 时间线展示每组的计划/实际时间、结束原因、ProblemPlan 要求、Progress、Hint、Command、换组和事件。

## 迁移与验证

2026-09-26 最终迁移直接删除重复语义，不提供双写：

1. 将历史 StageParticipantAssignment 确定性绑定到 Participant 的稳定 Group。
2. 将 ProblemPlan 外键从误导性的 `groupId` 原位改名为 `stageGroupId`，保留记录身份。
3. 删除 Session/Participant currentStage、Stage 运行与规则字段、legacy assignment 字段和旧 stage-scoped GroupChange。
4. 对 `stageGroupId`、Stage × Group 以及每 Group 单一活动单元增加数据库约束。
5. 迁移前后引用数量保持一致；歧义数据 fail closed。

发布验收至少执行：

```bash
pnpm training:inventory
pnpm training:consistency
pnpm --filter server exec vitest run tests/training-engine.test.ts
pnpm --filter @oi-manager/contracts build
pnpm --filter server build
pnpm --filter web build
```

核心领域测试覆盖：单组矩阵、分组独立推进、跨 Stage 换组、同 Stage 换组、拆组继承、同 Stage 合组限制、终态单元不可改写、局部暂停跨全局暂停恢复。