---
status: current
audience: development
last_verified: 2026-08-01
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
| `pnpm ui:state-check` | 拒绝整页等待文案、mounted 门和页面级重复鉴权 |

## 修改流程

1. 先定位页面、API、模型和角色边界。
2. 优先复用现有模块、组件、Hooks 和 Shared 类型。
3. 后端先做认证、角色和资源归属校验，再执行业务写入。
4. 涉及多个模型的写操作使用 Prisma 事务。
5. 前端明确区分加载、错误、空数据和成功状态。
6. 根据风险补单元测试或 E2E，再运行受影响构建。
7. 按“任务文档门禁”同步活动文档、当前状态和变更记录。
8. 运行 `pnpm docs:check`，再提交、推送或部署。

## 任务文档门禁

每个完成的仓库任务都必须留下可追溯记录。范围包括代码实现、缺陷修复、测试补充、
配置或依赖调整、数据和运维操作、部署，以及确认了新项目事实的排查任务。

| 记录位置 | 必须记录的内容 |
|----------|----------------|
| `docs/CHANGELOG.md` | 日期、任务结果、影响范围、实际验证，以及是否已推送或部署 |
| `docs/STATUS.md` | 发生变化的当前能力、限制、端口、运行状态和最近验证数字 |
| 对应活动文档 | 长期有效的业务规则、接口契约、开发步骤或运维恢复方法 |
| 文档元数据 | 被修改或重新核对文档的 `last_verified` |

完成任务前逐项检查：

1. 代码、配置、测试和文档描述一致。
2. 失败、未执行和仅局部执行的验证被如实标明。
3. 未实际发生的推送、合并、部署或正式上线没有写成已完成。
4. 敏感值没有进入文档、日志样例或变更记录。
5. `pnpm docs:check` 通过。

任务结果不能只存在于聊天、提交信息、终端输出或个人笔记中。根目录 `AGENTS.md`
将本节作为项目级执行约束。

## 代码组织

- 新业务优先进入现有 `apps/server/src/modules/<domain>`，避免继续扩张单文件路由。
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

## Git

- 不提交 `.env`、运行时上传、Playwright 输出、截图和真实平台凭据。
- 统一使用根目录 `pnpm-lock.yaml`。
- 不提交 Shared 源目录中的生成 JS/DTS。
- 文档移动使用 `git mv`，同时更新仓库内引用。
