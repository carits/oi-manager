---
status: current
audience: development
last_verified: 2026-07-30
source_of_truth: package.json and workspace package manifests
---

# 开发工作流

## 根命令

| 命令 | 用途 |
|------|------|
| `pnpm dev` | 清理 `3000/3002`，构建 Shared，启动全部开发应用 |
| `pnpm dev:dirty` | 不清理端口，直接启动工作区 |
| `pnpm restart` | 重启开发服务 |
| `pnpm stop` | 停止开发服务 |
| `pnpm build` | `shared → server → web → judge` 正式构建 |
| `pnpm test` | 依次运行 Server、Web、Judge Vitest |
| `pnpm test:ui:smoke` | Chromium/Firefox UI 冒烟 |
| `pnpm test:ui` | 全量 Playwright |
| `pnpm docs:check` | 文档、路由、模型和 API 清单检查 |

## 修改流程

1. 先定位页面、API、模型和角色边界。
2. 优先复用现有模块、组件、Hooks 和 Shared 类型。
3. 后端先做认证、角色和资源归属校验，再执行业务写入。
4. 涉及多个模型的写操作使用 Prisma 事务。
5. 前端明确区分加载、错误、空数据和成功状态。
6. 根据风险补单元测试或 E2E，再运行受影响构建。
7. 行为或接口变化同步更新活动文档和 `CHANGELOG.md`。

## 代码组织

- 新业务优先进入现有 `apps/server/src/modules/<domain>`，避免继续扩张单文件路由。
- 页面只负责组合和交互；跨角色业务 UI 放在 `apps/web/src/components`。
- 数据获取优先使用 `hooks/data`，特殊调用使用 `apiClient`。
- JWT、角色和跨应用 DTO 在 `packages/shared/src` 定义。
- Prisma Schema 是数据库字段与关系的唯一事实来源。

## 数据库变化

开发阶段可使用 `prisma:push` 快速同步本地 schema；需要保留升级历史或准备正式环境
时必须创建迁移。任何命令执行前先确认 `DATABASE_URL` 的数据库和 schema，测试只能
使用 `test` 或 `e2e`。

## Git

- 不提交 `.env`、运行时上传、Playwright 输出、截图和真实平台凭据。
- 统一使用根目录 `pnpm-lock.yaml`。
- 不提交 Shared 源目录中的生成 JS/DTS。
- 文档移动使用 `git mv`，同时更新仓库内引用。

