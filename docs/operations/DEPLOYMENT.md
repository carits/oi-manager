---
status: current
audience: operations
last_verified: 2026-08-27
source_of_truth: deploy/systemd/*.service, scripts/install-systemd-services.sh, scripts/promote-api.sh, scripts/promote-preview.sh
---

# 部署与回滚

当前线上使用 systemd 管理 Web、稳定 API Router、蓝绿 API、单例 Worker 和 Judge。PM2/Nix/开发 watch 进程不属于现行部署链。详细 unit 参数见 [SYSTEMD_DEPLOYMENT.md](SYSTEMD_DEPLOYMENT.md)。

## 服务拓扑

```text
公网 3000 → oi-manager-web
本机 3002 → oi-manager-api-router → 3302 或 3303
                                  ↘ WebSocket /ws/judge
oi-manager-worker → PostgreSQL session advisory singleton lock
oi-manager-judge  → Router 3002 → 当前 API
go-judge 5050、PostgreSQL 5432 均只监听 127.0.0.1
```

Router 活动端口由 `.run/api-active-upstream` 原子文件决定，只接受允许列表中的 3302/3303。候选实例必须先通过 `/api/readiness`；部署编排可用 `API_STARTUP_READY_FILE` 在整个候选栈就绪前阻止 HTTP 流量。

## 发布前门禁

```bash
pnpm install --frozen-lockfile
pnpm --filter server test
pnpm --filter @oi-manager/judge test
pnpm test:stress:blue-green
pnpm db:install-paths:verify
pnpm build
pnpm docs:check
pnpm runtime:audit
pnpm security:audit
```

双 API 演练只允许使用显式 `schema=e2e` 数据库、独立端口和带所有权标签的独立 go-judge 容器。演练覆盖重复结果 CAS、Worker 单例、Router 切换/回滚、旧 API drain、Judge 1012 重连和客户端 RST。

## Server/API 发布

1. 确认 Git 工作区只包含本批交付文件，提交并推送 `main`。
2. 使用 `scripts/backup-db.sh` 创建并校验新备份。
3. 执行标准 Prisma `migrate deploy`；禁止修改历史 migration 或校验和。
4. 构建 Server，并在非活动端口启动候选实例。
5. 检查候选 `/api/health`、`/api/readiness`、数据库投影一致性和日志。
6. 使用 `scripts/promote-api.sh` 原子切换 Router 指针。
7. 旧实例收到 drain 信号后向 Judge 发送 1012，等待连接和在途请求退出。
8. 只重启唯一的 `oi-manager-worker.service`；第二个 Worker 必须因 advisory lock 拒绝启动。
9. 验证 Judge 已重新注册、队列继续消费且没有残留 `judging/finalizing` 任务。

## Web 发布

```bash
pnpm preview:build
pnpm preview:canary
pnpm preview:health
pnpm preview:promote
```

提升后核对 `.next-current/BUILD_ID` 与候选构建 ID 完全一致。Web 失败使用 `pnpm preview:rollback`，不会修改 API 指针或数据库。

## 回滚

- API 代码失败：Router 原子切回旧 slot，再停止候选实例；兼容扩展迁移通常保留。
- Web 失败：恢复上一 `.next` 构建并重启 Web unit。
- 只有数据库 Schema 或数据已经不可向后兼容时才执行数据库恢复；恢复前必须停止所有写入进程并获得明确授权。
- 回滚后必须重新检查 Router readiness、Judge 注册、Worker 单例、提交队列和公网关键流程。

## 当前正式投产缺口

开发预览仍使用 HTTP/IP 入口。域名、DNS、TLS、Secure Cookie、HSTS、严格 CSP、外部通知和异机日志完成前，不得把当前状态描述为正式生产入口。
