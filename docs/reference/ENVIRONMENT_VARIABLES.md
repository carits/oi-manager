---
status: reference
audience: development, operations
last_verified: 2026-09-08
source_of_truth: process.env usage, environment examples, Playwright configuration
---

# 环境变量

示例值只能是占位符。真实密钥、Cookie、账号和服务器密码不得进入仓库。

## 服务端

| 变量 | 必需 | 默认/环境 | 用途 |
|------|------|-----------|------|
| `NODE_ENV` | 否 | `development` | `development/test/production` |
| `APP_ENV` | 否 | `development` | 业务环境；优化预览仍为 development |
| `COOKIE_SECURE` | 否 | 按 `APP_ENV` | 正式 HTTPS 必须为 `true` |
| `CSRF_TRUSTED_ORIGINS` | 否 | 开发本机来源 | Cookie 写请求允许的来源 |
| `PORT` | 否 | `3002` | HTTP 与 Judge WebSocket 端口 |
| `DATABASE_URL` | 是 | 无 | PostgreSQL 连接和 schema |
| `JWT_SECRET` | 正式必需 | 开发有非正式回退 | JWT 签名 |
| `CORS_ORIGINS` | 正式必需 | 开发允许 localhost | 逗号分隔来源 |
| `JUDGE_TOKEN` | 非 test 必需 | 无 | Judge 认证 |
| `ALLOW_UNAUTHENTICATED_JUDGE` | 否 | `false` | 仅 loopback 测试例外 |
| `ENABLE_MAINTENANCE_API` | 否 | `false` | 开启超管迁移接口 |
| `MEMBERSHIP_CAPABILITY_SOURCE` | 否 | `hybrid` | 组织授权来源；回填前使用 `hybrid`，对账后可切换 `normalized`，`legacy` 仅用于回滚 |
| `ACCOUNT_ENCRYPT_KEY` | 正式/OJ 账号必需 | 无 | OJ 账号字段加密 |
| `RATE_LIMIT_MAX` | 否 | 配置默认值 | 每分钟限流 |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `STORAGE_ROOT` | 否 | `apps/server/uploads` | 文件存储根 |
| `TESTDATA_DIR` | 否 | Server `testdata` | Judge 测试数据 |
| `TEMP_FILE_CLEANUP_HOURS` | 否 | `24` | 临时文件保留 |
| `TRASH_RETENTION_DAYS` | 否 | `7` | 回收站保留 |
| `DISABLE_BACKGROUND_JOBS` | 否 | `false` | E2E 关闭后台任务 |
| `CONTRIBUTION_REWARD_MODE` | 否 | `enabled` | `observe` 只统计到期待结算奖励且不领取租约；`enabled` 启用持久 Worker 入账 |
| `ENV_FILE` | 否 | `.env` | 指定 dotenv 文件 |
| `DEEPSEEK_API_KEY` | AI 功能必需 | 无 | AI 翻译 |
| `DEEPSEEK_BASE_URL` | 否 | 服务默认 | AI API 地址 |
| `DEEPSEEK_MODEL` | 否 | 服务默认 | AI 模型 |
| `TRANSLATION_ENABLE_CACHE` | 否 | 开启 | 翻译缓存 |
| `LUOGU_COOKIE` | 可选 | 无 | 洛谷附件抓取 |
| `QOJ_SESSION` | 可选 | 无 | QOJ PDF 抓取 |
| `BROWSER_PROXY` | 可选 | 无 | 浏览器抓取代理 |
| `BROWSER_PROXY_LIST` | 可选 | 无 | 多代理列表 |

## 前端

| 变量 | 必需 | 默认 | 用途 |
|------|------|------|------|
| `NODE_ENV` | 否 | Next 设置 | 运行阶段 |
| `APP_ENV` | 否 | `development` | 服务端业务环境 |
| `NEXT_PUBLIC_APP_ENV` | 否 | `development` | 浏览器可见的业务环境标识 |
| `NEXT_PUBLIC_API_URL` | 否 | 空 | 浏览器 API 前缀；同域保持空 |
| `BACKEND_URL` | 否 | `http://localhost:3002` | Next rewrite 和 Route Handler |
| `NEXT_DIST_DIR` | 否 | dev `.next-dev` / build `.next` | 隔离构建目录 |
| `E2E_BUILD` | 否 | `false` | 标记隔离的 UI E2E 构建 |

不要把仅服务端可见的密钥写成 `NEXT_PUBLIC_*`。

## 评测机

| 变量 | 必需 | 默认 | 用途 |
|------|------|------|------|
| `BACKEND_URL` | 是 | `ws://localhost:3002` | Server WebSocket |
| `JUDGE_TOKEN` | 是 | 无 | 必须与 Server 一致 |
| `ALLOW_UNAUTHENTICATED_JUDGE` | 否 | `false` | 仅本机测试 |
| `SANDBOX_HOST` | 是 | `http://localhost:5050` | go-judge |
| `JUDGE_ID` | 否 | `judge-1` | 实例 ID |
| `MAX_CONCURRENT` | 否 | `2` | 并发数 |
| `TESTDATA_DIR` | 否 | `../server/testdata` | 测试数据 |
| `JUDGE_TIMEOUT` | 否 | `60000` | 单任务超时 ms |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `ENV_FILE` | 否 | `.env` | 指定 dotenv 文件 |

## 端到端与在线验证

| 变量 | 用途 |
|------|------|
| `E2E_DATABASE_URL` | 必须明确含 `schema=e2e` |
| `E2E_ACCOUNT_PASSWORD` | 准备阶段可覆盖动态测试密码 |
| `E2E_BUILD` | 标记隔离测试运行 |
| `E2E_LIVE_BASE_URL` | 手动真实连通性地址 |
| `E2E_LIVE_USERNAME` | GitHub Secret |
| `E2E_LIVE_PASSWORD` | GitHub Secret |
| `E2E_LIVE_ROLE` | 手动探针登录模式 |
| `CI` | 开启重试、forbidOnly 等 CI 行为 |
