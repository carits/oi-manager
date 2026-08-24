---
status: current
audience: development, operations
last_verified: 2026-08-24
source_of_truth: apps/server/src/ws/judge.ts, apps/judge/src/client.ts
---

## 题目级双赛制评测

题目评测配置通过 YAML 的 `mode` 字段选择赛制：`acm` 为通过制，`oi` 为分数制。未设置该字段时，含有子任务的历史配置按 OI 解释，其余按 ACM 解释。

ACM 模式按测试点串行执行；首个非 Accepted 结果后，尚未开始的测试点返回 `Skipped`，题目总分为全通过 100 分，否则 0 分。编译失败不产生测试点，System Error 终止整题。

OI 模式保留子任务、依赖及 `min`、`max`、`sum` 计分语义。当前阶段不启用题目级测试点并发。

# 评测机与提交

## 提交类型

- 本地代码提交：`oj/problemId` 只记录题目来源，`submitMethod=local` 选择本站 Judge；Carits、
  Codeforces、洛谷、HDU 等来源题统一走该路径。
- 远程归档：平台绑定同步创建 `submitMethod=archive` 的只读历史记录。归档可展示，但不进入
  本地 Judge、比赛排名、最佳成绩或重新评测。
- 训练提交：额外关联 `trainingId`，按训练、作业或比赛权限控制可见性。
- 全局提交：题库上下文中的个人提交，按题目所有权和角色决定可见性。

代码提交要求题目已有本地 `judgeConfig` 和测试数据记录；任一缺失时接口返回
`409 LOCAL_JUDGE_NOT_CONFIGURED`，不会回退为远程评测。旧客户端传入的 `robot` 或
`myAccount` 会兼容规范为 `local`，`archive` 必须使用独立同步接口。

训练提交列表、详情和排行榜使用同一套 `Submission.result` 状态事实，不以 `cases` 是否存在作为“已评测”
的可见条件。因此 OLE、CE、RE、Judge Error 等没有测试点明细的终态记录仍可查询；Queuing/Judging
可显示为进行中。比赛题目标识统一返回 `TrainingProblem.id`，源题号仅用于兼容旧记录。

## 比赛远程提交 ID 可见性

训练和比赛提交可能会在 `Submission.ojRemoteId` 保存运行用的远程提交 ID。训练或比赛 API 只向拥有对应管理权限的用户返回该标识。非管理参与者在提交详情中会收到 `ojRemoteId: null`、`hideRemoteId: true`，列表接口同样返回 `ojRemoteId: null`。

此规则适用于所有比赛赛制和状态，并独立于 OI 赛中结果隐藏。OI 赛中还可能隐藏分数、结果、时间、内存、测试点和子任务；而每种比赛赛制都会向非管理者隐藏远程提交 ID。

提交独立页和比赛/训练弹窗复用同一 `SubmissionJudgeResult`。展示模式只取题目提交时的
`judgeMode`：OI 显示总分、Subtask、测试点分数、耗时、内存和 checker message；ACM 显示最终
Verdict、首个失败测试点、耗时和内存，不显示点分或子任务分数。比赛 format 只参与权限与赛中脱敏，
不决定评测结果布局。

## ICPC 首 A 判定

ICPC 榜单按题目分别标记首 A。判定以当前评测结果为准：在计入该榜单的提交中，最早获得 `accepted` 或达到题目满分的用户取得该题首 A；先前的错误提交只影响该用户罚时，不影响首 A 的通过时刻。

- `includeAdminInRanking=false` 时，团队所有者/管理员以及校级比赛创建者/学校负责人不会进入榜单，也不会抢占首 A。
- 提交先按 `createdAt` 排序；同一毫秒内按递增的提交 ID 稳定决胜。
- 重新评测改变通过结果后，查询榜单时会根据当前有效结果重新计算首 A。
- 排名接口在对应题目数据中返回 `isFirstAccepted`；Web 只使用该字段展示首 A，不在浏览器内自行比较提交时间。
- 排名接口在每题数据中同时返回 `acceptedAtMinutes`，表示从比赛开始到有效通过提交的完整分钟数；未通过或未提交时为 `null`。该字段与包含错误罚时的 `penalty` 分开，前端不得从总罚时倒推通过时间。
- Web 排名矩阵以“提交次数/通过分钟”展示通过结果；首 A 使用深绿色白字，普通通过使用浅绿色，尝试但未通过使用浅红色并显示负提交次数（如 `-1`、`-2`），未提交保持空白。

## WebSocket 连接

Judge 连接 `ws://<server>/ws/judge`，流程如下：

1. 建立 WebSocket。
2. 10 秒内发送 `auth`，携带 `JUDGE_TOKEN`。
3. 收到 `auth_success` 后发送 `register`。
4. 收到 `registered` 后发送 `start` 和并发数。
5. Server 下发 `judge`，Judge 返回 `result`。

未认证连接不能发送其他消息。无效 Token、认证超时或缺少服务端 Token都会拒绝启动
或断开连接。

