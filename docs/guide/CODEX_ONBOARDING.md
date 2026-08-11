---
status: current
audience: development, operations, codex
last_verified: 2026-08-11
source_of_truth: repository scripts, current remote runtime, AGENTS.md, active docs
---

# Codex 项目接手指南

本指南供新的 Codex 会话接手 OI Manager 时使用，记录 SSH 目标、当前服务器工作树、运行结构、测试流程、部署流程、推送流程和项目特有风险，避免依赖聊天记录才能安全开始工作。

## 必须遵守的规则

- 在远端服务器工作，不在本地 Windows 保存项目副本。
- 当前服务器：`47.99.222.76`。
- 常用 SSH 别名：`alias`；不可用时使用 `ecs-user@47.99.222.76`。
- 当前工作树：`/data/oi-manager-response-refactor`；仓库：`carits/oi-manager`；分支：`main`。
- 公网 `http://47.99.222.76/` 是面向验证的开发服务器优化预览，不代表生产业务环境。
- 只有命令实际成功后才能说已推送、已部署、已测试或已验证。
- 每个仓库任务都要让文档与实现保持一致，并运行 `AGENTS.md` 要求的文档检查。

## 连接与检查

优先使用 SSH 别名：

```bash
ssh alias
cd /data/oi-manager-response-refactor
```

每次接手先检查：

```bash
git status --short --branch
git show -s --format='%h %D %ci %s' HEAD
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3002/api/health
```

工作树不干净时，默认改动属于用户或之前的 Codex 会话；未理解前不得 `reset`、`checkout`、删除或覆盖。

## 优先阅读

1. `AGENTS.md`：仓库完成规则与文档门禁。
2. `docs/README.md`：正式文档入口。
3. `docs/operations/REMOTE_ENVIRONMENT_MAP.md`：当前服务器如何区分开发、预览和生产模板。
4. `docs/operations/RUNBOOK.md`：端口、日志、启停、数据库和备份操作。
5. 与当前任务对应的指南、架构、开发、运维或参考文档。

`docs/archive/` 只保存历史材料，不得作为当前事实来源。发生冲突时，以当前源码、Prisma Schema、脚本、运行进程和标记为 `current` 的文档为准。

## 当前运行结构

| 服务 | 端口 | 进程形态 | 说明 |
|------|------|----------|------|
| 公网 Web | `80 -> 3000` | Nginx 转发本地预览 | 公网入口 |
| Web 预览 | `3000` | `pnpm --filter web preview:start` | 优化后的 Next 构建 |
| Web HMR | `127.0.0.1:3001` | `next dev` | 仅本机开发界面 |
| Server API | `3002` | `tsx watch src/index.ts` | 开发 API 进程 |
| PostgreSQL | `5432` | Docker `oi-postgres` | 开发数据库 |
| go-judge | `5050` | Docker `oi-judge` | 评测沙箱 |

常用检查：

```bash
ps -ef | grep -E 'pnpm|tsx|next|oi-manager|3000|3001|3002' | grep -v grep
ss -ltnp | grep -E ':(80|3000|3001|3002|3200|5050|5432)\b'
tail -n 120 /tmp/oi-dev.log
tail -n 120 /tmp/oi-web-preview.log
```

## 标准工作流程

1. 确认远端工作树状态。
2. 阅读相关源码和当前文档；服务器可能未安装 `rg`，可用 `grep`、`find`。
3. 以最小改动解决请求。
4. 运行覆盖风险的聚焦构建或测试。
5. 若改动需要在公网可见，重启 API 和/或提升 Web 预览。
6. 更新文档与变更记录。
7. 运行 `pnpm docs:check` 与 `git diff --check`。
8. 提交并推送 `origin main`。
9. 确认工作树干净且健康检查通过。

除非用户明确要求只分析，否则必须完成实现、验证和推送。

## 测试流程

按风险选择最小测试集；涉及共享契约、认证、Judge、Prisma 或路由时扩大范围。

| 改动范围 | 必跑命令 |
|----------|----------|
| 仅文档 | `pnpm docs:check`、`git diff --check` |
| Server 或 Prisma | `pnpm --filter server prisma:generate`、`pnpm --filter server build`、`pnpm --filter server test` |
| Web 组件或页面 | `pnpm --filter web build`、`pnpm --filter web test` |
| Judge | `pnpm --filter @oi-manager/judge build`、`pnpm --filter @oi-manager/judge test` |
| 全仓库 | `pnpm build`、`pnpm test`、`pnpm docs:check` |

交互、布局、认证或导航改动还应运行 `pnpm test:ui:smoke`、`pnpm test:ui:ux`；需要测试远端运行服务时用 `pnpm test:ui:live`。用户明确要求控制浏览器或验证可见行为时，仍要进行人工浏览器检查；若不可用，要如实说明缺失覆盖。

