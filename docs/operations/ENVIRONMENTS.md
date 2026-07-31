---
status: current
audience: development, operations
last_verified: 2026-07-31
source_of_truth: environment examples, Playwright config, runtime validation
---

# 环境边界

## 三类环境

| 环境 | 进程 | 数据 | 用途 |
|------|------|------|------|
| development | `3000` 优化预览、`3001` Next HMR、tsx watch | PostgreSQL `public`、开发存储 | 当前服务器与日常开发 |
| e2e | 3100/3102 临时进程 | PostgreSQL `e2e`、`test-results/storage` | 确定性 UI 测试 |
| production | 构建产物、PM2、Nginx | 独立正式库和存储 | 模板已提供，当前未启用 |

单元测试使用 PostgreSQL `test` schema，不属于开发数据。

## 开发

- 业务环境 `APP_ENV=development`
- 公网预览使用 `NODE_ENV=production` 启用 Next 优化，不改变业务环境
- Web preview `3000`、HMR `127.0.0.1:3001`、Server `3002`、go-judge `5050`
- 允许调试日志和 watch
- `JUDGE_TOKEN` 仍必须配置
- `ENABLE_MAINTENANCE_API=false`
- CORS 自动允许本机开发来源

当前公网服务器即使可从外部访问，也仍按开发环境管理。不要因此复用正式密钥或把
开发进程称为生产服务。

## E2E

- `NODE_ENV=test`, `E2E_BUILD=true`
- `DATABASE_URL` 必须包含 `schema=e2e`
- `DISABLE_BACKGROUND_JOBS=true`
- `NEXT_DIST_DIR=.next-e2e`
- JWT/Judge Token 在准备阶段动态生成
- 外部 OJ 默认 Mock

E2E 配置拒绝 `public` schema，不能改成复用现有开发服务。

## 正式

- `NODE_ENV=production`
- `APP_ENV=production`
- `COOKIE_SECURE=true`，只允许 HTTPS
- `CSRF_TRUSTED_ORIGINS` 只包含正式同源站点
- 使用 `*.env.production.example` 创建未提交的实际配置。
- JWT、Judge Token 和 OJ 账号加密密钥必须是独立强随机值。
- `CORS_ORIGINS` 只包含正式域名。
- `ALLOW_UNAUTHENTICATED_JUDGE=false`
- `ENABLE_MAINTENANCE_API=false`
- Web 通过同域 Nginx 访问 API 和 WebSocket。

当前只保证正式构建链路可验证，不执行正式切换。部署前还需在 staging 验证 PM2、
标准 `next build` / `next start` 产物、HTTPS、备份恢复和服务守护。

完整变量见[环境变量参考](../reference/ENVIRONMENT_VARIABLES.md)。

