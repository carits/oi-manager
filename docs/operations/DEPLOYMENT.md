---
status: current
audience: operations
last_verified: 2026-07-30
source_of_truth: production env examples, ecosystem.config.js, nginx configuration
---

# 正式部署模板

## 当前状态

正式配置尚未在当前服务器启用。本文件描述现有模板和上线前检查，不是已完成部署证明。
不要直接把开发进程切换为正式进程。

## 组成

- PostgreSQL 16 和 go-judge：`docker-compose.yml`
- Server、Web、Judge：`ecosystem.config.js`
- HTTP/API/WebSocket 反向代理：`nginx/oi-manager.conf`
- 正式变量模板：三个应用的 `.env.production.example`

Compose 不包含 Web、Server 或 Judge 客户端。

## 构建验证

```bash
pnpm install --frozen-lockfile
pnpm build
```

构建顺序是 Shared、Prisma Client、Server、Web、Judge。构建期间 Next 使用 `.next`，
开发服务使用 `.next-dev`，两者不会覆盖。

## 配置准备

在受控主机上分别创建未提交的：

- `apps/server/.env`
- `apps/web/.env.production`
- `apps/judge/.env`

根据[正式环境](ENVIRONMENTS.md)和[变量参考](../reference/ENVIRONMENT_VARIABLES.md)
填写实际值。Server 与 Judge 的 `JUDGE_TOKEN` 必须完全一致。

## 预发布验收

1. 使用正式构建产物启动 PM2，不复用开发 watch 进程。
2. 验证 Web、API、`/ws/judge`、PostgreSQL 和 go-judge 健康。
3. 验证 Nginx 的 API、WebSocket、静态资源缓存和上传大小。
4. 使用非真实业务数据完成登录、提交、评测和文件上传。
5. 验证 PM2 自动重启、机器重启、日志轮转和内存限制。
6. 执行备份与恢复演练。
7. 检查 HTTPS、CORS、密钥、维护开关和无凭据日志。

当前 Web 使用标准 `next build` / `next start` 组合。若未来切换为 standalone
`server.js`，必须同时调整构建产物复制和 PM2 启动入口，并在 staging 验证。

## Nginx 反向代理

配置将：

- `/api/` 转发到 `127.0.0.1:3002`
- `/ws` 使用 Upgrade/Connection 转发到 Server
- `/_next/static/` 转发到 Web 并设置长期缓存
- 其他请求转发到 `127.0.0.1:3000`

正式环境应增加域名、TLS、访问日志、限流和可信代理配置。

## 回滚

上线前保存前一版本 commit、构建产物、数据库备份和存储备份。回滚顺序为停止新进程、
恢复兼容代码、仅在 schema 不兼容时恢复数据库、启动旧进程并执行健康检查。
