---
status: current
audience: development, operations
last_verified: 2026-08-27
source_of_truth: e2e/stress/blue-green-finalization.spec.ts, scripts/start-isolated-blue-green-stack.sh
---

# 双 API Finalization 与 Router 演练

## 隔离边界

- PostgreSQL：`schema=e2e`，重建后写入确定性 fixture。
- API：blue `3412`、green `3413`。
- Router：`3410`，活动指针保存在测试结果目录。
- go-judge：独立容器和 `15051`，带 `oi-manager.e2e-blue-green=true` 所有权标签。
- Worker：独立 advisory lock 名；生产默认锁名不变。

任何缺少 `schema=e2e` 的运行都会在启动前拒绝。脚本只清理自己创建并带所有权标签的容器。

## 验证结果

2026-08-27 最终运行 `pnpm test:stress:blue-green`：1/1 通过，耗时 27.3 秒。

- 100 条 `judging` Submission 同时向 blue/green 两个 API 回传，全部进入 Accepted/100，只有一个回传拥有写入权。
- 终态后追加 Wrong Answer 的旧回传被忽略，不能覆盖 Accepted。
- 同一锁名的第二个 Worker 以明确 singleton lock 错误退出。
- 50 个 HTTP 客户端主动 RST 后 Router 进程仍存活且健康接口返回 200。
- Router 指针完成 blue→green、green→blue 回滚、再次提升 green。
- 已固定到 blue 的 Judge WebSocket 在 blue 收到 SIGUSR2 后以 1012 关闭。
- 真实 Judge 随后通过 Router 自动连接 green，日志中出现第二次 Registration confirmed。
- 测试结束后 3410/3412/3413/15051 均无监听，独立 go-judge 容器已删除。

## 相关回归

- Server：44 个测试文件、452 条用例全部通过。
- Judge：4 个测试文件、14 条用例全部通过。
- 空库安装：79 张表、29 条迁移、32 个种子用户。
- 正式备份恢复：79 张表、32 条迁移记录、20186 个用户。
- 两条数据库路径规范结构 SHA-256：`24eae42c9432f22d83202863811b500624c625b7c9bbf522d5e7133dc21aa599`。
