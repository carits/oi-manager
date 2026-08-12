---
status: current
audience: development, operations, codex
last_verified: 2026-08-12
source_of_truth: AGENTS.md, package.json, Playwright configuration, remote runtime scripts
---

# Codex 项目接手指南

本文是 OI Manager 的 Codex 执行手册。新会话开始时先读本文，再按任务读取对应模块文档。`docs/archive/` 只用于追溯历史，不可作为当前操作依据。

## 硬性规则

1. 只在服务器工作树开发：`/data/oi-manager-response-refactor`。本机不得保留项目副本、构建产物或测试数据。
2. 不得直接操作数据库。不得使用 Prisma Studio、`psql`、一次性 SQL、`prisma db execute` 或脚本绕过 API 改写业务数据。需要准备演示或 E2E 数据时，必须先实现并测试受权限保护的 API；Playwright 只能使用专用 `e2e` schema。
3. 不得重置、覆盖或删除未理解的改动。禁止 `git reset --hard`、`git checkout -- .`、`docker-compose down -v` 和无范围的删除命令。
4. 不能把构建通过说成已部署，不能把静态扫描说成真实点击验证。只有命令实际成功后，才能声明已测试、已推送或已部署。
5. 面向用户和维护者的说明文档一律使用中文。命令、路径、环境变量、协议、代码标识和第三方产品名称保持原写法。
6. 任何完成的仓库任务都必须更新对应文档、`docs/CHANGELOG.md`，必要时更新 `docs/STATUS.md`，并运行 `pnpm docs:check`。

## 服务器与目录

| 项目 | 当前值 | 说明 |
|---|---|---|
| SSH 别名 | `alias` | 首选连接方式 |
| 备用连接 | `ecs-user@47.99.222.76` | 仅当别名不可用时使用 |
| 仓库 | `carits/oi-manager` | GitHub 主仓库 |
| 工作树 | `/data/oi-manager-response-refactor` | 当前开发与公网预览来源 |
| 分支 | `main` | 完成任务后推送的分支 |
| 公网入口 | `http://47.99.222.76/` | Nginx 转发到服务器 `3000` |

连接与接手检查：

```bash
ssh alias
cd /data/oi-manager-response-refactor
git status --short --branch
git show -s --format='%h %D %ci %s' HEAD
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3002/api/health
```

工作树不干净时，默认视为用户或之前会话的改动。先阅读、理解和保留；不要清理它们。

## 环境边界

| 场景 | Web | API | 数据库 | 用途 |
|---|---:|---:|---|---|
| 开发服务 | `127.0.0.1:3001` | `3002` | PostgreSQL 默认 schema | HMR 与后端 watch |
| 公网预览 | `3000` | `3002` | PostgreSQL 默认 schema | 对外可见的开发服务器预览 |
| E2E | `3100` | `3102` | PostgreSQL `e2e` schema | Playwright 隔离验证 |
| 正式生产模板 | 未启用 | 未启用 | 独立正式数据库 | 仅配置模板，不是当前服务器 |

`3000` 使用 Next 优化构建，因而会设置 `NODE_ENV=production`；这只表示 Next 的运行方式，不表示业务已经进入正式生产环境。当前服务器仍应称为“开发服务器公网预览”。

## 阅读顺序

1. `AGENTS.md`：仓库级完成门禁。
2. `docs/README.md`：全部当前文档入口。
3. `docs/operations/REMOTE_ENVIRONMENT_MAP.md`：目录、端口与环境边界。
4. `docs/development/WORKFLOW.md`：代码、数据、文档和 Git 流程。
5. 按任务继续阅读：路由看 `docs/reference/WEB_ROUTES.md` 与 `docs/development/UI_E2E.md`；权限与隐私看 `docs/architecture/AUTHORIZATION.md`；评测看 `docs/architecture/JUDGE_AND_SUBMISSIONS.md`；接口看 `docs/reference/api/README.md`。

## 标准开发流程

1. 在服务器检查工作树、提交和健康接口。
2. 阅读受影响页面、组件、API、Schema 与现有测试；先确认权限和数据边界。
3. 用最小改动实现。涉及业务写入时，后端先完成认证、角色、作用域与资源归属校验；跨模型写入使用事务。
4. 不通过数据库直接造数据。需要操作入口时，补充 API 与 API 测试，再由界面或 E2E 调用。
5. 按风险运行构建、单测和 E2E；修改页面布局时还要用浏览器检查实际效果。
6. 更新长期有效文档、变更记录和状态快照，运行 `pnpm docs:check` 与 `git diff --check`。
7. 确认差异范围后提交、推送 `main`；需要公网可见时再构建并提升到 `3000`。

