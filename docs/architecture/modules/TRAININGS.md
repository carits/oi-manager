---
status: current
audience: development
last_verified: 2026-10-03
source_of_truth: apps/server/src/modules/training-engine, apps/server/prisma/schema.prisma, packages/contracts/src/training.ts
---

# Training Engine V2：渐进式 Stage 时间轴与稳定分组

## 背景与最终模型

真实课堂需要一个所有学员共同推进的教学时间轴，同时允许稳定分组在同一阶段使用不同题目计划。此前把 `StageGroup` 同时当作“分组配置”和“独立运行单元”，会造成各组处于不同阶段、暂停与结束语义分裂、教师难以判断全班当前课堂位置。

> TrainingSession 是一堂训练；Stage 是全班唯一时间轴；稳定 Group 只表达学员归属；StagePlan 表达默认计划与可选分组覆盖，不拥有独立生命周期。

```text
TrainingSession
├─ currentStageId ──> 当前唯一 RUNNING Stage
├─ Participant ──belongs to──> stable Group
└─ Stage[]（有序全局时间轴）
   ├─ lifecycle / timing / end policy / access / submission
   ├─ StageProblem[] ──> canonical Problem；提交时动态读取 Evolving
   ├─ default StagePlan（全班默认，必有且唯一）
   ├─ optional Group override StagePlan[]
   │  └─ ProblemPlan[]（顺序、必做、解锁、分数、时间、提示）
   └─ immutable RuntimeSnapshot（首次开始时生成）
```

普通训练只是一个 Stage。快速创建与模板只生成同一领域模型的初始结构，不形成“普通训练 / 教练带练”第二套模式。Contest 与 Training Engine 独立，训练接口只使用 `/api/training-sessions/*`。

## 不变量

- 一个 Session 最多一个 `RUNNING` Stage；`currentStageId` 必须指向本 Session 的该 Stage。
- Stage 生命周期只允许 `PENDING → RUNNING → ENDED | SKIPPED`，不存在分组独立推进或回滚。
- 暂停属于 Session 时钟；暂停期间 RUNNING Stage 的 `runningSince` 为空，生命周期仍为 RUNNING。
- 每个 Stage 必须恰好有一个默认计划：`isDefault=true`、`groupId=null`、`inheritsDefault=false`。
- 分组覆盖计划必须引用本 Session 的稳定 Group；没有覆盖时回退到默认计划。
- Participant 必须且只能属于当前 Session 的一个有效稳定 Group。
- StageProblem 只保存 canonical Problem；ProblemPlan 保存面向计划的训练规则和 `required`。每次训练提交在创建 JudgeRun 时动态取得该题当时最新 Evolving；题目没有 Evolving 时回退 Stable。
- Progress 绑定 Participant + StageProblem，不绑定 Group；换组不得删除 Draft、Submission 或历史 Progress。
- Stage 首次开始时写入不可变 RuntimeSnapshot；已开始 Stage 的定义和计划不可编辑。
- 已结束 Stage 不恢复为 RUNNING；需要重复训练时复制为新的未来 Stage。

数据库约束与 `training:consistency` 同时检查：跨 Session 当前阶段、多个 RUNNING Stage、默认计划形状和数量、稳定分组归属、跨 Stage ProblemPlan、待生效换组、快照定义哈希、动态槽选择及孤儿 Progress。

## 设计与运行

设计 DTO 包含：

```text
participants
groups
stages
stagePlans
```

Stage 编辑全局课堂行为：用途、顺序、题目、开放方式、提交方式、结束条件和计划时长。StagePlan 编辑全班默认题目要求及可选的稳定 Group 覆盖。覆盖可以继承默认计划，也可以显式改变题目集合、必做项、访问和提交策略。

发布后按一个全局时间轴运行。教师通过统一 Stage Transition 开始、推进、提前结束、跳过未来阶段或结束整场；Scheduler 使用相同的锁与 CAS 事务。暂停、恢复、Focus、消息、Hint、个人解锁、临时禁交和延时属于 Runtime Intervention，不改写 Stage 定义。

拆组与合组只改变稳定 Group 及参与者归属，不创建第二条 Stage 时间线。即时换组立刻改变当前计划；普通换组和拆组都可选择在下一阶段开始事务中生效。共有题继续复用 Progress，退出新组当前计划的题只进入“本阶段历史”。每条已应用换组记录保存实际生效 Stage，报告不得用当前分组反推历史。

## 题目、进度与评测

StageProblem 不固定测试数据版本。默认计划和分组覆盖通过各自 ProblemPlan 复用 StageProblem，规则包括顺序、必做/选做、解锁、目标分、分数里程碑、Subtask、单题时间、卡题与提示策略。

