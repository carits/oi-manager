---
status: current
audience: development
last_verified: 2026-09-08
source_of_truth: Prisma JudgeRun/JudgeAttempt models and judge domain services
---

# Judge 领域模型与迁移契约

## 聚合边界

`Submission` 表达不可变用户行为；`JudgeRun` 表达一次逻辑判定；`JudgeAttempt` 表达一次物理执行；`RejudgeBatch` 聚合一次范围重测请求。

一个 Run 固定 `testSetRevisionId` 与 `judgeConfigHash`。一个 Attempt 只属于一个 Run，拥有唯一 `fencingToken`。`Submission.currentJudgeRunId` 和 `JudgeRun.currentAttemptId` 是读取指针，不改变历史记录。

## Candidate 评估车道

普通提交、Hack 与 Candidate 共用 Judge 连接但使用独立持久化领域记录。调度成功次数按 `8:1:1` 轮转；首选车道为空时可借用空闲容量，因此 Candidate 不能让普通提交饥饿。当前生产资源只允许一个贡献型数据生成任务处于 `running/finalizing`。

Candidate 的技术验证顺序为 Generator/直接输入、Validator、STD、Checker、Classifier 与去重；通过后进入有界池，不创建 Submission 或 JudgeRun。技术有效 Hack 还必须保存前后 Verdict/分数证据，但技术成功与正式入选是两个独立状态。正式发布只能由 Selector 或审计紧急发布调用 Revision CAS，不能从 Judge 回调直接修改活动快照。

Evaluation Credits 在每轮持久评估创建后、进入可领取队列前，同时预占用户日账户和平台日账户；同一轮 L1/L2/Holdout 共享唯一预算 ID，完成后按执行次数、CPU 毫秒和生成字节结算。租约和 fencing token 拒绝迟到回传，基础设施错误最多重试三次。直接 Candidate/Hack 最多 400 次沙箱执行与 60 秒 CPU，Generator 最多 4000 次与 300 秒；非 Holdout 阶段会预留至少一个 Hidden Holdout 样本额度，未完成 Holdout 时 fail closed。Generator v1 使用服务器选择的 Seed 和 JSON stdin；同一请求重复执行所得 SHA-256 不一致时以 `GENERATOR_NON_DETERMINISTIC` 终止。

新任务通过 `EvaluationCreditReservation` 固化三层预占：用户当日免费额度、长期有效的已购额度钱包、平台当日总预算。预占与任务创建在同一 Serializable 事务中；取消、配置过期和终态回传也与任务状态同事务释放或结算。结算始终优先消耗免费额度，未使用的已购额度通过不可变钱包流水释放；跨 UTC 日任务仍归属于创建时的 Reservation。Scheduler 每 30 秒幂等扫描终态遗留和超过 10 分钟的孤儿预占，作为异常恢复网；仍在运行或未知类型的任务不猜测结算。贡献等级只限制普通用户每日可使用的已购额度，题目管理者现有 100,000 Credits 上限和平台 250,000 Credits 硬上限保持不变。

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

当前进度：Expand、Dual write、Switch write 和用户可见读取的 Switch read 已完成。提交列表/详情、筛选、题目状态、个人概览、OI/ICPC 排名、平台/校园解题排名、管理统计及重测预览统一读取 CurrentJudgeRun；远程归档和没有 Run 的历史记录保留兼容回退。当前进入对账观察窗口，Cleanup 尚未执行。

Switch read 由 `judge-read-projection.ts` 作为唯一边界：Run 的 `QUEUED/RUNNING` 映射为 `queuing/judging`，终态结果、分数、测试点、Subtask、错误与资源指标全部来自 CurrentJudgeRun。筛选与聚合使用同一语义的 Prisma/SQL 条件，禁止页面直接混读 `Submission.result/score`。回归测试会故意破坏兼容列，验证列表、详情、筛选和排名仍返回 CurrentJudgeRun 的结果。

## 写入规则

- HTTP route 不直接修改状态，必须调用 Judge application service。
- application service 在事务内调用状态机并使用 `state + fencingToken` CAS。
- 终态 Attempt 的旧回传返回 stale/no-op，不同步第二次成绩。
- `Submission` 代码、语言、用户、题目和活动上下文在创建后不因重试或重测改变。
- 远程归档记录不创建 Run/Attempt，也不进入本地队列。

## Hack 候选与正式版本

Hack 的技术判定和题库正式数据晋升是两个不同生命周期：

```text
ProblemHackAttempt（技术判定）
  -> TestcaseCandidate ADMITTED
  -> EVALUATING_L1 -> EVALUATING_L2 -> EVALUATING_HOLDOUT
  -> ELIGIBLE | ELIGIBLE_NOT_SELECTED | WAITING_REPLACEMENT
  -> SELECTED -> PROMOTED | STALE | FAILED
  -> ProblemTestSetRevision（仅 PROMOTED）
```

Candidate 固定输入/答案内容对象、基线 Revision、命中 Subtask 和逻辑文件名。重复输入不会创建新 Revision；并发 CAS 失败保留为 `STALE`。Selector 按 Subtask 独立执行集合价值计算和 11 选 10，只有全部硬约束及增益门槛通过才晋升。正式晋升必须在同一事务中完成 Candidate、Hack Attempt、成员 retirement、Problem latest pointer 和 Revision 的提交，不能出现 Hack 显示已纳入但正式版本不存在。

测试内容只能通过 `BlobStore` port 读写。当前 `LocalBlobStore` 以内容寻址文件为事实源；S3/阿里云 OSS 通过注入 adapter 实现同一 `put/get/exists/delete/materialize` 契约，题目和 Hack 领域不得依赖供应商 SDK。

## 数据生成任务

`ProblemDataGenerationJob` 是独立于 Submission/JudgeRun 的持久任务。Server 每次只向 Judge
发放仍处于 `queued` 或租约已过期的任务，并原子写入 `judgeId`、`fencingToken` 和
`leaseExpiresAt`。Judge 回传结果时必须同时匹配任务状态、owner 和 token；重复、延迟或来自
旧连接的结果为 stale/no-op。Judge 断开后只回收它拥有且未完成的任务。

```text
QUEUED -> RUNNING -> COMPLETED -> PROMOTED
   |         |            |
   +---------+------------+-> CANCELLED | FAILED
```

每个 case 在沙箱内依次执行 Generator（或读取直接输入）、Validator、STD、Checker 自检。
Generator 参数以 argv 传入，并只注入 `CASE_INDEX`、`CASE_SEED`；输入、答案和错误通过有界
copy-out 返回。系统 STD/Validator/Checker 使用现有编译缓存，用户 Generator 按任务独立编译
并在结束后释放。

`COMPLETED` 仅代表候选数据生成和验证完毕，不改变题库正式数据。管理员发布时复用 TestSet
Revision 的 advisory lock、CAS、内容寻址对象与单向 Judge Projection 事务；Revision 冲突不
删除候选点。这个边界保证生成队列重试、API 蓝绿并存或管理员并发保存时不会产生半成品版本。
