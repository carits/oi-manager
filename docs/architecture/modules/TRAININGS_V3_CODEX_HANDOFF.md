# Training V3 Codex 接手清单

> 分支：`refactor/training-session-problem-model`
>
> 基线：`main@ef442202`

## 已完成

当前分支已经先锁住以下产品方向：

1. 教师 `ClassroomActions` 已收成四个：
   - 题目调整
   - 聚焦题目
   - 调整分组
   - 下一步
2. `TrainingSessionWorkspace` 已接入新的四动作组件。
3. `TrainingSessionDesigner` 新建下一轮时：
   - 不再提供 PRACTICE / GUIDED / TEACHING / REVIEW 选择；
   - 新轮固定 TRAINING/PRACTICE；
   - 不再显示预计阶段时长；
   - 不再显示必做/选做；
   - 仍保留旧 Pending Stage 加载兼容。
4. 当前 V2 架构文档已指向 V3 target 文档。

## Codex 第一优先级：不要先继续改 UI

先完成 SessionProblem 数据模型迁移，否则“题目调整删除”“跨轮次提交连续”“动态排名”都无法正确实现。

## P0-1 Prisma 新模型

新增或迁移：

```text
TrainingSessionProblem
TrainingRoundProblemAssignment
```

建议先保留旧表，不要直接 DROP：

- TrainingSessionStageProblem
- TrainingSessionStageGroup
- TrainingSessionStageProblemPlan

采用双读/回填/切读方式，最后再清理。

## P0-2 stageProblemId -> sessionProblemId

必须扫描并迁移至少：

- Submission.trainingStageProblemId
- TrainingSessionProblemProgress.stageProblemId
- TrainingSessionProblemDraft.stageProblemId
- TrainingSessionScoreEvent.stageProblemId
- TrainingSessionOverlay.stageProblemId
- TrainingSessionUserOverride.stageProblemId
- TrainingSessionStrategyDecision.stageProblemId
- TrainingSessionParticipant.currentProblemId
- TrainingSessionParticipant.returnProblemId
- Contracts 中所有 stageProblemId
- Workspace DTO
- SSE/Event payload
- E2E fixtures

Submission 建议增加：

```text
trainingSessionProblemId
trainingRoundId?
```

roundId 只记录提交发生时上下文，不作为题目身份。

## P0-3 统一有效题集解析

实现单一领域函数：

```ts
resolveEffectiveSessionProblems(sessionId, participantId)
```

任何排名、权限、Workspace、当前题目、聚焦、换组逻辑不得自己重算。

## P0-4 题目调整真正支持删除

当前 `appendTrainingRuntimeProblem` 只能添加。

V3 需要 GROUP 级完整题集更新或 add/remove API。

删除题目：

- 只删除/停用 GroupProblemAssignment；
- 不删除 SessionProblem；
- 不删除 Submission；
- 不删除 Draft/代码；
- 当前成绩立即排除；
- 重新加入立即恢复历史成绩。

移除已有提交题目时可以提示确认，但不能阻止。

## P0-5 排名重写

当前 `getTrainingPeerProgress` 仍基于 Requirement + stageProblemId。

必须改成：

```text
participant
-> effective SessionProblem ids
-> filter historical submissions/progress
-> calculate GENERAL/OI/ACM
```

ACM 删除题目后，该题 AC / WA / penalty 全部不参与；重加后立即重新参与。
OI 同理按当前有效题集最高分求和。

## P0-6 时间模型

TrainingSession 增加真正的：

```text
totalDurationSeconds
activeElapsedSeconds
runningSince
```

总时间归零自动结束 Session。

删除新流程对 `settings.dueAt` 的依赖。

Round 可选：

```text
timeLimitSeconds?
activeElapsedSeconds
runningSince
```

Round 归零：

- 结束当前 Round；
- 不自动 advance；
- 不自动结束 Session；
- 等教师点击“下一步”。

PAUSED 同时暂停 Session 和 Round。

增加 Session 时间不改变 Round 时间。

## P0-7 新建训练移除 DRAFT 产品语义

目标：

```text
READY -> RUNNING <-> PAUSED -> ENDED -> ARCHIVED
```

scheduledStartAt 只是 READY 的可选自动开始时间。

旧 DRAFT/SCHEDULED 仅兼容。

完成这个状态迁移后再改 `TrainingSetupDialog`，不要在后端仍创建 DRAFT 时仅把按钮改名。

## P0-8 TrainingSetupDialog

在状态与时间模型就绪后改：

- 删除“保存草稿”；
- 删除截止时间；
- 删除预计用时；
- 删除必做/选做；
- 新增赛制 GENERAL/OI/ACM；
- 新增训练总时长；
- 创建 READY 或创建并开始。

## P1-1 下一轮题集

PENDING Round 只能有一个。

下一轮是完整快照，不是增量 patch。

进入下一轮后，学生有效题集完全切换到新 Round 当前分组的 assignments。

## P1-2 换组

换组后立即重算有效题集。

如果 currentSessionProblem 不再有效：

- 保存草稿；
- 清空或切换 current；
- 自动选择新有效题；
- Submission 不变。

## P1-3 聚焦

聚焦改绑 sessionProblemId。

建议第一版只允许聚焦目标分组当前有效题。

结束聚焦恢复 returnSessionProblemId；若 return 已失效，则选择当前有效题集中的可用题。

## P1-4 教师真实姓名

CoachDashboard / roster / StudentDrawer / filters 补充组织学生 displayName、班级上下文。

排序和搜索默认基于真实姓名，username 为辅助。

## P1-5 删除新 UI 的 Hint/Requirement/策略残留

数据库兼容可以保留，但 Web 新流程不再展示：

- Hint editor/open/close
- required/optional
- completion policy
- single problem time strategy
- strategy decision
- teaching/review/guided purpose

## P1-6 Workspace 拆分

完成领域迁移后再拆：

```text
TrainingSessionWorkspace
├─ TeacherTrainingWorkspace
└─ StudentTrainingWorkspace
```

不要在 stageProblemId 迁移进行中同时大规模搬文件，降低冲突。

## 测试必须覆盖

1. 同一题 Round1 -> 删除 -> Round2 重加，Submission/代码/最高分不丢。
2. ACM 题目删除后 AC/WA/罚时立即不计，重加立即恢复。
3. OI 题目删除后总分立即扣除，重加立即恢复。
4. 换组后有效题集、排名立即变化。
5. 下一轮是替换，不叠加上一轮题集。
6. PENDING Round 学生不可见。
7. 总时间归零自动 END。
8. PAUSED 时总时间和 Round timer 都不走。
9. Round timer 归零只结束 Round，不自动进入下一轮。
10. 聚焦结束后恢复有效题目。
11. 教师端使用真实姓名。
12. 新训练 UI 不出现 Stage/Revision/必做/选做/Hint/Teaching/Review/Guided/预计阶段时长。

## 不要做

- 不要把旧 StagePlan Matrix 搬回来。
- 不要为 GENERAL/OI/ACM 做三套 UI。
- 不要新增 USER 级独立题集。
- 不要新增多个未来 Round。
- 不要把 Submission 随题目删除。
- 不要在没有迁移数据语义前物理删除旧 StageProblem 表。
