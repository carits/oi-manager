---
status: current
audience: development, operations, codex
last_verified: 2026-09-19
source_of_truth: AGENTS.md, package.json, Playwright configuration, remote runtime scripts
---

# Codex 项目接手指南

## 统一登录与多校园身份

登录页只使用用户名和密码，不再选择学生端、教师端或管理员端。成功登录后进入 `/identity`：
平台管理员可选择平台管理、校园身份和个人；其他账号可选择其所有校园身份和个人。

校园归属以 `OrganizationMembership` 为唯一事实来源。同一账号可加入多个校园，且可在不同校园拥有不同身份；学生和教师资料保存在组织内档案。全局 `User` 不再保存校园归属，旧 `Student`、`Teacher` 模型和校园 `schoolId` 回退已经退役，不得恢复双模型读取。

本文是 OI Manager 的 Codex 执行手册。新会话开始时先读本文，再按任务读取对应模块文档。`docs/archive/` 只用于追溯历史，不可作为当前操作依据。

## 硬性规则

1. 只在服务器工作树开发：`/data/oi-manager-response-refactor`。本机不得保留项目副本、构建产物或测试数据。
2. 不得直接操作数据库。不得使用 Prisma Studio、`psql`、一次性 SQL、`prisma db execute` 或脚本绕过 API 改写业务数据。需要准备演示或 E2E 数据时，必须先实现并测试受权限保护的 API；Playwright 只能使用专用 `e2e` schema。
3. 不得重置、覆盖或删除未理解的改动。禁止 `git reset --hard`、`git checkout -- .`、`docker-compose down -v` 和无范围的删除命令。
4. 不能把构建通过说成已部署，不能把静态扫描说成真实点击验证。只有命令实际成功后，才能声明已测试、已推送或已部署。
5. 面向用户和维护者的说明文档一律使用中文。命令、路径、环境变量、协议、代码标识和第三方产品名称保持原写法。
6. 完成门禁按风险分级：局部实现执行定向验证；契约或用户行为变化更新归属文档与变更记录；架构、数据和发布变化执行完整文档与架构门禁。无论级别，只要现有活动文档会因此失真就必须同步修正。

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
6. 按下方风险级别更新必要文档并执行验证；所有任务至少运行 `git diff --check`，只有相应级别或受影响事实要求时才运行完整 `pnpm docs:check`。
7. 确认差异范围后提交、推送 `main`；只有运行时内容需要公网可见时才构建并提升到 `3000`。

## 路由和按钮门禁

路由任务不能只检查 `page.tsx` 是否存在。必须按“用户实际能点到什么”验证：侧栏、顶栏、卡片、表格行、包屑、返回按钮、空状态、通知、弹窗成功回调和更多菜单都属于跳转入口。

统一路由能力位于 `apps/web/src/features/workspace/model/workspaceRouting.ts`，跨域调用只从
`@/features/workspace` 公共入口导入。新业务导航优先使用：

- `moduleHref(...)`：工作区模块入口。
- `resourceHref(...)`：需要资源 ID 的详情页。
- `listHref(...)`：资源列表与安全返回页。
- `canNavigate(...)`：缺少 ID 时决定是否禁用。
- `fallbackHref(...)`：模块不支持或上下文不足时安全回退。
- `notificationHref(...)`：通知资源跳转；失效资源返回空值，不猜测地址。

账号身份、登录和资料能力统一从 `@/features/auth` 公共入口使用；请求实现位于 Auth Feature 内部，
共享 Runtime Contract 位于 `packages/contracts/src/auth.ts`。不要恢复 `components/AuthProvider`、
`components/profile`，也不要在页面里直接调用 `/api/auth/*`。新增或调整认证字段时必须同时更新共享
Schema、Server 边界、Feature API 和契约测试，生产兼容字段也必须显式列入 Schema。

用户资料展示和身份链接从 `@/features/user-profile` 使用。不要在 Ranking、Team、Contest 或 Submission 中
自行拼 `/api/users/:id/profile`、复制 `UserProfile` DTO，或根据 URL 猜测校园资料权限；Identity Contract 与
Server 的显式组织上下文共同决定可见投影。

团队功能从 `@/features/team` 公共入口使用，共享 Runtime Contract 位于 `packages/contracts/src/team.ts`。
新增 Team 字段或动作时必须同步更新 Contract、Server Route Adapter、Feature API 与隔离契约测试；页面不得
恢复 `components/team` 领域目录或直接调用核心 `/api/teams/*` JSON 接口。头像 multipart 和二进制下载只能作为
Feature 内登记的 Raw Transport 例外。

不得手写身份前缀后再拼接详情地址。尤其要避免“详情页存在，但父列表页不存在”的错误：

