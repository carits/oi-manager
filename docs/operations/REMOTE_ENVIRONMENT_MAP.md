---
status: current
audience: development, operations
last_verified: 2026-08-04
source_of_truth: 47.99.222.76 runtime process list, Nginx config, repository scripts, env examples
---

# 远端环境区分说明

本文记录开发服务器 `47.99.222.76` 上 OI Manager 的实际环境边界。它的重点不是
“应该如何上线生产”，而是解释当前服务器上为什么会同时看到多个目录、多个启动脚本、
多个 `.env` 模板，以及如何判断当前真正对外服务的是哪一套。

## 当前结论

当前公网访问的 `http://47.99.222.76/` 不是正式生产环境，而是开发服务器上的优化预览。

运行形态是：

| 访问/服务 | 端口 | 当前来源 | 说明 |
|---|---:|---|---|
| 公网 Web | `80 -> 3000` | Next preview | Nginx 转发到本机 `3000` |
| Web preview | `3000` | `pnpm --filter web preview:start` | 使用 Next 优化构建产物 |
| Web HMR | `127.0.0.1:3001` | `pnpm dev` | 仅本机开发热更新 |
| Server API | `3002` | `tsx watch src/index.ts` | 开发 watch 进程 |
| PostgreSQL | `5432` | Docker `oi-postgres` | 开发数据库 |
| go-judge | `5050` | Docker `oi-judge` | 评测沙箱 |

业务环境仍按 development 管理。`3000` 上使用 `NODE_ENV=production` 只是为了启用
Next.js 的优化构建和 `next start`，不表示正式生产业务环境。

## 当前运行目录

服务器上存在多个工作树：

| 目录 | 用途判断 | 当前状态 |
|---|---|---|
| `/data/oi-manager-response-refactor` | 当前实际运行目录 | detached HEAD，指向 `origin/main` |
| `/data/oi-manager` | 旧开发工作树/旧配置留存 | 有真实 `.env` 文件，但不是当前运行目录 |
| `/data/oi-manager-school-library-test` | 校内题库/侧边栏验证工作树 | 分支验证目录 |
| `/data/oi-manager-loading-check` | loading 状态修复验证工作树 | 历史验证目录 |

判断当前服务来源时，以进程 `cwd` 为准，不以 `/home/ecs-user/oi-manager` 软链接为准。
本次核查时，`node`、`tsx`、`next-server` 进程的 `cwd` 都在
`/data/oi-manager-response-refactor`。

## Nginx 边界

当前 Nginx 配置位于：

```text
/etc/nginx/sites-available/oi-manager
/etc/nginx/sites-enabled/oi-manager -> /etc/nginx/sites-available/oi-manager
```

核心转发规则：

```text
/     -> http://127.0.0.1:3000
/api  -> http://127.0.0.1:3002
```

因此公网 `80` 端口只是反向代理，不负责判断开发或正式环境。真正的环境由后面的
`3000/3002` 进程、启动脚本和环境变量决定。

## 开发环境

开发环境用于日常开发、远端验证和调试。特征是：

- 通过 `scripts/restart-dev.sh` 或 `pnpm dev` 启动。
- Server 使用 `tsx watch src/index.ts`。
- Web HMR 使用 `127.0.0.1:3001`。
- Judge 客户端也通过 `tsx watch` 启动。
- 允许开发日志、watch、默认本机调试行为。
- `APP_ENV` 语义上是 `development`。

相关脚本：

```text
scripts/restart-dev.sh
scripts/stop-dev.sh
package.json -> dev / dev:dirty
```

开发进程不应被称为生产进程，即使它可以通过公网访问。

## 优化预览

优化预览用于把 Next.js 构建产物放到公网 `3000` 验证。它仍属于开发服务器流程。

特征是：

- Web 使用 `next start` 形式运行。
- 启动时设置 `APP_ENV=development NODE_ENV=production`。
- `NODE_ENV=production` 只表示 Next 运行优化构建。
- 构建产物通过 `.next-candidate`、`.next-current`、`.next-previous` 管理。
- 可先在 `3200` 启动 canary，健康检查通过后提升到 `3000`。

相关脚本：

```text
scripts/build-preview.sh
scripts/start-preview.sh
scripts/start-preview-canary.sh
scripts/promote-preview.sh
scripts/rollback-preview.sh
scripts/stop-preview.sh
ecosystem.preview.config.js
```

预览提升的大致流程：

