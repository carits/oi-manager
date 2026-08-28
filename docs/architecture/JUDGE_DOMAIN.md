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

Attempt 终态同时保存 Queue、Dispatch、Compile、Run、Persist、Total 六段真实延迟；缺少采集能力的历史记录保持 `null`，禁止根据总耗时反推伪造。SLO 口径见 [Judge SLO](../operations/JUDGE_SLO.md)。

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

任务协议必须携带 `judgeRunId`、`judgeAttemptId` 和 `fencingToken`。结果只有在 Attempt 仍为 current、owner Judge 相同且 token 相同时才能进入 `FINALIZING`；重复或延迟结果返回 stale/no-op。

## 渐进迁移

1. **Expand**：新增表、枚举、索引和兼容回填，不删除旧字段。
2. **Dual write**：新本地提交原子创建 Submission/Run/Attempt；旧执行字段继续投影。
3. **Switch write**：领取、回传、恢复与重测只变更 Run/Attempt，并事务更新旧投影。
4. **Switch read**：详情、排名和统计优先读取 current Run，缺失时回退 legacy Submission。
5. **Backfill audit**：所有可本地评测提交恰有 current Run/Attempt，归档记录没有本地生命周期。
6. **Cleanup**：稳定一个发布周期后删除 Submission 的 result、Judge owner、得分与测试点等旧执行态字段。

任何阶段都必须保持旧 API 响应兼容、活动计分和排行榜不变，并通过普通 Judge、Hack、重测、蓝绿与故障注入 characterization tests。

当前进度：Expand、Dual write 和 Switch write 已完成；读取仍以 Submission 兼容投影为主。Switch read、对账观察窗口与 Cleanup 尚未执行。

## 写入规则

- HTTP route 不直接修改状态，必须调用 Judge application service。
- application service 在事务内调用状态机并使用 `state + fencingToken` CAS。
- 终态 Attempt 的旧回传返回 stale/no-op，不同步第二次成绩。
- `Submission` 代码、语言、用户、题目和活动上下文在创建后不因重试或重测改变。
- 远程归档记录不创建 Run/Attempt，也不进入本地队列。

## Hack 候选与正式版本

Hack 的技术判定和题库正式数据晋升是两个不同生命周期：

```text
ProblemHackAttempt
  -> TestcaseCandidate VALIDATED
  -> PROMOTING
  -> PROMOTED | REDUNDANT | STALE | FAILED
  -> ProblemTestSetRevision（仅 PROMOTED）
```

Candidate 固定输入/答案内容对象、基线 Revision、命中 Subtask 和逻辑文件名。重复输入不会创建新 Revision；并发 CAS 失败保留为 `STALE` 并让 Hack 基于最新版重评。正式晋升必须在同一事务中完成 Candidate、Hack Attempt、Problem latest pointer 和 Revision 的提交，不能出现 Hack 显示成功但正式版本不存在。

测试内容只能通过 `BlobStore` port 读写。当前 `LocalBlobStore` 以内容寻址文件为事实源；S3/阿里云 OSS 通过注入 adapter 实现同一 `put/get/exists/delete/materialize` 契约，题目和 Hack 领域不得依赖供应商 SDK。
