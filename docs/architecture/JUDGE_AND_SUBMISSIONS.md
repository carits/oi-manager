---
status: current
audience: development, operations
last_verified: 2026-08-18
source_of_truth: apps/server/src/ws/judge.ts, apps/judge/src/client.ts
---

## 题目级双赛制评测

题目评测配置通过 YAML 的 `mode` 字段选择赛制：`acm` 为通过制，`oi` 为分数制。未设置该字段时，含有子任务的历史配置按 OI 解释，其余按 ACM 解释。

ACM 模式按测试点串行执行；首个非 Accepted 结果后，尚未开始的测试点返回 `Skipped`，题目总分为全通过 100 分，否则 0 分。编译失败不产生测试点，System Error 终止整题。

OI 模式保留子任务、依赖及 `min`、`max`、`sum` 计分语义。当前阶段不启用题目级测试点并发。

# 评测机与提交

## 提交类型

- Carits 本地提交：创建 `oj=carits`、`result=queuing` 的 `Submission`，由 Judge 消费。
- 外部 OJ 提交：通过平台账号或用户绑定提交，并由同步/轮询逻辑更新结果。
- 训练提交：额外关联 `trainingId`，按训练、作业或比赛权限控制可见性。
- 全局提交：题库上下文中的个人提交，按题目所有权和角色决定可见性。

## 比赛远程提交 ID 可见性

训练和比赛提交可能会在 `Submission.ojRemoteId` 保存运行用的远程提交 ID。训练或比赛 API 只向拥有对应管理权限的用户返回该标识。非管理参与者在提交详情中会收到 `ojRemoteId: null`、`hideRemoteId: true`，列表接口同样返回 `ojRemoteId: null`。

此规则适用于所有比赛赛制和状态，并独立于 OI 赛中结果隐藏。OI 赛中还可能隐藏分数、结果、时间、内存、测试点和子任务；而每种比赛赛制都会向非管理者隐藏远程提交 ID。

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
WHERE result = 'queuing' AND oj = 'carits'
ORDER BY "createdAt"
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

同一事务把任务更新为 `judging` 并记录 `judgeId/judgeStarted`。多个 Judge 不会领取
同一任务。

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
