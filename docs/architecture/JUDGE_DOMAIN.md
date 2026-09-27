---
status: current
audience: development
last_verified: 2026-09-08
source_of_truth: Prisma JudgeRun/JudgeAttempt models and judge domain services
---

# Judge 领域模型与迁移契约

## 聚合边界

`Submission` 表达不可变用户行为；`JudgeRun` 表达一次逻辑判定；`JudgeAttempt` 表达一次物理执行；`RejudgeBatch` 聚合一次范围重测请求。

一个 Run 固定 `testSetSlot`、`testSetFencingToken`、`testSetGraphHash` 与 `judgeConfigHash`，并持有对应 Reader 直到终态。一个 Attempt 只属于一个 Run，拥有唯一 `fencingToken`。`Submission.currentJudgeRunId` 和 `JudgeRun.currentAttemptId` 是读取指针，不改变历史记录。

## Candidate 评估车道

普通提交、Hack 与 Candidate 共用 Judge 连接但使用独立持久化领域记录。调度成功次数按 `8:1:1` 轮转；首选车道为空时可借用空闲容量，因此 Candidate 不能让普通提交饥饿。当前生产资源只允许一个贡献型数据生成任务处于 `running/finalizing`。

Candidate 的技术验证顺序为 Generator/直接输入、Validator、STD、Checker、Classifier 与去重；通过后进入有界池，不创建 Submission 或 JudgeRun。技术有效 Hack 还必须保存前后 Verdict/分数证据，但技术成功与正式入选是两个独立状态。Selector 或审计紧急写入只能排队替换 Evolving；Judge 回调不能直接修改 Stable、Evolving 或活动快照。

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
2. **Dual write（已结束）**：新本地提交原子创建 Submission/Run/Attempt；旧执行字段曾同步投影。
3. **Switch write（已完成）**：领取、回传、恢复与重测只变更 Run/Attempt，不再回写 Submission 结果。
4. **Switch read（已完成）**：详情、排名和统计只读取 current Run；缺少 Run 时 fail closed。
5. **Backfill audit**：所有受支持提交恰有 current Run/Attempt。
6. **Cleanup（进行中）**：远端代码归档已退役；旧结果镜像列由 telemetry 逐项审计，确认无消费者后物理删除。

任何阶段都必须保持旧 API 响应兼容、活动计分和排行榜不变，并通过普通 Judge、Hack、重测、蓝绿与故障注入 characterization tests。

当前进度：Switch write Cleanup 已完成。领取、回传、恢复和重测不再维护 `Submission.result/score/cases/...`；提交缺少 Run 时 fail closed 为 System Error。投影审计检查 Submission→Run 所有权、Run→Attempt 一致性及缺 Run，不再比较已停止维护的兼容列。

Switch read 由 `judge-read-projection.ts` 作为唯一边界：Run 的 `QUEUED/RUNNING` 映射为 `queuing/judging`，终态结果、分数、测试点、Subtask、错误与资源指标全部来自 CurrentJudgeRun。筛选与聚合使用同一语义的 Prisma/SQL 条件，不再读取 Submission 结果镜像作为 fallback。

## 写入规则

- HTTP route 不直接修改状态，必须调用 Judge application service。
- application service 在事务内调用状态机并使用 `state + fencingToken` CAS。
- 终态 Attempt 的旧回传返回 stale/no-op，不同步第二次成绩。
- `Submission` 代码、语言、用户、题目和活动上下文在创建后不因重试或重测改变。
- 正常远程评测仍可保存 `ojRemoteId`；已退役的远端代码归档记录不再允许创建。

## Hack 候选与 Evolving

Hack 的技术判定和 TestSet 槽更新是两个不同生命周期：

```text
ProblemHackAttempt（技术判定）
  -> TestcaseCandidate ADMITTED
  -> EVALUATING_L1 -> EVALUATING_L2 -> EVALUATING_HOLDOUT
  -> ELIGIBLE | ELIGIBLE_NOT_SELECTED | WAITING_REPLACEMENT
  -> SELECTED -> PROMOTED | REDUNDANT | FAILED
  -> queued Writer -> current EVOLVING slot
```

Candidate 固定输入/答案内容对象、基线 slot/graph/fencing token、命中 Subtask 和逻辑文件名。重复输入不创建新对象关系；Selector 按 Subtask 计算集合价值。所有 Hack/贡献写入同一 `(problem, EVOLVING)` writer queue，只有队首在 Reader 清空且 fence 未变化时才能原子替换。陈旧 Writer 失败并让 Candidate 回到可重新评估状态，不能覆盖更新后的 Evolving。

Promotion 与 Candidate 写入分离：捕获 Evolving 到事务临时目录，执行 Validator、STD、Accepted/Wrong replay 和质量校验，成功后排队替换 Stable。捕获后 Evolving 可以继续前进；临时目录不形成业务版本或第三槽。

测试内容只能通过 `BlobStore` port 读写。当前 `LocalBlobStore` 以内容寻址文件为事实源；槽关系复用既有 TestdataObject/Blob，不复制整套数据。
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

`COMPLETED` 仅代表候选数据生成和验证完毕，不改变题库正式数据。管理员发布时把已验证数据排队写入 Evolving，并复用 TestSet 槽 advisory lock、writer-priority 屏障、fencing、内容寻址对象与单向 Judge Projection；冲突不删除候选点。这个边界保证生成队列重试、API 蓝绿并存或管理员并发保存时不会产生半成品槽。
