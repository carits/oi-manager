---
status: current
audience: operations, development
last_verified: 2026-07-30
source_of_truth: runtime scripts, application health checks, Playwright configuration
---

# 故障排查

## 页面打不开

```bash
curl -I http://127.0.0.1:3000/login
curl -fsS http://127.0.0.1:3002/api/health
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3002 -sTCP:LISTEN
tail -n 200 /tmp/oi-dev.log
```

公网打不开但本机正常时，检查云安全组、防火墙、Nginx 和 VPN 路由。浏览器显示页面但
API 失败时，检查 Next `BACKEND_URL` 和 Server CORS。

## 页面闪烁或重复刷新

- 确认 `3000` 只有一个 Next 开发进程。
- 不要在运行 dev 时让生产构建写入同一个目录；当前 dev 使用 `.next-dev`。
- 检查浏览器控制台的 hydration、chunk 和重定向错误。
- 检查登录角色与页面角色是否匹配，错误角色会跳回自身首页。

## 端口被占用

使用 [运行手册](RUNBOOK.md) 的端口命令找到监听 PID。优先执行 `pnpm restart`，
不要连续启动多个后台命令。确认端口释放后再启动。

## 数据库错误

```bash
docker-compose ps db
docker logs --tail 200 oi-postgres
docker exec oi-postgres pg_isready -U oi -d oi_manager
pnpm --filter server exec prisma validate
```

确认 `DATABASE_URL` 使用 PostgreSQL 和预期 schema。测试失败时不要创建或复制
SQLite 文件；启动 PostgreSQL 并检查 `test/e2e` schema。

## Judge 无法连接

```bash
docker-compose ps judge
curl -fsS http://127.0.0.1:5050/version
docker logs --tail 200 oi-judge
grep -E "judge_ws|auth|heartbeat" /tmp/oi-dev.log
```

确认 Server/Judge `JUDGE_TOKEN` 一致、`BACKEND_URL` 为 `ws://127.0.0.1:3002`、
go-judge 可达。每 30 秒 ping、60 秒超时；持续周期性断线通常是 Token、代理
WebSocket 或心跳处理问题。

## API 显示网络错误

浏览器开发工具检查真实状态和响应体：

- `401`：未登录、Token 无效或过期。
- `403`：角色或资源权限不足。
- `404`：资源不存在；维护 API 关闭时也是预期行为。
- `429`：请求频率过高。
- `5xx`：查看 Server 请求 ID 对应日志。
- `status: 0`：超时、断网或浏览器阻止连接。

## E2E 拒绝启动

- `E2E_DATABASE_URL` 必须明确含 `schema=e2e`。
- `3100/3102` 必须可用，Playwright 不复用已有服务。
- 先运行 `pnpm test:ui:prepare`。
- 查看 `test-results/playwright-report` 和 defect report。

## 外部 OJ 失败

先用 Mock 测试区分本地回归和外部变化。真实失败时检查平台状态、账号绑定、Cookie
配置状态、抓题任务错误码和外部页面结构。不要把 Cookie 或响应头完整贴入日志或 Issue。
