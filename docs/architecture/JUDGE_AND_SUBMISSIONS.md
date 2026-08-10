---
status: current
audience: development, operations
last_verified: 2026-08-10
source_of_truth: apps/server/src/ws/judge.ts, apps/judge/src/client.ts
---

# Judge 与提交

## 提交类型

- Carits 本地提交：创建 `oj=carits`、`result=queuing` 的 `Submission`，由 Judge 消费。
- 外部 OJ 提交：通过平台账号或用户绑定提交，并由同步/轮询逻辑更新结果。
- 训练提交：额外关联 `trainingId`，按训练、作业或比赛权限控制可见性。
- 全局提交：题库上下文中的个人提交，按题目所有权和角色决定可见性。

## Contest Submission Visibility

Training and contest submissions may store an operational remote submission ID in Submission.ojRemoteId. For training or contest APIs, this identifier is visible only to users who can manage the training or contest. Non-manager participants receive ojRemoteId: null and hideRemoteId: true in the submission detail response, and list responses also return ojRemoteId: null.

This rule applies to all contest formats and statuses. It is separate from OI in-contest result hiding: OI may additionally hide score, result, time, memory, cases, and subtasks, while every contest format hides the remote ID from non-managers.

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