## 常用命令

```bash
# 依赖与 Prisma 客户端
pnpm install --frozen-lockfile
pnpm --filter server prisma:generate

# 构建
pnpm --filter server build
pnpm --filter web build
pnpm --filter @oi-manager/judge build
pnpm build

# 开发服务
pnpm restart
pnpm stop

# 公网预览部署到 3000
pnpm preview:build
pnpm preview:promote
curl -fsS http://127.0.0.1:3000/api/health

# 数据库迁移
cd apps/server
pnpm prisma migrate deploy

# 提交与推送
git status --short
git diff --check
git add <files>
git commit -m "type: 简要说明"
git push origin main
```

## 部署术语

- GitHub 推送：`git push origin main`。
- 公网 Web 预览更新：`pnpm preview:build && pnpm preview:promote`。
- API/Judge 运行时更新：后端、Prisma、依赖或 Judge 改动后通常运行 `pnpm restart`。

构建成功不等于部署成功。只有 `preview:promote` 和健康检查均通过后，才能说公网 `3000` 已更新。

## 文档门禁

每个完成的仓库任务都必须留下能长期维护的文档记录：

- 在 `docs/CHANGELOG.md` 写入带日期的结果与验证范围。
- 更新对应的当前指南、架构、开发、运维或参考文档。
- 能力、限制、端口、运行状态、部署状态或验证快照变化时更新 `docs/STATUS.md`。
- 更新被改动或复核的当前文档的 `last_verified`。
- 运行并报告 `pnpm docs:check`。

说明性文档、标题、变更记录和注释一律使用中文；命令、路径、环境变量、协议、代码标识符和第三方产品名称保留原写法，确保可执行和可检索。

## 安全规则

- 不打印 JWT、Cookie、OJ Cookie、数据库密码、Judge Token、加密密钥或完整机密环境文件。
- 未经明确风险评估，不得把旧目录的真实 `.env` 文件复制到当前工作树。
- 不执行 `git reset --hard`、`git checkout -- .`、`docker-compose down -v` 或宽泛的 `rm -rf`。
- 删除前确认路径在目标仓库内，或确为用户明确指定的目录。
- 安全与隐私约束优先放到后端 API，前端展示逻辑不能单独承担保护责任。

## 代码地图

| 区域 | 路径 | 作用 |
|------|------|------|
| Web | `apps/web/src` | Next.js App Router、React 组件、前端 API 客户端 |
| Server | `apps/server/src` | Express 路由、中间件、业务模块 |
| Prisma | `apps/server/prisma` | Schema、迁移、种子数据 |
| Judge | `apps/judge/src` | Judge 客户端与 go-judge 集成 |
| Shared | `packages/shared` | 共享类型与常量 |
| E2E | `e2e` | Playwright 测试与夹具 |
| Docs | `docs` | 唯一正式文档树 |

## 近期高风险区域

- 侧栏抽屉和工作区切换：`apps/web/src/components/layout` 下的布局组件。
- 弹窗焦点和表单输入：`apps/web/src/components/ui/Modal.tsx`。
- 个人模式资料隐私：资料 API 和 `/profile/user/:id`；不得暴露真实姓名、学校、手机号或邮箱。
- Judge 指标：CPU 时间、墙钟时间与峰值内存的来源必须一致；界面统一使用 `MS`、`MB`。
- 测试数据管理：`apps/server/src/routes/testdata.ts`、`apps/web/src/components/problem/JudgeSettingsTab.tsx`；当前包含暂存、冲突确认、ZIP 导入、单个/全部下载和 SHA-256。

## 浏览器验证

- 登录后进入正确的角色工作区。
- 控制台没有明显错误。
- 弹窗输入不丢焦点、不重置。
- 侧栏展开按设计保留或压缩内容。
- 个人模式不显示校园私密字段。
- 提交、重测、测试数据上传和下载流程可实际使用。

## 常见陷阱

- `3000` 上的 `NODE_ENV=production` 只表示优化后的 Next 预览，不表示生产业务模式。
- `/data/oi-manager` 存在旧的真实环境文件，但不是当前运行工作树。
- Web 预览与 Web HMR 是不同进程；重启开发服务不会更新公网 `3000`。
- Prisma Schema 或依赖变更通常需要生成、构建、重启，而不只是监听热更新。
- PowerShell -> SSH -> bash 的引号传递可能损坏命令；中文文本尤其要在提交前检查是否出现问号乱码。
- 测试数据、附件和 PDF 文件 API 必须先验证权限，才能访问磁盘。

## 最终回复清单

最终回复要短而具体：说明改动、已运行验证、是否部署公网 `3000`、是否推送 GitHub（含提交哈希）以及未完成的验证。禁止使用“应该没问题”或“可能已部署”这类模糊表述。
