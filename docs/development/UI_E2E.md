---
status: current
audience: development
last_verified: 2026-09-28
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

`test:ui:prepare` 会验证 URL 明确包含 `schema=e2e`，重建 schema，并重新创建独立文件存储与
`test-results/testdata` 后写入确定性 fixture。它拒绝 `public` 或没有 schema 的数据库。

## 角色与数据

固定角色包括超级管理员、平台管理员、学校负责人、教师、校园学生和个人学生。负责人、教师和校园学生覆盖组织工作区；普通用户角色按 workspaceMode 切换个人工作区，管理员工作区不进入个人或组织工作区。
`auth.setup.ts` 通过登录 API 生成 `storageState`，不提交 JWT、Cookie 或真实密码。

fixture 固定创建学校、团队、题目、题单、作业、比赛和提交。动态页面使用
`e2e/fixtures/routes.ts` 中的 ID 解析，不依赖开发库现有数据。

校园学生和个人学生分别拥有独立团队 fixture。个人团队使用 scope=personal、organizationId=null 和通用 user 成员关系；组织团队使用 scope=campus 与当前 organizationId。个人团队、首页和排名只显示 username，不得返回真实姓名、学校、职称或后台岗位。

## 全角色工作区隔离计划

workspace-mode.spec.ts 与 workspace-isolation.spec.ts 是全角色工作区切换和缓存隔离门禁；旧 /teacher/*、/student/* 地址由 middleware 明确返回 410，不再作为业务兼容流程测试。两者覆盖以下矩阵：

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
每个页面检查未捕获异常、控制台错误、意外 4xx/5xx、无限加载和横向溢出；旧端路径必须稳定返回 410。模式切换测试必须
先看到个人团队，再切换到校园模式并只看到校园团队，以防缓存串用。

`workspace-knowledge-flow.spec.ts` 是全局内容与工作区导航边界门禁。它从教师、校园学生、个人账号、超级管理员和平台管理员的真实工作区侧栏进入知识广场，要求 URL、AppShell、主导航和身份上下文保持不变；公共 `/blog` 只用于匿名分享。套件还必须覆盖真实已发布文章互动、匿名登录 `next` 返回、社区读取错误不冒充零数据、Blog 元数据字段触发未保存确认、管理员 `/account/*` Logo 直接回管理首页，以及已登录用户访问安全 `next` 时不经过身份选择页。

静态导航巡检同时识别 `window.location.assign()` 和 `window.location.replace()`；新增或修改硬跳转不能绕过不存在路由和工作区边界检查。静态门禁不能替代上述真实点击流程。

日常 `WorkspaceSwitcher` 的目标行为是客户端软路由：确认未保存内容后先验证目标账号/组织上下文，失败留在原页且保留 dirty 状态；成功后新 URL 到达前不得显示旧工作区业务内容。
`/identity` 的首次选择和失效恢复允许硬进入。隔离 E2E 必须分别覆盖取消、目标 403/组织失效、网络失败、个人↔学校和学校 A↔学校 B。

工作区切换专项回归还必须覆盖以下竞态，而不能只验证最终 URL：

- 选择当前工作区是 no-op，不请求预检、不清缓存、不改变 dirty 状态。
- 目标预检失败时，来源 URL、Auth 上下文、缓存和未保存草稿全部保持。
- 用户确认离开后，若在慢预检期间继续输入，导航前必须再次确认；取消后新增内容仍在，重新确认时不得重复预检。
- 连续发起 A→B、A→C 时，旧 B 响应即使最后到达也不能覆盖 C；断言切换 generation 生效。
- 已离开 A 后，A 请求产生的 organization-unavailable 事件不能把 B 或个人空间重定向到 `/identity`。
- `/auth/me` 网络失败进入可恢复降级态，不能把已登录用户改成匿名或错误清除来源会话。
- URL 已变化但 Auth 仍是旧上下文的窗口内，`RoleShell` 不得短暂渲染旧组织业务内容。

这些场景对应 UI-11（预检期间新增编辑）和 UI-13（迟到组织事件）等高风险回归。测试应同时检查
请求次数、确认框次数、页面内容和缓存作用域；单纯等待最终地址会漏掉数据丢失与跨组织闪现。

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
- `test:ui`：覆盖 1440×900、1280×720、核心 CRUD、文件、Judge、Hack、比赛重测、活动内容快照、ICPC/OI/IOI 完整闭环和安全边界。具体规格数与用例数以 Playwright 实时收集结果为准。
- `headed`：本地可视调试。
- `live`：手动真实 OJ/Judge 探针，不作为合并门禁。
- `routes:audit`：扫描前端跳转表达式，生成 `test-results/navigation-static-report.json`；不存在静态路径、缺失动态标识和已知禁止父路径会阻断。

AppShell 响应式门禁在 `human-ux-navigation.spec.ts` 覆盖 `1440×900`、`1100×800`、`1099×800`、
`1024×768`、`800×900` 和 `390×844`。测试必须证明不存在 compact rail，桌面收起偏好可恢复、
窄屏抽屉不持久化，且 Logo 唯一、焦点恢复、背景滚动锁定和水平溢出检查均通过。
补充固定顶栏入口坐标、组织内 Shell DOM 连续性以及禁用 JavaScript 时的 Cookie 首屏用例。
Cookie 首屏用例先通过真实按钮保存偏好，再将 storageState 交给无 JavaScript 的独立 Context；
不能只等待 hydration 后的最终截图就宣称没有闪烁。账号菜单不再包含重复的工作区或业务入口。
旧 localStorage 迁移用例必须证明：只有缺失新 Cookie 时才导入；成功后旧键被删除；已存在 Cookie、非法旧值或
其他账号的旧键不会覆盖当前偏好。窄屏打开抽屉不得写入桌面 Cookie。

## 2026-09-28 发布证据

UI Shell 发布代码 `f04b0aa50adb8b0dfe95310f179378db25a1ac4a` 已通过 Web TypeScript、53 个测试文件
279 项单元/组件测试、production build、UI state、architecture、routes 和 docs 门禁。Web canary 及
promote 后生产消息闭环分别完成序号 368/369 与 370/371，线上 BUILD_ID 为
`TPv-g5acV9SKdg2qySdoI`。

发布消息闭环只证明 Web/API/Cookie/SSE 与提升链健康，不等价于本文件定义的多角色、双学校、dirty、
故障注入和多视口 Playwright。后续 Shell 或 Workspace 改动仍必须运行对应专项套件，不得引用本次部署探针豁免。

Training Engine 双角色套件必须用“平台 + 题号”完成创建，并跑通“首阶段运行 → 观察 → 准备唯一下一阶段 → 完成决策 → 复盘”。教师中途即时换组、延时、提前结束并追加未来 Stage；学生不刷新收到 SSE，当前要求与历史进度分离。套件同时断言界面没有“普通训练 / 教练带练”、上一阶段、题库浏览器或题单选题入口。

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
已完成本地提交进入 `queuing`、重复重测只计入跳过，以及未选择题目的历史结果不变。核心流程还固定验证：
终态提交即使没有测试点明细，详情页也必须显示最终 Verdict；已退役的远端归档 API 必须保持 404。

`activity-statement-snapshot-flow.spec.ts` 真实选择整场活动题面并验证管理员/参与者权限边界、参与者读取、
活动内 Markdown 编辑、不可变 revision、陈旧快照 `409 CONTENT_SNAPSHOT_STALE` 和已移除创建接口的 404。
页面检查还要求官方语言/格式共享行使用“官方中文/官方题面”等通用标签，不能借用第一道题标题误导其他列。

PR 运行冒烟；`main` 推送和每日定时任务运行 Chromium 全量与紧凑视口。真实连通性
只在手动 workflow 中使用 Secrets，且不保存可能含凭据的 trace。

## Training Engine V3 E2E

双角色场景应完成：单页创建并开始训练、调整当前题目、准备唯一下一轮、确认学员不可见待开始轮次、教师明确切轮、学生收到有效题集变化、换组和题目移出/重加后历史 Progress 保留，并验证不存在旧设计器、模板或回滚入口。
