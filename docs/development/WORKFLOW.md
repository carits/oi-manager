---
status: current
audience: development
last_verified: 2026-09-19
source_of_truth: AGENTS.md, package.json and workspace package manifests
---

# 开发工作流

## 根命令

| 命令 | 用途 |
|------|------|
| `pnpm dev` | 构建 Shared、生成 Prisma Client、检查 `3001/3002`，启动内部 HMR、Server 和 Judge |
| `pnpm dev:dirty` | 生成 Prisma Client、检查 `3001/3002`，不重建 Shared，直接启动工作区 |
| `pnpm preview:build` | 生成供公网检查的优化 Web 构建 |
| `pnpm preview:start` | 由独立 PID 启动 `3000` 优化预览 |
| `pnpm preview:health` | 检查优化预览健康状态 |
| `pnpm run restart` | 重启开发服务 |
| `pnpm stop` | 停止开发服务 |
| `pnpm build` | 构建 Shared、生成 Prisma Client，再构建 Server、Web、Judge |
| `pnpm test` | 依次运行 Server、Web、Judge Vitest |
| `pnpm test:ui:smoke` | Chromium/Firefox UI 冒烟 |
| `pnpm test:ui` | 全量 Playwright |
| `pnpm docs:check` | 文档、路由、模型和 API 清单检查 |
| `pnpm routes:audit` | 扫描前端跳转表达式并阻断已知不存在路径、缺失动态标识 |
| `pnpm ui:state-check` | 拒绝整页等待文案、mounted 门和页面级重复鉴权 |

## 修改流程

1. 先定位页面、API、模型和角色边界。
2. 优先复用现有模块、组件、Hooks 和 Shared 类型。
3. 后端先做认证、角色和资源归属校验，再执行业务写入。
4. 涉及多个模型的写操作使用 Prisma 事务。
5. 前端明确区分加载、错误、空数据和成功状态。
6. 根据风险补单元测试或 E2E，再运行受影响构建。
7. 按“风险分级完成门禁”更新必要的活动文档、状态和变更记录。
8. 所有任务运行 `git diff --check`；只有分级或受影响库存事实要求时运行完整 `pnpm docs:check`，再提交、推送或部署。

涉及路由、按钮、菜单、通知、返回链接或工作区切换时，除构建外必须运行 `pnpm routes:audit`，并使用 E2E 固定身份实际点击受影响入口。不要通过 Prisma、SQL 或临时脚本直接修改默认数据库来制造验收数据；应补受权限保护的 API 和 API/E2E 测试。

## 风险分级完成门禁

所有任务都必须保证代码、测试、活动文档和对外报告互相一致，但验证与记录成本按风险分级，
不再把完整文档门禁强加给每个局部改动。

| 级别 | 适用范围 | 必须记录 | 必须验证 |
|---|---|---|---|
| 1：局部实现 | CSS/UI、小缺陷、内部重构、测试补充；不改变公开契约、权限、Schema、部署流程或运行状态 | 只有既有活动文档会失真时才更新；不强制 CHANGELOG、STATUS 或 last_verified | 受影响测试/构建和 `git diff --check`；视觉、路由或交互按对应专项门禁验证 |
| 2：行为与契约 | API/Runtime Contract、用户可见行为、权限/隐私规则、运维命令语义 | 归属文档与 `docs/CHANGELOG.md`；只刷新实际改动或复核文档的 last_verified | 模块测试、类型/构建和定向 API/浏览器验证；触及路由、模型、API 或架构库存时运行 `pnpm docs:check` |
| 3：架构、数据与发布 | 架构边界、Prisma/数据迁移、安全边界、部署回滚、生产状态、跨系统变更 | 归属文档与 CHANGELOG；当前能力、限制、拓扑、验证或 rollout 变化时更新 STATUS | `pnpm docs:check`、相关架构/迁移检查、按爆炸半径执行广泛测试或 E2E；部署时验证并记录真实运行证据 |

共同规则：

1. 代码、配置、测试和活动文档描述必须一致；任务使既有文档失真时，无论级别都必须更新。
2. 排查未形成长期项目事实时无需制造文档记录；形成长期事实时写入其唯一归属文档。
3. `docs/architecture-progress.json` 只由生成脚本维护，禁止手工改数字。
4. 未执行或失败的验证必须如实标明；未发生的推送、合并、部署或上线不能写成完成。
5. 敏感值不得进入文档、日志样例、变更记录或测试证据。

架构工作开始前读取 `docs/architecture-progress.json` 的显式退出条件。旧 transport 必须为零，
intentional raw transport 必须登记；Feature 内部 transport 是观察指标，不要求归零。优先处理真实的
边界违规或兼容不变量，不得只为降低调用数增加空包装层。Contest runtime 和 Judge 兼容计数仍是
真实未完成迁移，只能在业务迁移与证据齐备后清零。

任务结果不能只存在于聊天、提交信息、终端输出或个人笔记中。根目录 `AGENTS.md`
将本节作为项目级执行约束。

## 代码组织

- 新业务优先进入现有 `apps/server/src/modules/<domain>`，避免继续扩张单文件路由。
- `routes/` 只允许请求解析、DTO 校验、认证上下文、application service 调用和响应映射；禁止新增 Prisma、事务、文件操作、Judge 操作、状态转换或业务权限判断。
- 核心状态只能通过 domain transition 函数修改；禁止在 route 或无状态机保护的 service 中直接写状态字符串。
- 领域重构采用 expand → dual-write → switch-write → switch-read → cleanup，任何批次都不得同时删除旧事实源和引入新事实源。
- 页面只负责组合和交互；跨角色业务 UI 放在 `apps/web/src/components`。
- 数据获取优先使用 `hooks/data`，特殊调用使用 `apiClient`。
- JWT、角色和跨应用 DTO 在 `packages/shared/src` 定义。
- Prisma Schema 是数据库字段与关系的唯一事实来源。

根目录 `pnpm dev`、`pnpm dev:dirty` 和 `pnpm build` 都会在 Server 启动或编译前执行
`prisma generate`；直接执行 `pnpm --filter server build` 时，Server 的 `prebuild` 也会
构建 Shared 并生成 Prisma Client。因此干净检出和 Schema 更新后无需依赖旧工作树中的
生成产物。

## 数据库变化

开发阶段可使用 `prisma:push` 快速同步本地 schema；需要保留升级历史或准备正式环境
时必须创建迁移。任何命令执行前先确认 `DATABASE_URL` 的数据库和 schema，测试只能
使用 `test` 或 `e2e`。

历史 migration 及其校验和不可修改。新增迁移必须同时验证全新空库与最新正式备份恢复库，二者规范结构签名一致后才允许部署。生产迁移前必须生成并校验备份。

## Git

- 不提交 `.env`、运行时上传、Playwright 输出、截图和真实平台凭据。
- 统一使用根目录 `pnpm-lock.yaml`。
- 不提交 Shared 源目录中的生成 JS/DTS。
- 文档移动使用 `git mv`，同时更新仓库内引用。
