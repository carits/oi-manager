---
status: current
audience: development
last_verified: 2026-07-31
source_of_truth: package.json, docker-compose.yml, environment validation
---

# 开发环境启动

本指南从干净检出启动完整开发链路，不使用当前服务器已有进程或开发数据库。

## 前置条件

- Node.js 24（CI 基线）
- pnpm 10.33
- Docker 与 Docker Compose
- Linux、macOS，或带 Bash 的 Windows 环境

## 1. 安装与基础设施

```bash
git clone https://github.com/carits/oi-manager.git
cd oi-manager
pnpm install --frozen-lockfile
docker-compose up -d db judge
docker-compose ps
```

当前服务器安装的是独立 `docker-compose` 命令；安装 Compose Plugin 的环境可将其替换为
`docker compose`。Compose 只启动 PostgreSQL 和 go-judge，不启动 Web、Server 或
Judge 客户端。

## 2. 开发环境变量

创建 `apps/server/.env`：

```dotenv
NODE_ENV=development
APP_ENV=development
COOKIE_SECURE=false
CSRF_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
PORT=3002
DATABASE_URL=postgresql://oi:oi_password@127.0.0.1:5432/oi_manager?schema=public
JWT_SECRET=replace-with-a-development-secret
JUDGE_TOKEN=replace-with-the-same-development-token
ALLOW_UNAUTHENTICATED_JUDGE=false
ENABLE_MAINTENANCE_API=false
ACCOUNT_ENCRYPT_KEY=replace-with-32-char-dev-key
RATE_LIMIT_MAX=2000
```

创建 `apps/judge/.env`，其中 `JUDGE_TOKEN` 必须与 Server 一致：

```dotenv
BACKEND_URL=ws://127.0.0.1:3002
JUDGE_TOKEN=replace-with-the-same-development-token
ALLOW_UNAUTHENTICATED_JUDGE=false
SANDBOX_HOST=http://127.0.0.1:5050
JUDGE_ID=judge-development-1
MAX_CONCURRENT=2
TESTDATA_DIR=../server/testdata
JUDGE_TIMEOUT=60000
LOG_LEVEL=info
```

创建 `apps/web/.env.local`：

```dotenv
NEXT_PUBLIC_API_URL=
BACKEND_URL=http://127.0.0.1:3002
APP_ENV=development
NEXT_PUBLIC_APP_ENV=development
```

不要把这些 `.env` 文件提交到 Git。正式环境必须使用完全不同的随机密钥。

## 3. 初始化数据库

```bash
pnpm --filter server prisma:generate
pnpm --filter server prisma:push
pnpm --filter server prisma:seed
```

开发种子账号及其角色定义在 `apps/server/prisma/seed.ts`。种子数据只用于开发，
不要在公网或正式环境沿用默认凭据。

## 4. 启动应用

```bash
pnpm dev
```

根命令会先构建 `packages/shared`，确认 `3001/3002` 没有未知进程，再并行启动
Web HMR、Server 和 Judge。它不会清理或占用公网预览的 `3000`；发现端口冲突时会报告 PID
并退出。后台管理开发进程使用 `pnpm restart`，该命令只停止仓库自己记录的进程组。

访问：

- Web HMR：`http://127.0.0.1:3001`
- 优化预览：先执行 `pnpm preview:build && pnpm preview:start`，再访问 `http://localhost:3000`
- API 健康检查：`http://localhost:3002/api/health`
- go-judge：`http://localhost:5050`

停止开发服务使用 `pnpm stop`；重启使用 `pnpm restart`。

## 5. 首次验证

```bash
curl http://localhost:3002/api/health
pnpm build
pnpm test
```

登录后检查浏览器网络请求使用 `/api/*` 相对路径，并确认 Server 日志出现 Judge
认证和注册记录。遇到问题先看[故障排查](../operations/TROUBLESHOOTING.md)。