```text
正确详情：/org/:organizationId/contests/:cid
错误路径：缺少 organizationId 的组织页面
正确列表：/org/:organizationId/contests
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

## 完成门禁分级

| 级别 | 典型范围 | 文档与记录 | 最低验证 |
|---|---|---|---|
| 局部实现 | CSS/UI、小缺陷、内部重构、测试补充；不改变公开契约、权限、Schema 或运行状态 | 仅在既有活动文档会失真时更新；不强制 CHANGELOG、STATUS、last_verified 或完整 docs:check | 受影响测试/构建 + `git diff --check`；视觉或交互改动必须看真实页面 |
| 行为与契约 | API/Runtime Contract、用户可见行为、权限/隐私、运维命令语义 | 更新归属文档和 CHANGELOG；只刷新实际改动或复核文档的 last_verified | 模块测试、类型检查、构建及定向 API/浏览器验证；触及文档库存事实时运行 docs:check |
| 架构、数据与发布 | 架构边界、Prisma/迁移、安全边界、部署回滚、生产状态、跨系统改动 | 更新归属文档和 CHANGELOG；当前状态变化时更新 STATUS | `pnpm docs:check`、相关架构/迁移门禁、按影响范围执行广泛测试或 E2E；部署时留存真实证据 |

不要为了满足清单制造无意义文档改动。排查没有形成长期项目事实时无需留档；一旦改变长期事实，无论任务大小都要更新其唯一归属文档。

## 测试选择

| 修改范围 | 最低验证 |
|---|---|
| 仅文字且不影响文档库存事实 | `git diff --check`；活动文档结构或事实源变化时再运行 `pnpm docs:check` |
| Web 组件或页面 | `pnpm --filter web test`、`pnpm --filter web build` |
| API、权限或 Prisma | `pnpm --filter server prisma:generate`、`pnpm --filter server build`、`pnpm --filter server test` |
| 路由、按钮、菜单、通知、返回链接或工作区 | Web 验证 + `pnpm routes:audit` + 对应角色实际点击巡检 |
| Judge | `pnpm --filter @oi-manager/judge build`、`pnpm --filter @oi-manager/judge test` |
| 跨端或高风险改动 | `pnpm build`、`pnpm test`、`pnpm docs:check`，并按风险增加 E2E |

E2E 准备命令会重建 PostgreSQL 的 `e2e` schema 并写入固定 fixture：

```bash
pnpm test:ui:prepare
```

它不应接触默认 schema 或公网预览数据。严禁把测试脚本改成连接默认数据库。

## API 演示数据

需要在公网预览中展示比赛、题目、题解、附件和真实评测记录时，使用唯一允许的脚本：

```bash
DEMO_TEACHER_USERNAME=<教师用户名> \
DEMO_TEACHER_PASSWORD=<教师密码> \
DEMO_STUDENT_PASSWORD=<演示学生密码> \
node scripts/create-api-demo-contests.mjs
```

脚本只调用 `/api` 的登录、学生、团队、题目、附件、测试数据、比赛、开始/结束和提交接口。
禁止用 Prisma、SQL、`psql`、迁移脚本或任何数据库客户端补写演示数据。它使用固定“演示”前缀
并会优先复用已存在资源；重新执行只补齐缺失成员、题目关联和提交。登录接口有频率限制，脚本会
自动等待，不能通过并发登录规避。

赛时可见性、部分分和 ICPC 时间线使用独立的 V2 脚本。它仍然只调用 API；脚本本身不包含
密码、演示密钥、Prisma 或 SQL。服务器必须同时满足开发环境、`ENABLE_DEMO_SCENARIO_API=true`、
平台管理员身份和独立演示密钥，受保护接口也只接受内置的 V2 场景，不能传入任意用户、比赛或时间。

```bash
DEMO_TEACHER_USERNAME=<教师用户名> \
DEMO_TEACHER_PASSWORD=<教师密码> \
DEMO_STUDENT_PASSWORD=<演示学生密码> \
DEMO_PLATFORM_ADMIN_USERNAME=<平台管理员用户名> \
DEMO_PLATFORM_ADMIN_PASSWORD=<平台管理员密码> \
DEMO_SCENARIO_KEY=<仅服务器环境保存的演示密钥> \
node scripts/create-api-live-contest-v2.mjs
```

需要展示更长、更复杂的赛时数据时，使用 V3 脚本。它会创建 OI、IOI、ICPC 三场均进行中的
20 小时比赛，每场 8 题、8 名学生和复杂提交时间线；同样只调用 API：

```bash
DEMO_TEACHER_USERNAME=<教师用户名> \
DEMO_TEACHER_PASSWORD=<教师密码> \
DEMO_PLATFORM_ADMIN_USERNAME=<平台管理员用户名> \
DEMO_PLATFORM_ADMIN_PASSWORD=<平台管理员密码> \
DEMO_SCENARIO_KEY=<仅服务器环境保存的演示密钥> \
node scripts/create-api-live-contest-v3.mjs
```

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

完成前检查：先判定风险级别；代码、测试和活动文档是否一致；是否明确写出了未执行或失败的验证；该级别要求的归属文档、CHANGELOG、STATUS 和门禁是否完成；是否只在推送成功后声明“已推送”，只在 `preview:promote` 和健康检查成功后声明“已部署到 3000”。

最终回复应简明写清：改了什么、跑了什么、是否已推送、是否已部署、提交哈希，以及仍未覆盖的风险。
