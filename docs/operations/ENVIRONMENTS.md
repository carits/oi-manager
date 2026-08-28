---
status: current
audience: development, operations
last_verified: 2026-08-29
source_of_truth: deploy/systemd, runtime audit scripts, Playwright config, production host inspection
---

# 环境边界

## 环境分类

| 环境 | 进程与端口 | 数据 | 用途 |
|------|------------|------|------|
| development | `pnpm dev`、Web HMR `3001`、tsx watch | 开发 PostgreSQL/schema 与开发存储 | 本地或受控开发，不作为公网常驻服务 |
| e2e | `3100/3102` 临时进程 | PostgreSQL `e2e` schema、`test-results/storage` | 确定性写入、Judge、Hack、Revision 与浏览器测试 |
| hosted runtime | systemd Web `3000`、Router `3002`、API `3302/3303`、Worker/Executor/Judge | 当前正式数据与 `/data` 资产 | `47.99.222.76` 当前公网运行形态 |
| production v1 target | hosted runtime + HTTPS/安全 Cookie/严格 CSP/外部告警/异机留存 | 正式数据、不可变备份与异机副本 | 完成外部依赖后的正式验收状态 |

单元测试使用 PostgreSQL `test` schema。E2E 使用独立 schema、端口、存储和任务开关，禁止复用
生产 `public` schema。

## 当前公网运行环境

当前服务器已经启用生产式运行拓扑，不再使用 PM2、Nix、`pnpm dev` 或 watch 进程承载公网流量：

```text
Nginx :80
  ├─ Web systemd :3000 (.next-current)
  └─ API Router systemd :3002
       └─ active blue/green API :3302 or :3303

PostgreSQL :5432 loopback (Docker)
go-judge :5050 loopback (Docker)
Scheduler leader / Executor / Judge (systemd)
```

Web/API/Judge 使用构建产物；Router 通过 readiness、原子上游切换和旧实例 drain 完成蓝绿发布。
数据库、go-judge、Router 和 API 均不直接暴露公网。

当前仍是 HTTP 入口，业务环境继续保留 `APP_ENV=development` 的兼容配置，因此这套运行时不能冒充
已经完成 Production v1 外部验收。缺口只由
[未完成事项执行总表](REMAINING_WORK_2026-08-27.md) 跟踪，包括 TLS、Secure Cookie、严格 CSP、
真实外部告警、异机留存和授权后的生产恢复演练。

## Development

- 只用于本地或受控开发。
- Web HMR 使用 `127.0.0.1:3001`；Server/Judge 可使用 watch。
- `JUDGE_TOKEN` 仍必须配置，维护 API 默认关闭。
- 开发服务不得占用公网稳定 Router 或活动蓝绿 slot。

## E2E

- `NODE_ENV=test`、`E2E_BUILD=true`。
- `DATABASE_URL` 必须包含 `schema=e2e`。
- `DISABLE_BACKGROUND_JOBS=true`，外部 OJ 默认 Mock。
- `NEXT_DIST_DIR=.next-e2e`，JWT/Judge Token 动态生成。
- 写入、并发、故障注入和破坏性流程只能在该隔离层执行。

## Production v1 目标

- `NODE_ENV=production`、`APP_ENV=production`。
- HTTPS 同源入口，HTTP 强制跳转。
- `COOKIE_SECURE=true`，启用 HSTS、最终 CSRF 复验和严格 CSP。
- `CORS_ORIGINS`、`CSRF_TRUSTED_ORIGINS` 只包含正式域名。
- JWT、Judge Token、账号加密密钥使用独立强随机值。
- `ALLOW_UNAUTHENTICATED_JUDGE=false`、`ENABLE_MAINTENANCE_API=false`。
- 外部告警和异机日志/备份必须有真实送达及校验和证据。

完整变量见[环境变量参考](../reference/ENVIRONMENT_VARIABLES.md)，部署操作见
[systemd 部署](SYSTEMD_DEPLOYMENT.md)和[部署说明](DEPLOYMENT.md)。
