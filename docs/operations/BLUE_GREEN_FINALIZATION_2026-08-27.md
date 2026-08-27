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

## 生产发布

- Git：`8697c80` 已推送远程 `main`。
- 迁移前备份：`/data/backups/oi-manager/automatic/oi_manager_20260827_230448.dump`，14 MiB，已完成 `pg_restore` 列表校验。
- 数据库：`20260827_hack_finalizing_claim` 已应用，生产为 29/29 个迁移。
- API：Router 活动指针从 3302 原子切换到 3303；3302 drain 后 inactive。
- Router：新代码再次受控重启时 systemd 记录 `Succeeded`，没有未处理 Socket error。
- Judge/Worker：均为 active；Judge 在 Router 重启后重新认证并注册，活动队列中 `queuing/judging/finalizing` 均为 0。
- 验收：本机 3002、公网 3000 健康检查通过，318 个匿名端点审计为 0 failures，服务监控为 healthy。