## 路由和按钮门禁

路由任务不能只检查 `page.tsx` 是否存在。必须按“用户实际能点到什么”验证：侧栏、顶栏、卡片、表格行、包屑、返回按钮、空状态、通知、弹窗成功回调和更多菜单都属于跳转入口。

统一路由能力位于 `apps/web/src/components/workspace/workspaceRouting.ts`。新业务导航优先使用：

- `moduleHref(...)`：工作区模块入口。
- `resourceHref(...)`：需要资源 ID 的详情页。
- `listHref(...)`：资源列表与安全返回页。
- `canNavigate(...)`：缺少 ID 时决定是否禁用。
- `fallbackHref(...)`：模块不支持或上下文不足时安全回退。
- `notificationHref(...)`：通知资源跳转；失效资源返回空值，不猜测地址。

不得手写身份前缀后再拼接详情地址。尤其要避免“详情页存在，但父列表页不存在”的错误：

```text
正确详情：/teacher/school/contests/:cid
错误父路径：/teacher/school/contests
正确列表：/teacher/contests
```

路由或按钮变更至少运行：

```bash
pnpm routes:audit
pnpm --filter web test
pnpm --filter web build
pnpm test:ui:prepare
pnpm exec playwright test e2e/tests/internal-link-audit.spec.ts --project=chromium-desktop --workers=1 --grep <角色>
```

`internal-link-audit.spec.ts` 会以负责人、教师、校园学生和个人学生会话从模块页实际点击可见内部链接，并继续检查动态详情页中的包屑、返回链接和操作入口。失败产物必须包含来源页面、控件、原始地址、最终 URL、截图和 Trace；不要只报“E2E 失败”。

静态检查生成 `test-results/navigation-static-report.json`。其中“尚未迁移到统一路由函数”是待收敛清单，不等于真实点击已通过；“阻断问题”必须为零。

## 测试选择

| 修改范围 | 最低验证 |
|---|---|
| 仅文档 | `pnpm docs:check`、`git diff --check` |
| Web 组件或页面 | `pnpm --filter web test`、`pnpm --filter web build` |
| API、权限或 Prisma | `pnpm --filter server prisma:generate`、`pnpm --filter server build`、`pnpm --filter server test` |
| 路由、按钮、菜单、通知、返回链接或工作区 | Web 验证 + `pnpm routes:audit` + 对应角色实际点击巡检 |
| Judge | `pnpm --filter @oi-manager/judge build`、`pnpm --filter @oi-manager/judge test` |
| 跨端或高风险改动 | `pnpm build`、`pnpm test`、`pnpm docs:check`，并增加 E2E |

E2E 准备命令会重建 PostgreSQL 的 `e2e` schema 并写入固定 fixture：

```bash
pnpm test:ui:prepare
```

它不应接触默认 schema 或公网预览数据。严禁把测试脚本改成连接默认数据库。

## 部署与回滚

仅 Web 改动的公网预览发布：

```bash
pnpm preview:build
pnpm preview:promote
pnpm preview:health
curl -fsS http://127.0.0.1:3000/api/health
```

`preview:promote` 会先验证候选版本，再切换 `3000`。后端、Prisma、依赖或 Judge 改动还需按实际影响运行：

```bash
pnpm restart
curl -fsS http://127.0.0.1:3002/api/health
```

部署失败时先保留日志和当前状态，再按脚本回滚：

```bash
pnpm preview:rollback
tail -n 120 /tmp/oi-web-preview.log
tail -n 120 /tmp/oi-dev.log
```

不要通过手动移动 `.next-*` 目录、杀掉不明进程或复制旧 `.env` 文件来“快速修复”。

## Git 与文档交付

```bash
git status --short
git diff --check
git add <明确文件>
git commit -m "fix: 中文说明"
git push origin main
```

完成前检查：代码、测试和文档是否一致；是否明确写出了未执行或失败的验证；`docs/CHANGELOG.md` 是否记录日期、结果和实际验证；`docs/STATUS.md` 是否更新变化的能力、端口、限制或最近验证；是否运行 `pnpm docs:check`；是否只在推送成功后声明“已推送”，只在 `preview:promote` 和健康检查成功后声明“已部署到 3000”。

最终回复应简明写清：改了什么、跑了什么、是否已推送、是否已部署、提交哈希，以及仍未覆盖的风险。
