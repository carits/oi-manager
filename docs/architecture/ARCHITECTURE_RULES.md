---
status: current
audience: development, architecture
last_verified: 2026-09-13
source_of_truth: scripts/audit-route-boundaries.mjs, scripts/audit-domain-boundaries.mjs, apps/server/src/modules, apps/server/prisma/schema.prisma
---

# 架构不变量

本页是新代码必须遵守的架构宪章。领域文档解释业务细节，本页只记录不能通过兼容、配置或 UI 绕开的稳定边界。

## 身份与权限

- `User.role` 只表示账号级 `user | platform_admin | super_admin`。
- 学生、教师和学校负责人属于 Organization Membership，不得写入账号全局角色。
- 组织授权只读取 `OrganizationMembershipRole` 和 `OrganizationMembershipCapability`；`memberRole` 仅作资料类型与岗位展示。
- Membership 创建、恢复、导入和岗位变化必须在同一事务同步基础 RoleAssignment。
- 校园资源请求必须携带并校验显式 Organization ID；不得从 URL 之外的模糊页面状态或最早 Membership 猜测学校。
- 前端隐藏操作不是权限控制；每个写接口重新校验账号、Membership、Capability、资源归属和状态。

## HTTP 与领域边界

- 生产与集成测试必须共享 `createApplication()` 这一唯一 HTTP 组合根；测试不得另建简化路由图、健康响应或错误处理副本。
- `index.ts` 只负责环境初始化和启动组合，Socket、进程信号与优雅退出属于 Server Runtime；Judge WebSocket 必须显式接收 HTTP Server，不得读取进程全局变量。
- HTTP Route Adapter 不得直接写 Prisma、开启事务、操作文件系统或调用 Judge Runtime。
- 跨领域状态变化必须通过对方公开的 Application Service/Port，禁止直接更新对方聚合表。
- 新请求和响应 DTO 优先定义在 `packages/contracts`，运行时 Schema 与 TypeScript 类型必须来自同一来源。
- 账号、平台和组织 API Client 作用域显式分离；账号级请求不得携带组织头。
- 新增 Endpoint 必须声明认证策略和资源权限，公开接口必须进入匿名端点清单并说明暴露理由。

## 核心事实源

- 发布后的 TestSet Revision 不可变；活动固定 Revision，题库新版本不得传播到既有活动。
- Judge 执行配置只能由 Revision/Test Graph 单向投影，不允许 YAML 反向覆盖关系图。
- 重测创建新的 JudgeRun；Submission 是用户提交意图，JudgeAttempt 是物理执行记录。
- 新 Assignment 和 TrainingSession 不得写入旧 `Training(type=homework|training)`。
- 新 Contest 能力必须通过 Contest Facade/Command 边界；不得新增直接依赖旧 Training 比赛事实的路径。
- Posted Ledger、不可变内容版本、举报证据和历史 Revision 不得原地修改或删除。

## 浏览器与展示

- 浏览器认证只使用 HttpOnly Cookie，不在 JavaScript 存储或返回 Bearer Token。
- 普通产品界面不得把 raw UUID、CAS、Revision、Snapshot 或内部 Enum 当作主要文案。
- 数据库历史字段可以保留 `campus`，但新 Application Contract 使用 `organization`；禁止扩大历史术语。
- 业务页面使用统一 UI、Dialog 和 SubmissionCodeEditor，不重新实现通用按钮、遮罩或提交编辑器。

## 运行与发布

- 公网应用入口只能是 Nginx 的 80/443；Web、API slot、Judge 服务和 canary 只监听 loopback 或受控内部网络。
- `/api/health` 只表达进程存活，`/api/readiness` 表达关键依赖，领域一致性进入受保护诊断与周期监控。
- 蓝绿切换、数据库迁移、Revision 发布和经济账本必须使用现有 CAS、advisory lock、fencing 或幂等边界。
- 架构债基线只能下降；任何新增例外都必须先更新本页、对应领域文档和自动门禁，不能只扩大白名单。

## 保留的架构决定

- 保持模块化单体 Server 与独立 Judge Runtime，不因代码规模直接拆微服务。
- 保留 `Submission → JudgeRun → JudgeAttempt`、不可变 TestSet Revision、独立 Assignment/TrainingSession、Carits 与 Evaluation Credits 分域、Chat 持久事件补偿和 BlobStore Port。
- 扩容优先完成真实对象存储恢复演练和 Judge 主机隔离，不重写已经稳定的业务状态机。

相关说明：[系统总览](SYSTEM_OVERVIEW.md)、[认证与权限](AUTHORIZATION.md)、[数据模型](DATA_MODEL.md)、[Judge 领域](JUDGE_DOMAIN.md)。
