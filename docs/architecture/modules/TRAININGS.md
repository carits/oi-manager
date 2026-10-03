---
status: current
audience: development
last_verified: 2026-10-03
source_of_truth: apps/server/src/modules/training-engine, apps/server/prisma/schema.prisma, packages/contracts/src/training.ts
---

# 训练课堂产品模型与内部引擎

> **重构说明（2026-10-03）**：当前文件描述的是仍在运行的 V2 引擎兼容结构。新训练产品与数据模型正在迁移到 `SessionProblem + Round + GroupProblemAssignment`，目标规则见 [`TRAININGS_V3_TARGET.md`](./TRAININGS_V3_TARGET.md)。新代码不得继续扩展 `StageProblem / StagePlan / Requirement / Hint` 产品能力。

## 产品模型

教师端只有一条主流程：

```text
创建训练
  -> 填写基本信息、参加学生、赛制、训练总时长和第一轮题目
  -> 创建并等待开始，或立即开始
  -> 进入课堂工作台
  -> 题目调整 / 聚焦题目 / 调整分组 / 下一步
```

教师界面不得把内部 `Stage`、`StagePlan`、`Revision`、状态机、矩阵或发布流程作为产品概念展示。后端仍使用这些结构保证并发、历史和评测一致性，Web 必须把它们翻译为自然课堂语言：

| 内部概念 | 教师可见名称 |
| --- | --- |
| 当前 RUNNING Stage | 当前安排 |
| PENDING next Stage | 准备好的下一步 |
| Stage Transition | 下一步 |
| ended Stage | 课堂记录 |
| StagePlan / Group override | 当前内容 / 分组内容 |

普通训练和复杂课堂使用同一个领域模型，不存在“普通训练 / 教练带练”两套产品。Contest 与 Training Engine 独立，训练接口只使用 `/api/training-sessions/*`。

## 创建训练

创建训练必须是一个单页，不使用向导、模板选择或“先创建 Session 再编排 Stage”的用户流程。页面固定包含：

1. 基本信息：名称、说明。
2. 参加学生：团队、自定义学生或全校学生。
3. 第一个安排：使用 `ProblemListEditor` 选择题目，并设置必做/选做。
4. 大概练多久：教师能理解的预计时长。
5. 发布摘要：参加对象、题目数量、必做要求和截止时间。

底部只提供“保存草稿”和“创建并开始”。保存草稿后进入同一课堂页面继续完善；创建并开始必须完成创建、发布和首个安排启动，不再让教师经历独立发布步骤。

系统内部为新训练生成一个默认计划和一个初始 `Stage`，但 UI 不显示这些技术参数。新训练固定使用普通训练规则；模板服务与接口可以保留供内部兼容，Web 正常页面不得请求或展示模板。

## 课堂工作台

教师端首屏的信息顺序必须稳定：

1. **现在做什么**：当前安排、题目和已用时间。
2. **学生进行得怎么样**：完成进度、需要关注的学生、分组概况。
3. **教师现在能做什么**：固定只有题目调整、聚焦题目、调整分组、下一步四个主动作。
4. **下一步**：只在教师主动决策时展开。
5. **课堂记录和其他辅助信息**：置于次级区域，不抢占课堂判断。

`TrainingSessionWorkspace` 只负责数据装配和动作编排，展示职责分别由以下领域组件承担：

- `ClassroomHeader`
- `CurrentActivity`
- `ClassroomOverview`
  - `StudentProgress`
  - `AttentionNeeded`
  - `GroupOverview`
- `ClassroomActions`
- `NextStepPanel`
- `StudentDrawer`

禁止恢复 `TrainingProblemChain`、`TrainingStageTimeline`、`TrainingStageGroupMatrix`、`TrainingDesignAuxiliary` 或任何 Stage 编辑器、拖拽时间轴、链式编排和矩阵主界面。

## 下一步决策

当前安排结束时，主操作统一叫“下一步”。决策面板先提供课堂事实：

- 已用时间。
- 当前完成率。
- 卡住或需要关注的人数。

然后允许教师选择：

- 继续当前安排。
- 调整题目后继续。
- 进入已准备的下一步。
- 准备新的下一步。
- 统一讲解。
- 复盘。
- 结束训练。

“准备下一步”只编辑一次即将发生的安排，不能展示任意未来队列、全时间轴或 Stage × Group 矩阵。历史内容只作为轻量“课堂记录”展示。

## 题目、分组与课堂规则

