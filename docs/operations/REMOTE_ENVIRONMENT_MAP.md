---
status: current
audience: development, operations
last_verified: 2026-10-01
source_of_truth: 47.99.222.76 systemd units, listeners, Nginx config and deployed worktree Git HEAD
---

# 远端环境与运行拓扑

本文记录 `47.99.222.76` 当前真正承载公网流量的目录、端口和服务。判断事实时以 systemd
`WorkingDirectory/ExecStart`、监听端口、Router 上游和 Git HEAD 为准，不以旧工作树、软链接或历史
PM2 配置为准。

## 当前结论

- 唯一运行时事实源：/data/oi-manager-response-refactor；当前分支为 codex/training-ux-pr4，HEAD 为 08b2036075f2f73d8b429f7f4e56f7dd986004a3，与 origin/main 同提交。
- 文档刷新工作树为 /data/oi-manager-docs-refresh-20260927，仅用于文档审阅和提交，不承载公网流量。
- 运行目录、systemd 单元和 Git HEAD 已在 2026-09-27 核对；后续发布仍以 systemctl show、监听端口、readiness 和 canary/promote 结果为准。
- 公网入口：Nginx `:80/:443` → loopback Next.js `127.0.0.1:3000`。`:80` 对 `carits.top` / `www.carits.top` 返回 308 跳转到 HTTPS，`:443` 使用 Let’s Encrypt 证书；ACME challenge 保留在 `/var/www/letsencrypt`，Certbot timer 与 Nginx deploy hook 已启用。
- 稳定 API：Nginx → Router `127.0.0.1:3002` → 活动蓝绿 slot `3302` 或 `3303`。
- PostgreSQL `127.0.0.1:5432` 与 go-judge `127.0.0.1:5050` 由 Docker 管理。
- Scheduler、Executor、Judge 和 Web/API 均由仓库内 systemd unit 管理。
- 当前没有常驻 HMR、tsx watch、PM2 或 Nix 进程承载公网业务。
- TLS 已在公网启用：`https://www.carits.top/login` 与 `/api/health` 均已验证返回 200；当前证书有效期至 2026-12-29。Secure Cookie、CSP、HSTS 与外部告警仍按各自证据单独验收，不因 HTTPS 已恢复而自动标记完成。

## 服务映射

| 服务 | 单元/容器 | 监听 | 当前职责 |
|------|-----------|------|----------|
| Nginx | `nginx` | `0.0.0.0:80` | Web/API/WebSocket 同源反向代理 |
| Web | `oi-manager-web.service` | `127.0.0.1:3000` | `.next-current` 优化构建，只允许 Nginx/本机探针访问 |
| API Router | `oi-manager-api-router.service` | `127.0.0.1:3002` | 稳定 HTTP/WebSocket 入口 |
| API slot | `oi-manager-server@3302/3303.service` | loopback，单一活动 slot | 构建后的 `dist/index.js` |
| Scheduler | `oi-manager-worker.service` | 无公网监听 | leader-only 定时与协调任务 |
| Executor | `oi-manager-executor@N.service` | 无公网监听 | 可并行后台任务 |
| Judge client | `oi-manager-judge.service` | 主动连接 Router | 领取与回传评测任务 |
| PostgreSQL | Docker `oi-postgres` | `127.0.0.1:5432` | 当前数据库 |
| go-judge | Docker `oi-judge` | `127.0.0.1:5050` | 高权限沙箱运行时 |

活动 API slot 会随蓝绿发布变化，不能把某个端口永久写死为主实例。使用：

```bash
sudo ./scripts/promote-api.sh
curl -fsS http://127.0.0.1:3002/api/readiness
```

发布脚本启动候选、校验 readiness、原子切换 Router、让旧实例 drain，并以 WebSocket 1012 促使
Judge 重连。失败时不切流或回滚上游。

## 当前运行目录和配置

systemd 的 `WorkingDirectory` 均指向当前仓库：

```text
/data/oi-manager-response-refactor/apps/server
/data/oi-manager-response-refactor/apps/web
/data/oi-manager-response-refactor/apps/judge
```

Server/Judge 从当前仓库内 mode-600 环境文件加载配置。不要从旧 `/data/oi-manager` 工作树复制
`.env`，也不要输出密钥原文。运行时密钥检查、轮换和恢复流程见安全与运行手册。

服务器上的其他历史工作树不参与当前运行，也不构成部署事实源。所有开发、提交、推送和发布均在
`/data/oi-manager-response-refactor` 的 `main` 完成。

## Web 发布

Web 使用候选/当前/上一版本目录：

```text
.next-candidate
.next-current
.next-previous
```

标准流程：

```bash
pnpm preview:build
sudo ./scripts/promote-preview.sh
curl -fsSI http://127.0.0.1:3000/login
```

候选先在隔离端口健康检查，提升失败时恢复上一版本。`preview` 是构建脚本历史命名，不表示当前
Web 由开发 watch 进程运行。

## E2E 与生产数据边界

- E2E 使用 `3100/3102`、PostgreSQL `e2e` schema 和 `test-results` 存储。
- 并发、故障注入、Hack、Revision 和破坏性写入必须进入隔离层。
- 生产数据库仅执行日常业务请求、受保护迁移和只读验收。
- 覆盖正式库的恢复演练必须有明确维护窗口、备份 SHA-256 和书面授权。

## 快速核验

```bash
cd /data/oi-manager-response-refactor
git branch --show-current
git rev-parse --short HEAD
systemctl is-active \
  oi-manager-api-router \
  oi-manager-worker \
  oi-manager-executor@1 \
  oi-manager-judge \
  oi-manager-web
systemctl list-units 'oi-manager-server@*.service' --no-pager
curl -fsS http://127.0.0.1:3002/api/health
curl -fsS http://127.0.0.1:3002/api/readiness
ss -lntp | grep -E ':(80|443|3000|3002|3302|3303|5050|5432) '
```

## 命名约定

| 名称 | 含义 |
|------|------|
| 开发环境 | 本地 `pnpm dev`、HMR 和 watch 进程 |
| E2E 环境 | 独立端口/schema/storage 的确定性测试栈 |
| 公网运行环境 | 当前 systemd + Router + 蓝绿 API + 构建产物拓扑 |
| Production v1 | 公网运行环境再完成 TLS、浏览器安全、外部告警和异机留存后的验收状态 |

当前主机应称为“公网运行环境”或“Production v1 前置运行环境”，不能再称为 PM2 模板或开发 watch
预览；同时也不能在缺少 TLS 和外部送达证据时声称 Production v1 已全部验收。

未完成事项以[执行总表](REMAINING_WORK_2026-08-27.md)和
[外部依赖](EXTERNAL_DEPENDENCIES_2026-08-28.md)为准。
