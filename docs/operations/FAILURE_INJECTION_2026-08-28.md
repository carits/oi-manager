---
status: current
audience: operations, development
last_verified: 2026-08-28
source_of_truth: playwright.fault.config.ts, e2e/stress/infrastructure-faults.spec.ts, e2e/stress/blue-green-finalization.spec.ts
---

# 基础设施故障注入报告（2026-08-28）

所有破坏性动作都发生在独立端口、独立 `schema=e2e`、独立 PostgreSQL 容器和独立 go-judge 容器中。正式数据库、正式 Judge 和公网服务未停止或写入。

## 注入矩阵

| 故障 | 注入方式 | 期望与结果 |
| --- | --- | --- |
| API blue/green | 3412/3413 切换、回滚并 drain 旧实例 | Router 保持可用，100 个重复 finalization 只落库一次，旧实例退出后 readiness 正常。 |
| Worker | SIGTERM 主 Worker，再用同一 advisory lock 启动替代 Worker | 主 Worker 释放锁并退出，替代进程成功启动；已经完成的 100 条提交保持 Accepted。 |
| Judge WebSocket | API drain 发送 1012 | Judge 自动重连并重新注册，固定到旧连接的任务不会丢失。 |
| go-judge | 可控 HTTP 代理重置下一次 `/run` 编译请求 | 网络错误不再伪装成用户 CE/RE；Judge 关闭连接，Server 条件式恢复 1 条任务，重连后最终 Accepted/100。 |
| PostgreSQL | TCP 代理断开全部已有连接并拒绝新连接 3 秒 | Server 保留 Consumer 所有权并有界重试；数据库恢复后同一结果写入一次，最终 Accepted/100，无残留 Judge 所有权。 |

## 修复后的不变量

- 普通评测和 Hack 的沙箱传输故障均标记为 `retryable`，不进入用户 Verdict、Hack 技术结论或排行榜；Hack 的 Generator、Validator、Classifier、STD、Checker、baseline 和 candidate 链路沿用同一规则。
- Submission/Hack 结果在数据库持久化成功前不会从 Consumer 所有权映射中删除。
- 数据库短时故障按 100ms 起的指数退避重试，默认最多 60 秒；超限时关闭 WebSocket，由带 `result/status + judgeId` 条件的断连恢复接管。
- 断连恢复使用 `updateMany` 条件更新，不能把已经 CAS 落库的终态重新放回队列。
- 所有测试结束后独立 PostgreSQL/go-judge、代理和子进程均被清理。

真实外部告警渠道尚未配置。本报告证明本地状态转换和任务恢复，不将回环通知测试冒充为外部收件人验收。