新训练 UI 不区分必做/选做。学生当前可见题目即当前训练内容。解锁表达式、ANY/ALL、目标分、Subtask、Hint、单题策略等内部高级规则不得进入新训练 UI。

分组是学生的稳定归属，不拥有独立课堂生命周期。只有在不同组使用不同内容时，界面才显示简单的“分组 -> 当前内容”表；不得恢复矩阵编辑器。换组不得删除草稿、提交、进度或历史记录。

题目添加只支持“平台 + 题号”精确解析，使用 `ProblemListEditor`。别名是用户业务文本，不参与题目身份解析。未发布或不可用题不得泄露题名、内部 ID 或链接。

## 内部引擎模型

```text
TrainingSession
├─ currentStageId -> 当前唯一 RUNNING Stage
├─ Participant -> stable Group
└─ Stage[]（内部有序课堂记录）
   ├─ lifecycle / timing / end policy / access / submission
   ├─ StageProblem[] -> canonical Problem
   ├─ default StagePlan
   ├─ optional Group override StagePlan[]
   └─ immutable RuntimeSnapshot
```

核心不变量：

- 一个 Session 最多一个 `RUNNING` Stage，`currentStageId` 必须指向它。
- 生命周期只允许 `PENDING -> RUNNING -> ENDED | SKIPPED`，不允许分组独立推进或回滚。
- 暂停属于 Session 时钟；暂停时当前 Stage 仍为 `RUNNING`。
- 每个 Stage 恰好有一个默认计划；分组覆盖只能引用本 Session 的稳定 Group。
- Participant 必须且只能属于一个有效稳定 Group。
- Progress 绑定 Participant + StageProblem；换组不得删除历史事实。
- 首次开始时写入不可变 RuntimeSnapshot；已开始定义不可编辑。
- 已结束内容不可恢复为 RUNNING；重复训练需要创建新的下一步。

数据库约束与 `training:consistency` 同时检查跨 Session 当前记录、多个 RUNNING 记录、默认计划、稳定分组、跨记录题目计划、待生效换组、快照哈希、动态测试槽和孤儿 Progress。

## 进度、评测与并发

StageProblem 保存 canonical Problem；每次提交创建 JudgeRun 时读取当时最新 Evolving，没有 Evolving 时回退 Stable，并固化测试槽、fencing token、graph hash 和 Judge 投影。

所有结构和运行写入使用 Session advisory lock 与 `statusRevision` CAS。服务端重新校验 Stage、Group、Plan、Problem 和测试槽；并发推进只有一个事务成功。Scheduler 使用同一锁与事务边界。

JSON API 使用 `packages/contracts` 的 Runtime Contract，Web 只通过 Training Feature API。SSE 是登记的 Raw Transport，用持久 Event 序号补偿断线，重连后重新读取 Workspace 权威状态。

学生只读取当前安排及其稳定 Group 的有效内容。待开始的下一步、锁题、隐藏题号和其他 Group 覆盖不得泄露。

## 接口边界

服务端可以保留 `/stages`、`/next-stage`、`/stage-transitions` 等内部路由，以维持稳定契约和历史数据；这些名称不得直接成为 Web 文案或导航。Web 应通过领域动作函数调用，并将其映射为“当前安排”“准备下一步”“下一步”和“课堂记录”。

模板接口保留但不由 Web 正常页面调用。矩阵替换接口只属于内部兼容，不得重新暴露为前端产品能力。

## 验证

每次训练模块改动至少验证：

- 创建页为单页，包含基本信息、参加学生、第一个安排和预计时长。
- “保存草稿”和“创建并开始”均能进入同一课堂工作台。
- 首屏顺序为当前安排、课堂概况、教师动作、下一步和课堂记录。
- 页面不存在面向用户的 Stage、阶段、Revision、矩阵、时间轴、发布检查、模板等内部文案。
- 题目选择、必做/选做、分组当前内容、课堂动作和学生抽屉可用。
- 已有训练和历史课堂记录仍能打开。
- 桌面与窄屏无内容遮挡、空白或横向页面溢出。

发布验收执行：

```bash
pnpm training:inventory
pnpm training:consistency
pnpm --filter server exec vitest run tests/training-engine.test.ts tests/training-global-stage-migration.test.ts
pnpm --filter @oi-manager/contracts build
pnpm --filter server build
pnpm --filter web build
pnpm exec playwright test e2e/tests/training-engine-flow.spec.ts
```