## 心跳与重连

- Judge 每 30 秒发送 `ping`。
- Server 收到有效 `ping` 或 `pong` 都刷新活跃时间，并在需要时回复 `pong`。
- Server 每 30 秒扫描，60 秒无心跳时关闭连接。
- Judge 断开后等待 5 秒重连。

## 原子领取

每个 Judge Consumer 在 PostgreSQL 事务内执行：

```sql
SELECT id
FROM "Submission"
WHERE result = 'queuing'
  AND "problemInternalId" IS NOT NULL
  AND (
    "submitMethod" IN ('local', 'demo_scenario')
    OR (oj = 'carits' AND "submitMethod" <> 'archive')
  )
ORDER BY "createdAt"
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

同一事务把任务更新为 `judging` 并记录 `judgeId/judgeStarted`。多个 Judge 不会领取
同一任务。比赛提交优先使用 `TrainingProblem.judgeConfigSnapshot`，否则使用当前题目配置。

## 状态恢复

- Judge 断线：该 Judge 正在处理的任务恢复为 `queuing`。
- Server 重启：遗留的 Carits `judging` 任务恢复为 `queuing`。
- 超过 5 分钟没有完成的任务由定时扫描恢复。
- 重新评测会清除旧 Judge 归属并重新进入队列。

## 沙箱

Judge 通过 `SANDBOX_HOST` 调用 go-judge，完成编译、运行、资源限制和 Checker。
Docker 服务需要 cgroup/privileged 能力才能可靠检测内存限制。测试数据路径由
`TESTDATA_DIR` 指定，不应与上传临时目录混用。

## 观测

重点日志事件包括认证失败、注册、任务派发、心跳超时、任务恢复、编译失败和结果写入。
日志可以记录 `judgeId/submissionId`，不得记录 Judge Token 或用户源码全文。

Checker 上传仅接受 C/C++ 源文件，`testlib.h` 由系统提供；下载接口只返回受鉴权的 API 地址，不返回服务器绝对路径，且题目目录必须位于 `TESTDATA_DIR` 下。

## 题目级 ACM Hack

传统源码型 ACM 批处理题（`default`，以及历史兼容名称 `standard`）可在评测设置中配置
C++17 标准程序和 Validator，并显式启用题目级
Hack。Validator 可引用 Judge 内置的 `testlib.h`；启用前 Server 会通过 go-judge 编译检查
两个程序。任何拥有该题提交权限的用户都可提交直接输入，或提交 C++17/Python3 生成器，
同时提供一份使用题目允许语言的被 Hack 程序。
客观题、交互题、通信题、提交答案题和 OI 计分题不进入该流程。

Hack 使用独立的 `ProblemHackAttempt` 队列，不创建 `Submission`：

1. 生成或读取候选输入，并在沙箱内通过 Validator。
2. 运行标准程序生成候选点答案。
3. 使用当前完整测试集评测被 Hack 程序，取得 baseline Verdict。
4. 把候选点放在最前面，再运行候选点和当前完整测试集。
5. 两次确定性最终 Verdict 不同时接受；测试点编号、耗时或 message 变化不算有效。

有效结果限定为 Accepted、WA、PE、TLE、MLE、RE 和 OLE；CE、System Error 或通信失败
不能构成有效 Hack。有效输入以 `hack_<attemptId>.in/.out` 加入正式数据，所有已接受 Hack
位于普通测试点之前。题目配置和所有 ACM 活动快照同步更新，但历史提交、成绩和排行榜不
重新评测，OI/IOI 快照不变。

同一用户同题最多一个排队或评测中的任务，同一题最多一个正在评测的 Hack；PostgreSQL
部分唯一索引提供最终并发约束。配置 revision 或评测配置哈希变化会把旧任务标记为 stale，
不会写入数据。用户只可查看自己的完整记录，题目管理者可查看全部记录并重新执行系统错误
任务；其他用户只能看到有效 Hack 数量。列表接口只返回摘要，候选输入、生成器和被 Hack
源码必须通过单条详情接口按权限读取，避免历史记录较多时一次返回大量源码。失败记录使用
`failureStage` 标明输入、生成器、Validator、标准程序、baseline、candidate、配置一致性或
数据入库阶段；STD 未生成任何答案输出时按标准程序阶段系统错误处理，不能成为有效 Hack。
测试数据先以互斥创建方式写入两份暂存文件，再逐一提升并提交数据库事务；暂存写入、任一文件提升或事务
失败都会清理本次已经产生的暂存及最终文件，禁止留下半份 Hack 测试点。

接口为 `GET/PUT /api/problems/:id/hack-config`、`POST/GET /api/problems/:id/hacks`、
`GET /api/problems/:id/hacks/:hackId` 和 `POST /api/problems/:id/hacks/:hackId/retry`。
源码上限 256 KiB，候选输入和标准答案各 1 MiB。Judge WebSocket 使用独立的 `hack` /
`hack_result` 消息，并与普通提交交替领取，避免任一队列长期饥饿。
