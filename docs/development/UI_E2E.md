---
status: current
audience: development
last_verified: 2026-08-24
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
| 测试数据 | `test-results/testdata` |
| 后台任务 | `DISABLE_BACKGROUND_JOBS=true` |
| 维护 API | `ENABLE_MAINTENANCE_API=false` |

`test:ui:prepare` 会验证 URL 明确包含 `schema=e2e`，重建 schema，并重新创建独立文件存储与
`test-results/testdata` 后写入确定性 fixture。它拒绝 `public` 或没有 schema 的数据库。

## 角色与数据

固定角色包括超级管理员、平台管理员、学校负责人、教师、校园学生和个人学生；前五个账号
同时用于全角色工作/个人双模式矩阵。
`auth.setup.ts` 通过登录 API 生成 `storageState`，不提交 JWT、Cookie 或真实密码。

fixture 固定创建学校、团队、题目、题单、作业、比赛和提交。动态页面使用
`e2e/fixtures/routes.ts` 中的 ID 解析，不依赖开发库现有数据。

校园学生和个人学生分别拥有独立团队 fixture。个人团队使用 `schoolId=null` 和通用 `user`
成员关系；个人团队、首页和排名只显示 `username`，不得返回真实姓名、学校、职称或后台岗位。

## 全角色工作区隔离计划

`workspace-mode.spec.ts` 是全角色切换门禁，`student-mode-isolation.spec.ts` 保留旧学生会话与
旧 URL 兼容验证。两者覆盖以下矩阵：

| 范围 | 校园模式 | 个人模式 | 跨模式访问 |
|------|----------|----------|--------------|
| 团队列表 | 仅本校 `campus` 团队 | 仅全平台 `personal` 团队 | 不得出现在对方列表 |
| 团队详情 | 校园姓名与学校 | 用户名与“个人模式” | 返回 `403` |
| 团队子资源 | 题单、训练、成员、邀请、申请 | 同左，但按个人作用域 | 返回 `403` |
| Rating 排名 | 学校排名接口 | `/rankings/personal/rating` | 错误模式返回 `403` |
| 做题量排名 | 学校做题量接口 | `/rankings/personal/solved` | 错误模式返回 `403` |
| 页面与缓存 | 岗位/校园导航与校园数据 | 全角色统一个人导航与个人数据 | 切换后清空旧缓存并重新请求 |

五种角色的个人 UI 冒烟访问首页、团队、排名、题库、题单、比赛和提交记录；个人学生额外覆盖
动态详情和写流程。
每个页面检查未捕获异常、控制台错误、意外 `4xx/5xx`、无限加载和横向溢出。模式切换测试必须
先看到个人团队，再切换到校园模式并只看到校园团队，以防缓存串用。

## 套件

```bash
pnpm test:ui:smoke
pnpm test:ui
pnpm test:ui:headed
pnpm test:ui:live
pnpm test:ui:report
pnpm routes:audit
```

- `smoke`：Chromium 和 Firefox 的登录、权限、导航与角色核心流程。
- `test:ui`：当前 22 个规格文件、268 条可收集用例，覆盖 1440×900、1280×720、核心 CRUD、文件、Judge、Hack、比赛重测、活动内容快照、远程归档、ICPC/OI/IOI 完整闭环和安全边界。
- `headed`：本地可视调试。
- `live`：手动真实 OJ/Judge 探针，不作为合并门禁。
- `routes:audit`：扫描前端跳转表达式，生成 `test-results/navigation-static-report.json`；不存在静态路径、缺失动态标识和已知禁止父路径会阻断。

## 真实点击巡检

`e2e/tests/internal-link-audit.spec.ts` 不只盘点路由目录。它使用负责人、教师、校园学生和个人学生的固定会话，从各自模块页实际点击可见内部链接，并继续检查已发现详情页的包屑与返回链接。

```bash
pnpm test:ui:prepare
pnpm exec playwright test e2e/tests/internal-link-audit.spec.ts --project=chromium-desktop --workers=1 --grep principal
```

按角色分别运行可避免完整巡检超过单次执行时间。失败时必须保留来源页面、控件文本、原始 `href`、最终 URL、截图和 Trace。路由或按钮改动不得只以静态扫描或构建通过作为验收。

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
`queuing → judging → accepted`。Judge 种子必须显式包含 `judgeConfig`、`TestdataFile` 和物理测试数据，
不得依赖开发目录或前序用例残留。Hack E2E 使用真实 go-judge 编译 STD/Validator，并用独立 WebSocket
消息验证有效数据入库和历史提交不重测。失败时保存 HTML/JSON、截图、视频、trace、控制台
异常和失败请求，CI 保留 14 天。

`rejudge-flow.spec.ts` 使用题目范围执行真实比赛重测，必须同时验证普通参赛者返回 `403`、
已完成本地提交进入 `queuing`、重复重测只计入跳过、远程归档记录保持原结果，以及未选择题目的
历史结果不变。核心流程还固定验证：终态提交即使没有测试点明细，详情页也必须显示最终 Verdict。

`activity-statement-snapshot-flow.spec.ts` 真实选择整场活动题面并验证管理员/参与者权限边界、参与者读取、
活动内 Markdown 编辑、不可变 revision、陈旧快照 `409 CONTENT_SNAPSHOT_STALE` 和已移除创建接口的 404。
页面检查还要求官方语言/格式共享行使用“官方中文/官方题面”等通用标签，不能借用第一道题标题误导其他列。

PR 运行冒烟；`main` 推送和每日定时任务运行 Chromium 全量与紧凑视口。真实连通性
只在手动 workflow 中使用 Secrets，且不保存可能含凭据的 trace。
