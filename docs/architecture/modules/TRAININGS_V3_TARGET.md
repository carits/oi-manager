# Training V3 目标模型

> 状态：target-state
>
> 基线：main@ef442202
>
> 实施分支：refactor/training-session-problem-model
>
> 本文是新训练模型的产品与领域约束。V2 引擎字段可以为历史数据兼容保留，但不得继续向新 UI 暴露。

## 1. 重构背景

当前 Training Engine 以 `StageProblem` 为题目身份，并让 Stage 同时承担题目身份、分组计划、完成要求、Hint、时间策略和提交上下文。结果是同一道题跨轮次会产生多个训练题目身份，Submission / Progress / Draft / 排名 / 聚焦 / 权限都被 `stageProblemId` 绑定。

新模型的核心原则：

> 一场训练中的同一道 canonical Problem 永远只有一个训练题目身份；Round 只决定当前某个分组能看到哪些题。

## 2. 教师产品模型

教师课堂主界面固定只保留四个主动作：

1. **题目调整**
2. **聚焦题目**
3. **调整分组**
4. **下一步**

以下不再作为一级课堂动作：

- 统一讲解；
- 发送提示；
- 结束训练；
- 消息；
- 禁止/恢复提交；
- Soft/Hard Pause；
- 延长当前阶段；
- Teaching / Review / Guided Stage。

暂停/继续、增加总时间属于 Session 状态控制，不占四个课堂动作。

## 3. 新训练生命周期

新训练不再创建 DRAFT。

目标状态：

```text
READY
  -> RUNNING
  <-> PAUSED
  -> ENDED
  -> ARCHIVED
```

`scheduledStartAt` 是 READY 的可选自动开始时间，不需要再把 SCHEDULED 作为独立产品概念。

旧 DRAFT / SCHEDULED 数据继续只读兼容或迁移兼容。

## 4. 时间模型

### 4.1 Session 总时间

每场训练必须设置：

```text
totalDurationSeconds
```

教师和学生看到总倒计时或明确结束时间。

规则：

- RUNNING 时递减；
- PAUSED 时停止；
- 恢复后继续；
- 教师可“增加时间”；
- 总时间归零后 Session 自动 ENDED；
- 不再使用“预计用时”；
- 不再用 Assignment 风格的 7 天 dueAt 表达训练寿命。

### 4.2 Round 可选测试倒计时

普通 Round：

```text
timeLimitSeconds = null
```

限时测试 Round：

```text
timeLimitSeconds = N
```

规则：

- 无额外提醒；
- PAUSED 时与 Session 一起暂停；
- 归零后当前 Round 结束；
- 不自动进入下一 Round；
- 不因为 Round 时间归零而结束整个 Session；
- 等待教师点击“下一步”；
- 增加 Session 总时间默认不改变 Round 测试时间；
- 只有 Round 存在测试倒计时时才允许单独调整本轮时间。

V3 不继续扩展 MANUAL / TIME / COMPLETION / HYBRID 策略引擎。

## 5. 三种赛制

继续支持：

- GENERAL
- OI
- ACM

三种赛制共享完全相同的课堂流程和题目/分组模型，只在统计与排名计算层存在差异。

不得重新产生 GENERAL/OI/ACM 三套 Stage、Workspace 或课堂动作。

## 6. 核心数据模型

```text
TrainingSession
├─ SessionProblem[]
├─ Participant[]
├─ Group[]
├─ Round[]
│  └─ GroupProblemAssignment[]
└─ RuntimeOverlay[]
   └─ Focus
```

### 6.1 TrainingSessionProblem

建议模型：

```text
TrainingSessionProblem
- id
- sessionId
- problemId
- alias?
- titleSnapshot
- statementsSnapshot
- createdAt
- updatedAt
```

约束：

```text
unique(sessionId, problemId)
```

职责：

- 一场训练中题目的唯一身份；
- 承接 Submission；
- 承接学生代码；
- 承接 Progress；
- 承接成绩统计；
- 保存训练题面快照。

### 6.2 Round

Round 是“下一轮训练”的内部实体。

只负责：

- 顺序；
- lifecycle；
- startedAt / endedAt；
- 可选 `timeLimitSeconds`。

Round 不负责：

- 题目身份；
- 必做/选做；
- Hint；
- Teaching / Review / Guided；
- 单题策略；
- CompletionPolicy；
- ScoreGoal。

数据库可以暂时继续使用 `TrainingSessionStage` 表名，但新 Application Layer 应按 Round 语义使用。

### 6.3 GroupProblemAssignment

Round 与题目的关系仅表示：

> 当前这一轮，这个分组可以看到哪些 SessionProblem。

建议：

```text
TrainingRoundProblemAssignment
- id
- roundId
- groupId
- sessionProblemId
- orderIndex
- active
```

V3 第一版只支持 GROUP 级题目调整，不支持 USER 级单独题集。

没有“必做 / 选做”字段。

## 7. 题目调整

教师选择一个分组后，可以：

- 添加题目；
- 移除题目。

“移除”只移除当前有效 Assignment，不删除历史事实。

例如学生已对 P1001 有 Submission：

