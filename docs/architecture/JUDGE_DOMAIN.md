---
status: current
audience: development
last_verified: 2026-08-28
source_of_truth: Prisma JudgeRun/JudgeAttempt models and judge domain services
---

# Judge 领域模型与迁移契约

## 聚合边界

`Submission` 表达不可变用户行为；`JudgeRun` 表达一次逻辑判定；`JudgeAttempt` 表达一次物理执行；`RejudgeBatch` 聚合一次范围重测请求。

一个 Run 固定 `testSetRevisionId` 与 `judgeConfigHash`。一个 Attempt 只属于一个 Run，拥有唯一 `fencingToken`。`Submission.currentJudgeRunId` 和 `JudgeRun.currentAttemptId` 是读取指针，不改变历史记录。

## 状态机

JudgeRun：

```text
QUEUED -> RUNNING -> FINALIZED
   |          |
   +----------+-> CANCELLED
```

JudgeAttempt：

```text
QUEUED -> CLAIMED -> COMPILING -> RUNNING -> FINALIZING
   |         |           |          |            |
   +---------+-----------+----------+------------+-> CANCELLED
             +-----------+----------+------------+-> INFRA_ERROR
                         +----------+------------+-> USER_ERROR
                                                +-> SUCCEEDED
```

`SUCCEEDED/USER_ERROR/INFRA_ERROR/CANCELLED` 都是不可重开的终态。基础设施重试创建下一 `attemptNumber`，重测创建下一 `runNumber`。

## 渐进迁移

1. **Expand**：新增表、枚举、索引和兼容回填，不删除旧字段。
2. **Dual write**：新本地提交原子创建 Submission/Run/Attempt；旧执行字段继续投影。
3. **Switch write**：领取、回传、恢复与重测只变更 Run/Attempt，并事务更新旧投影。
4. **Switch read**：详情、排名和统计优先读取 current Run，缺失时回退 legacy Submission。
5. **Backfill audit**：所有可本地评测提交恰有 current Run/Attempt，归档记录没有本地生命周期。
6. **Cleanup**：稳定一个发布周期后删除 Submission 的 result、Judge owner、得分与测试点等旧执行态字段。

任何阶段都必须保持旧 API 响应兼容、活动计分和排行榜不变，并通过普通 Judge、Hack、重测、蓝绿与故障注入 characterization tests。

## 写入规则

- HTTP route 不直接修改状态，必须调用 Judge application service。
- application service 在事务内调用状态机并使用 `state + fencingToken` CAS。
- 终态 Attempt 的旧回传返回 stale/no-op，不同步第二次成绩。
- `Submission` 代码、语言、用户、题目和活动上下文在创建后不因重试或重测改变。
- 远程归档记录不创建 Run/Attempt，也不进入本地队列。
