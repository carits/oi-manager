---
status: current
audience: development
last_verified: 2026-08-01
source_of_truth: playwright.config.ts and e2e directory
---

# 全 UI E2E

## 隔离

Playwright 不复用 `3000/3002` 开发服务：

| 资源 | E2E 值 |
|------|--------|
| Web | `127.0.0.1:3100` |
| Server | `127.0.0.1:3102` |
| 数据库 | PostgreSQL `schema=e2e` |
| Next 构建目录 | `.next-e2e` |
| 文件存储 | `test-results/storage` |
| 后台任务 | `DISABLE_BACKGROUND_JOBS=true` |
| 维护 API | `ENABLE_MAINTENANCE_API=false` |

`test:ui:prepare` 会验证 URL 明确包含 `schema=e2e`，重建 schema 并写入确定性 fixture。
它拒绝 `public` 或没有 schema 的数据库。

## 角色与数据

固定角色包括超级管理员、平台管理员、学校负责人、教师、校园学生和个人学生。
`auth.setup.ts` 通过登录 API 生成 `storageState`，不提交 JWT、Cookie 或真实密码。

fixture 固定创建学校、团队、题目、题单、作业、比赛和提交。动态页面使用
`e2e/fixtures/routes.ts` 中的 ID 解析，不依赖开发库现有数据。

校园学生和个人学生分别拥有独立团队 fixture。个人团队虽然因 Prisma 外键要求保留内部
`schoolId`，但产品接口不得返回该字段，并统一显示“个人模式”；个人团队成员和个人排名只显示
`username`，不得返回真实姓名或学校身份。

## 学生模式隔离计划

`student-mode-isolation.spec.ts` 是校园/个人模式的合并门禁，覆盖以下矩阵：

| 范围 | 校园模式 | 个人模式 | 跨模式访问 |
|------|----------|----------|--------------|
| 团队列表 | 仅本校 `campus` 团队 | 仅全平台 `personal` 团队 | 不得出现在对方列表 |
| 团队详情 | 校园姓名与学校 | 用户名与“个人模式” | 返回 `403` |
| 团队子资源 | 题单、训练、成员、邀请、申请 | 同左，但按个人作用域 | 返回 `403` |
| Rating 排名 | 学校排名接口 | `/rankings/personal/rating` | 错误模式返回 `403` |
| 做题量排名 | 学校做题量接口 | `/rankings/personal/solved` | 错误模式返回 `403` |
| 页面与缓存 | 校园导航与校园数据 | 个人导航与个人数据 | 切换后清空旧缓存并重新请求 |

个人模式 UI 冒烟至少访问首页、团队列表、团队详情、排名、题库、题单、比赛和提交记录。
每个页面检查未捕获异常、控制台错误、意外 `4xx/5xx`、无限加载和横向溢出。模式切换测试必须
先看到个人团队，再切换到校园模式并只看到校园团队，以防缓存串用。

## 套件

```bash
pnpm test:ui:smoke
pnpm test:ui
pnpm test:ui:headed
pnpm test:ui:live
pnpm test:ui:report
```

- `smoke`：Chromium 和 Firefox 的登录、权限、导航与角色核心流程。
- `test:ui`：90 个页面、1440×900、1280×720、核心 CRUD、文件、Judge 和安全边界。
- `headed`：本地可视调试。
- `live`：手动真实 OJ/Judge 探针，不作为合并门禁。

## 页面规则

每个页面必须：

- 使用正确角色打开，不出现 404、未捕获异常或无限加载。
- 完成主区域加载，不产生意外 4xx/5xx。
- 紧凑桌面视口没有横向溢出、遮挡或控件错位。
- 列表区分加载、错误、重试和真实空数据。
- 表单覆盖必填、成功、服务端失败和重复提交保护。

测试禁止固定等待和主套件 `test.skip`。等待以可见元素、URL 或请求状态为准。

## Mock 与报告

外部 OJ 默认使用确定性 API Mock；本地模拟 WebSocket 驱动
`queuing → judging → accepted`。失败时保存 HTML/JSON、截图、视频、trace、控制台
异常和失败请求，CI 保留 14 天。

PR 运行冒烟；`main` 推送和每日定时任务运行 Chromium 全量与紧凑视口。真实连通性
只在手动 workflow 中使用 Secrets，且不保存可能含凭据的 trace。

