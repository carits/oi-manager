---
status: current
audience: development, operations
last_verified: 2026-08-24
source_of_truth: runtime inspection, Edge, Playwright, Vitest, Prisma schema, route manifest
---

# 全平台审计记录（2026-08-24）

本记录跟踪全页面、全路由、全端口、角色权限、核心功能、测试、监控、压力测试与运维待办。
只有同时具备源码检查、自动化验证和真实 Edge 页面证据的项目才标记完成。

## 审计基线

| 项目 | 当前数量/状态 | 证据 |
|---|---:|---|
| Next.js 页面文件 | 63 | `route-inventory.spec.ts` 与源码清单一致 |
| HTTP 端点 | 303 | `pnpm docs:check` |
| Prisma 模型 | 66 | `pnpm docs:check`、`prisma validate` |
| 测试文件 | 58 | 仓库文件清单 |
| E2E 文件 | 42 | 仓库文件清单 |
| Playwright 可收集用例 | 253 | 修复并迁移统一组织路由后 `playwright test --list` |

## 已发现并处理

| 级别 | 问题 | 处理与验证 |
|---|---|---|
| 高 | PostgreSQL 5432、go-judge 5050 发布到所有网卡 | Compose 改为 `127.0.0.1`；容器重建后 DB healthy、SQL 查询、沙箱版本、API/Web 200 均通过 |
| 高 | Server API 3002 监听所有网卡，绕过同源 Web 入口直接暴露公网 | Server 默认 `API_HOST=127.0.0.1`；同机 Web/Judge 保持可用，外网 TCP 复测应不可达 |
| 高 | Playwright 路由 fixture 丢失 `routeOwner`、`resolveRoute`、`compactPatterns`，测试收集为 0 | 恢复并适配当前 63 路由；重新收集到 251 条用例 |
| 高 | E2E 种子仍写已删除的 `User.schoolId`、Teacher/Student/Admin 旧表，按当前 Prisma 重建后无法初始化 | 改用 Organization、OrganizationMembership 及学生/教师 Profile；`test:ui:prepare` 已通过 |
| 中 | 认证测试仍假设超级管理员、平台管理员可进入个人区 | 改为断言切换返回 403、会话保持管理工作区；E2E 同步增加管理员单工作区场景 |
| 中 | 组织题单详情读取 `params.id`，但组织 catch-all 路由只提供 `segments`，列表可见而详情始终无数据 | 详情组件增加 `listIdOverride`，组织路由显式传入 `parts[0]` |
| 中 | 旧学校题单/比赛测试继续调用已退役 `/api/schools/*`，产生大量 410 假失败 | 增加明确 410 退役契约；当前组织资源由统一接口、团队接口和浏览器套件覆盖；旧行为用例不再作为现行契约 |
| 中 | 题单测试 helper 仍写已移除 `ProblemList.schoolId` | 改为通过 `School.organizationId` 写入 `scope/organizationId` |
| 中 | 排行榜提交列表叠加详情弹窗时出现页面与弹窗两个滚动条，且按一次 Escape 会关闭两层 | Modal 同时锁定 `html/body`，仅最上层处理 Escape/Tab；长代码嵌套弹窗 E2E 已通过 |
| 高 | 学生直接输入 `/org/:id/management`、`problems` 可停留在受限 URL；组织侧栏部分链接是相对地址 | 学生模块白名单增加客户端强制返回概览；侧栏统一从已解析配置生成绝对组织链接 |
| 中 | `/account/*` 继续使用相对校园导航，Next 预取多个不存在的 `/account/*` 子路由并产生 404 | 账号中心统一使用绝对个人导航；全角色真实点击巡检通过 |
| 中 | 无题目编辑权仍展示 AI 工具并请求受保护的 `/ai/usage`，页面控制台产生 404 | 仅 `permissions.canEdit` 时加载并渲染 AI 工具，题目详情路由健康检查通过 |

## Edge 页面验收进度

使用真实 Microsoft Edge，经 SSH 隧道访问当前线上构建；每页记录最终 URL、可见标题、主内容、
控制台 warning/error 与页面横向溢出。

### 学校负责人工作区

以下一级模块已检查，无页面错误、控制台错误或横向溢出：

- 学校工作概览、校园信息、学生/教师/资产管理、团队、作业、比赛、校内题库、题单、校内排行榜。
- 团队详情、ACM 比赛详情、活动题面选择、校内题目详情、题目编辑、提交详情。
- 组织题单详情 catch-all 参数、嵌套提交弹窗单滚动条与逐层关闭均已在最新预览中用 Edge 复验。

## 自动化状态

- 已通过：`docs:check`、`routes:audit`、`ui:state-check`、Prisma Schema、Web TypeScript、
  Playwright 收集、E2E 隔离库重建、校园负责人“题单→作业→比赛→排名→两级提交弹窗”浏览器流程。
- 已通过：Chromium 56 条完整冒烟（统一登录、权限矩阵、六种身份、内部链接、路由、题库、工作区隔离）；
  性能预算 3/3、加载/空/超时状态 3/4，剩余一条仅为已改版团队选择器断言，已修正等待复跑。
- 全量 Server 主跑首次在旧契约套件累计大量同源失败后中止，避免重复执行无效用例；正在迁移
  测试 helper 与退役契约，完成后重新执行全量 Server/Web/Judge。
- E2E 使用独立 `e2e` schema、3100/3102 和独立存储；重置脚本拒绝任何不含 `schema=e2e` 的数据库。

## 未完成审计

- 超级管理员、平台管理员、教师、学生、个人区的全部页面与交互 Edge 验收。
- 303 个 HTTP 端点按匿名/本人/同组织/跨组织/管理员权限矩阵检查。
- 文件上传、外部归档、评测、Hack、重测、题面快照、比赛三赛制的破坏性流程在隔离 E2E 环境复验。
- 正式监控、日志采集、告警、备份恢复演练、负载/容量/长稳测试和依赖漏洞扫描。
- 生产进程仍为开发预览与 watch 组合；正式 systemd/PM2、Nginx、TLS 与限流尚未启用。