OI 部分分使用同一道题的 `scoreGoals`（例如 30 → 60 → 100），不为每个目标制造独立 Stage。每次提交取得当时 Evolving（缺失时 Stable）的 Reader，并固化 `testSetSlot + fencingToken + graphHash` 和 Judge 投影；提交终态后释放 Reader。

题目添加只支持“平台 + 题号”精确解析；不提供题库浏览或题单选题。

## 并发、权限与实时事件

所有结构和运行写入使用 Session advisory lock 与 `statusRevision` CAS。服务端重新校验 Stage、Group、Plan、Problem 和当前 TestSet 槽可用性；并发推进只有一个事务成功。

JSON API 使用 `packages/contracts` Runtime Contract，Web 只通过 Training Feature API。SSE 是登记的 Raw Transport，用持久 Event 序号补偿断线；重连后重新读取 Workspace 权威状态。

学生只读取全局当前 Stage 以及其稳定 Group 的有效计划。未来 Stage、锁题、隐藏题号和其他 Group 的覆盖配置不得泄露。

## 创建、设计器与工作台

统一入口为“创建训练”：

- 创建页：教师手动选择题目并生成一个全班默认计划和一个 Stage，题目可逐题标记必做/选做；新训练统一使用普通训练规则。
- 顺序开放默认只展示“完成前题 / 达到目标分 / 教师开放”，ANY/ALL 等组合条件收进高级设置。
- 需要多阶段、分组或提示时，教师从创建页转入课堂编排器继续手工配置；Web 不展示训练模板。
- 设计器：基本信息 → Stage 与规则 → 学员和稳定分组 → 默认计划/分组覆盖 → 提示与发布检查。
- 工作台：展示全局当前 Stage、学员当前实际 Plan、计划/实际时间、分组摘要、换组和 Runtime Intervention。
- 报告：按全局 Stage 时间线展示计划、实际时间、结束原因、快照哈希、各组人数与完成情况、Progress、Hint、Command 和带生效 Stage 的换组记录。

用户界面不得出现“启动某个组的阶段”“组 A 在阶段 1、组 B 在阶段 2”或“上一阶段回滚”等旧语义。

## 渐进式阶段规划

- 新建或待开始训练最多保留一个 PENDING 初始 Stage；运行中最多一个 RUNNING 当前 Stage 和一个 PENDING 下一 Stage。
- 普通教师界面只编辑第一个阶段或唯一下一阶段，不提供任意未来阶段、拖拽全时间轴、阶段复制、多阶段批量加题或 Stage × Group 矩阵主入口。
- 阶段用途固定为自主练习、引导练习、统一讲解和复盘。练习/引导至少一道题；讲解/复盘允许零题且默认禁止提交。
- 下一阶段可以沿用当前题目、从本次训练已有题目选择或按题号添加。同一道题可跨阶段复用，同一阶段内不得重复。
- 阶段结束后工作台统一询问“接下来做什么”：继续当前阶段、使用/修改/丢弃已准备阶段、准备新阶段或结束训练。
- 学生投影只包含历史和当前 Stage，不返回 PENDING Stage 或 nextStage。历史多个 PENDING Stage 作为旧版队列保留，按原顺序自然收敛，期间禁止扩展。
- 新能力复用现有 PENDING 生命周期、statusRevision CAS、advisory lock 与 RuntimeSnapshot；不修改 Prisma Schema，不删除历史数据。

## 迁移与验证

2026-09-27 迁移直接退出分组运行模型，不提供双写：

1. 迁移前若存在 RUNNING/PAUSED Session 或已启动的旧分组运行单元则 fail closed。
2. 将每个 Stage 第一份旧计划的课堂规则迁到 Stage。
3. 将第一份旧计划转为唯一默认计划，其余保留为显式分组覆盖。
4. 确保 canonical StageProblem 全部进入默认计划，并将题目策略收口到 ProblemPlan。
5. 新增全局 `currentStageId`、Stage 生命周期字段、RuntimeSnapshot 和待生效换组字段。
6. 删除分组运行字段与 `TrainingSessionStageParticipantAssignment`。
7. 迁移前后 StageProblem、ProblemPlan、Progress、Submission 与 Hint 引用必须对账。

发布验收至少执行：

```bash
pnpm training:inventory
pnpm training:consistency
pnpm --filter server exec vitest run tests/training-engine.test.ts tests/training-global-stage-migration.test.ts
pnpm --filter @oi-manager/contracts build
pnpm --filter server build
pnpm --filter web build
```

核心领域测试覆盖：全局唯一 Stage、默认计划与分组覆盖、不可变快照、即时/下一阶段换组、Progress 保留、拆组/合组不产生新时间线、暂停计时、终态冻结和迁移 fail-closed。