1. 教师从当前分组移除 P1001；
2. 学生立即看不到 P1001；
3. P1001 不再参与当前成绩/通过数/罚时/总分；
4. Submission、代码、历史成绩仍保留；
5. 以后重新加入 P1001；
6. 原 Submission 立即重新参与统计，无需重新提交。

这是系统级不变量：

> Submission 是历史事实；当前排名与成绩由“当前有效题集 + 历史 Submission”实时计算。

## 8. 跨 Round 同题语义

同一 Session 中 P1001 无论：

- 在 Round 1 出现；
- 被删除；
- Round 2 再出现；
- 分组变化后重新可见；

都必须指向同一个 `TrainingSessionProblem(P1001)`。

因此：

- Submission 历史连续；
- 已有成绩连续；
- 代码连续；
- 删除后重加立即恢复统计。

不得再创建 Round1-P1001 / Round2-P1001 两份题目身份。

## 9. 下一轮

只允许提前准备一个下一轮。

当前：

```text
RUNNING Round
+ at most one PENDING Round
```

下一轮保存的是一个**完整题集快照**，不是增量 patch。

例如：

```text
Round 1: A B C
Round 2: D E
```

进入 Round 2 后学生看到 D E，不是 A B C D E。

PENDING Round 内容绝不能泄露给学生。

## 10. 分组与换组

学生始终属于一个当前有效 Group。

换组立即重新计算当前有效题集：

```text
effectiveProblems = currentRound.assignments[currentGroup]
```

如果学生正在查看一题，而换组后该题不再有效：

- 保存代码；
- 保留 Submission；
- 关闭该题；
- 自动进入新有效题集中的可用题目。

历史事实不因换组删除。

## 11. 聚焦题目

聚焦是 RuntimeOverlay，不创建 Round。

建议第一版聚焦只允许选择目标分组当前有效题目，避免聚焦成为绕过题目可见权限的第二套分配系统。

聚焦结束后回到学生原有效题集。

`currentProblemId / returnProblemId` 后续必须改为 SessionProblem 语义。

## 12. 学生端

学生不需要看到：

- Round 历史；
- Stage；
- 当前任务/历史任务分类；
- 下一轮；
- 教师规划。

学生只看到教师当前让其分组可见的题目。

当题目调整、换组或进入下一轮发生时，学生题目列表实时变成新的有效题集。

## 13. 教师学生身份显示

教师端所有学生列表、关注区、分组和详情必须优先显示组织真实姓名：

```text
displayName
```

username 只作为次要信息或 fallback。

## 14. 排名与动态题集

### 14.1 动态删除

题目被移出当前有效题集后：

- GENERAL：该题不计当前完成/成绩；
- OI：该题分数不计总分；
- ACM：该题 AC、错误提交、罚时都不计。

重新加入时，历史 Submission 立即重新计入。

### 14.2 不同组不同题

这是仍需最终产品确认的一个显示问题。

推荐：

- 各组有效题集完全相同：允许全体榜；
- 各组有效题集不同：默认按组查看排名，不做加权比较。

无论 UI 是否显示全体榜，后端计算必须基于每个 participant 的当前有效题集。

## 15. 有效题集必须成为唯一领域函数

V3 必须集中实现类似：

```ts
resolveEffectiveSessionProblems(sessionId, participantId)
```

所有模块统一消费它：

- 学生题目列表；
- canView / canSubmit；
- 排名；
- 完成情况；
- 当前题目合法性；
- 聚焦合法性；
- 换组；
- Round 切换。

禁止 Workspace、Permission、Ranking 各自实现一套题集解析规则。

## 16. Submission 与评测快照

Submission 从：

```text
trainingStageProblemId
```

迁移为：

```text
trainingSessionProblemId
roundId?  // 仅作为提交发生时的上下文
```

Submission 的评测事实继续保留：

- testSetSlot
- testSetFencingToken
- testSetGraphHash
- judgeConfigHash
- judgeConfigSnapshot

题目删除/重加不得修改历史 JudgeRun 或历史测试数据快照。

## 17. Hint / Requirement / 旧高级策略

新训练暂不提供 Hint。

不新增：

- Hint UI；
- OPEN_HINT / CLOSE_HINT 产品入口；
- hint trigger。

新训练也不提供：

- required / optional；
- requiredProblemCount；
- completionThreshold；
- UnlockPolicy；
- ScoreGoal；
- 单题时间策略；
- StrategyDecision。

旧接口/字段可暂时保留以兼容历史数据，但必须标记 legacy/deprecated，不得被新 UI 重新接回。

## 18. 暂不实现

本轮明确不做：

- 课堂记录 UI；
- Hint；
- 学生历史 Round UI；
- 复杂自动编排；
- USER 级独立题集；
- 多个未来 Round 队列。

## 19. 新 UI 验收

教师主动作始终只有：

```text
题目调整 | 聚焦题目 | 调整分组 | 下一步
```

创建训练只让教师理解：

- 名称；
- 学生；
- 赛制；
- 总时间；
- 第一轮题目/分组题目。

不得再出现：

- 保存草稿；
- Stage；
- Teaching / Review / Guided；
- 预计阶段时长；
- 必做 / 选做；
- Hint；
- Requirement；
- Revision；
- StagePlan；
- 时间轴/矩阵。