1. 构建候选产物到 `.next-candidate`。
2. 在 `127.0.0.1:3200` 启动 canary。
3. 健康检查 `/login`。
4. 停止旧 `3000` preview。
5. 将 `.next-candidate` 提升为 `.next-current`。
6. 启动新的 `3000` preview。
7. 失败时回滚 `.next-previous`。

## 正式环境模板

正式环境目前是模板，不是当前服务器的实际运行方式。

正式模板特征应为：

- 使用 `pnpm build` 后的构建产物。
- Server 启动 `apps/server/dist/index.js`。
- Judge 启动 `apps/judge/dist/index.js`。
- Web 使用标准 `next start`。
- 由 PM2 或等价进程管理器托管。
- `NODE_ENV=production` 且 `APP_ENV=production`。
- 使用独立强密钥、正式 CORS、正式存储和正式数据库。

相关文件：

```text
ecosystem.config.js
apps/server/.env.production.example
apps/web/.env.production.example
apps/judge/.env.production.example
docs/operations/DEPLOYMENT.md
```

当前核查时，服务器上没有发现 PM2 正式进程在跑；当前对外服务仍来自开发/预览脚本。

## Env 文件如何区分

当前实际运行目录 `/data/oi-manager-response-refactor` 只有示例文件：

```text
apps/server/.env.example
apps/server/.env.production.example
apps/web/.env.development.example
apps/web/.env.production.example
apps/judge/.env.example
apps/judge/.env.production.example
```

旧目录 `/data/oi-manager` 中存在真实配置文件：

```text
apps/server/.env
apps/server/.env.production
apps/web/.env.local
apps/judge/.env
```

这些文件说明旧工作树曾经持有实际配置，但不能据此判断当前服务正在使用它们。当前服务
是否使用某个 env 文件，必须同时检查：

1. 进程 `cwd`。
2. 启动脚本。
3. 进程环境变量。
4. 应用启动日志。
5. 目录下是否存在实际 `.env` 文件。

不要把旧目录里的真实 `.env` 直接复制到新目录再重启。复制前必须确认数据库、密钥、OJ
Cookie、Judge Token、存储路径和 CORS 是否符合目标环境。

## 快速判断命令

只读查看当前进程来源：

```bash
ps -eo pid,lstart,cmd | grep -E 'oi-manager|next-server|tsx|pnpm|nginx' | grep -v grep
```

查看监听端口：

```bash
ss -ltnp | grep -E ':(80|3000|3001|3002|3200|5050|5432)\b'
```

查看某个进程的工作目录：

```bash
readlink /proc/<pid>/cwd
```

查看当前工作树提交：

```bash
git -C /data/oi-manager-response-refactor status --short --branch
git -C /data/oi-manager-response-refactor show -s --format='%h %D %ci %s' HEAD
```

查看 Nginx 转发：

```bash
cat /etc/nginx/sites-available/oi-manager
```

查看真实 env 文件分布，但不要打印密钥值：

```bash
find /data/oi-manager* -maxdepth 4 -type f \
  \( -name '.env' -o -name '.env.*' -o -name '*.env' \) \
  -print
```

## 命名建议

以后在沟通和文档中建议统一叫法：

| 名称 | 含义 |
|---|---|
| 开发服务 | `pnpm dev`，含 Server watch、Judge watch、Web HMR |
| 优化预览 | `3000` 上的 Next preview，`APP_ENV=development` |
| E2E 环境 | `3100/3102` 临时进程和 `e2e` schema |
| 正式环境 | PM2/生产密钥/正式数据库/HTTPS/CORS 的上线形态 |

如果只说“线上”，必须补充是“开发服务器公网预览”还是“正式生产环境”。当前
`47.99.222.76` 应称为开发服务器公网预览。

## 上线前检查

切换到正式环境前至少确认：

- PM2 或等价进程管理器可用并纳入开机自启。
- `apps/server/.env`、`apps/web/.env.production`、`apps/judge/.env` 在目标运行目录存在。
- `NODE_ENV=production` 和 `APP_ENV=production` 同时设置。
- `JWT_SECRET`、`JUDGE_TOKEN`、`ACCOUNT_ENCRYPT_KEY` 为正式独立强随机值。
- Server 与 Judge 的 `JUDGE_TOKEN` 完全一致。
- `CORS_ORIGINS` 只包含正式域名。
- `ALLOW_UNAUTHENTICATED_JUDGE=false`。
- `ENABLE_MAINTENANCE_API=false`。
- 数据库迁移、备份恢复、文件存储路径、Nginx、HTTPS 和日志轮转均已验证。

完成以上检查前，不应把当前开发预览当作正式生产环境。
