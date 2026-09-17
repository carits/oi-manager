---
status: current
audience: development, operations
last_verified: 2026-09-17
source_of_truth: package.json, deploy/systemd/*.service, deploy/systemd/*.timer, docker-compose.yml, Prisma schema, Playwright configuration
---

# 当前状态

- 架构迁移的机器可读事实源为 [architecture-progress.json](architecture-progress.json)；数字由 `pnpm architecture:progress` 生成，不在本文件手工重复维护。
- 当前公网仍为 HTTP；生产 HTTPS、Secure Cookie、CSP、HSTS 和外部 HTTPS 探针以机器状态中的五项证据为准。
- 本文件只保留最近五次 rollout。完整历史见 [2026-09 归档](archive/history/STATUS-2026-09.md) 与既有 archive 文档。

## 最近 rollout

- 2026-09-17: Frontend Feature Slice 与统一 API Contract Layer 第二十五批完成并上线。超级管理员学校列表、目录治理、学校详情、学生/教师分页、直接创建、资料编辑、负责人创建/转移，以及组织创建申请列表、详情与审批，统一进入新增的 `platform-organization` Feature API；对应 Server 路由使用共享 Organization Runtime Contract 校验查询、写入和成功响应，四个 App 页面不再直接调用传输层，学校列表也退出旧 `useSchools/useList` 间接裸传输。首轮生产同构测试准确发现审批结果不含列表专用 Applicant 关联，已拆分响应 Schema 并复跑通过。门禁现为 25 个 Feature Slice、117 条契约边界，旧 Route/Component 直连由 13 文件/26 调用降至 9 文件/12 调用。生产同构组织测试 4 文件 41/41、Contracts/Server/Web 构建和文档/架构门禁通过；提交 `cdaab85`、`56ce753` 已推送 `main`，API 3303→3302，Web BUILD_ID `zSnaXqkcQ0vgiTUODBPq1` 经 canary 和正式双账号消息闭环（序号 266–269）后提升。本批无数据库结构或业务数据迁移。

- 2026-09-17: Frontend Feature Slice 与统一 API Contract Layer 第二十四批完成并上线。组织学生列表、创建、编辑、启停、移出和主教练转移统一进入 Organization Feature API；学生页面不再依赖通用 `useList/useDelete` 的隐式裸传输。迁移同时修复主教练选择此前发送教师 Profile ID、而服务端要求 Membership ID 的身份错配。旧 Route/Component 直连由 14 文件/31 调用降至 13 文件/26 调用。生产同构组织测试 4 文件 41/41、Server/Web 构建及文档/架构门禁通过；提交 `f61846d` 已推送 `main`，API 3302→3303，Web BUILD_ID `9LVMLCl3FfY_nLh20BM4B` 经 canary 和正式双账号消息闭环（序号 262–265）后提升。本批无数据库结构或业务数据迁移。

- 2026-09-17: Frontend Feature Slice 与统一 API Contract Layer 第二十三批完成并上线。组织教师列表、创建、编辑、启停、移出和学校负责人转移统一进入 Organization Feature API；Server 对六类请求/响应执行共享 Runtime Contract，页面删除 endpoint 拼接和 `ApiResponse` 分支。旧 Route/Component 直连由 15 文件/37 调用降至 14 文件/31 调用，Feature UI/Model 保持 43 文件/242 调用。生产同构组织测试 4 文件 41/41、Contracts/Server/Web 构建及架构门禁通过；提交 `5124853` 已推送 `main`，API 3303→3302，Web BUILD_ID `f50UP_4UltYhbw5x3llwN` 经 canary 和正式双账号消息闭环（序号 258–261）后提升。本批无数据库结构或业务数据迁移。

- 2026-09-17: Frontend Feature Slice 与统一 API Contract Layer 第二十二批完成并上线。组织校园资料读取、学校资料编辑、校园公告保存及管理页加入/邀请待办计数全部改由 `features/organization-account` 调用共享 Organization Runtime Contract；页面不再混用旧 `ApiResponse` 包装与 Contract 已解析数据，删除失效的 endpoint 透传参数。旧 Route/Component 直连由 19 文件/42 调用降至 15 文件/37 调用，Feature UI/Model 仍为 43 文件/242 调用；Contracts/Server/Web 构建、文档与架构门禁通过，生产同构组织测试 4 文件 41/41。提交 `ed804bd` 已推送 `main`；API 3302→3303，Web BUILD_ID `_rH9vqUWWgwsUD_yICUXq` 经 canary 和正式双账号消息闭环（序号 254–257）后提升，六项服务 active，readiness 正常。本批无数据库结构或业务数据迁移。

- 2026-09-16: P1 远端 OJ 代码归档已正式退役。生产迁移前完成 34 MiB 备份及恢复审计，复核 68 条归档提交与 26 条归档题均无 JudgeRun、比赛、训练、作业、Blog 或题解引用；迁移后两类记录为 0、`UserArchivedProblem` 表已删除、数据库 CHECK 禁止 `submitMethod=archive` 回流。Codeforces/洛谷历史同步、归档题 CRUD、源码回抓、定时抓取及 Judge/排名/Rating 特判全部删除，旧接口在线返回 404；2,469 条正常远程 ID 记录、账号绑定、远程提交和结果轮询保持不变。Submission 成为第 25 个 Runtime Contract，生产同构隔离测试 3 文件 54/54；API 3303→3302，Web BUILD_ID `_hmy7gvp9tYj4lAyMPD5a` 经 canary/正式双账号消息闭环（序号 250–253）后提升。远端代码归档退出条件已满足，P1-01～P1-04、Judge 兼容列和外部运维项继续按机器状态燃尽。

- 2026-09-16: 架构迁移进度已产品化为仓库 telemetry。新增自动生成的 `architecture-progress.json`、跨提交单调门禁、Top Debt 任务排序、compact diff 和 GitHub Job Summary；CI 在 PR、main push 和每日定时执行。当前机器状态为 Contract 24、Feature Slice 24、边界 111，旧页面 transport 19 文件/42 调用、Feature UI/Model 44 文件/244 调用、Contest runtime 兼容点 4、生产 HTTPS 证据 0/5。`STATUS.md` 从 561 行缩减为当前说明与最近五次 rollout，旧流水移入 `docs/archive/history/STATUS-2026-09.md`；`AGENTS.md` 固化选择批次、验证和退出条件。学生选择器同时迁入 Organization Feature 并接入 Student/Team Runtime Contract；生产同构组织测试 4 文件 40/40、状态过期/指标反弹反向验证和文档门禁通过。提交 `11d4461`、`0ef9f65`、`67a0bd2` 已推送；API 3302→3303，Web BUILD_ID `6s6HJjDUEg29eJxSLwH7e` 经 canary/正式消息闭环（序号 246–249）后提升。

- 2026-09-16: Frontend Feature Slice 与统一 API Contract Layer 第二十一批完成并上线。学校加入申请、成员邀请、加入策略、校园摘要和教师选择接口统一纳入 Organization Runtime Contract；管理页面迁入 `features/organization-account/ui`，教师管理 Route 只装配 Feature 公共入口。首轮生产同构回归发现审批请求被契约错误要求携带可选关系资料，已修正为保持既有业务语义并复跑组织契约 4 文件 40/40。Contracts/Server/Web 构建及 UI/路由/架构门禁通过；门禁现为 24 个 Contract 文件、24 个 Feature Slice、111 条契约边界，旧 Route/Component 直连降至 20 文件 45 调用，Feature UI/Model 遗留为 44 文件 244 调用。提交 `030ef60`、`24c3771` 已推送 `main`；API 当前为 3302，Web BUILD_ID `VaZGDHIeY_4fpHA3mbW_8` 经 canary 与正式双账号消息闭环（序号 242–245）后提升。本批无数据库结构或业务数据迁移。

- 2026-09-16: Frontend Feature Slice 与统一 API Contract Layer 第十九、二十批完成并上线。平台题库管理/OJ Fetcher 与 OJ 账号管理页面迁入 `features/problem`、`features/oj-account`，App Route 只装配 Feature 公共入口；新增两组 Runtime Contract，Server/Web 共用列表、配置、归档、验证、登录和批量操作 Schema，OJ 账号响应会剥离密码、Cookie 等敏感字段，同时保留既有业务错误状态码。OJ 账号生产同构 2 文件 39/39、Web 生产构建及 UI/导航/架构/文档门禁通过。门禁现为 24 个 Contract 文件、24 个 Feature Slice、107 条契约边界；旧 Route/Component 直连降至 21 文件 55 调用，Feature UI/Model 遗留为 44 文件 244 调用。提交 `41f8bad`、`3f3a29a`、`70a9e48` 已推送 `main`；API 当前为 3303，Web BUILD_ID `shX6h3nZyqic2J1rvt0Ba` 完成 canary/正式消息闭环（序号 238–241）。本批无数据库结构或业务数据迁移。

- 2026-09-16: Frontend Feature Slice / API Contract 迁移增加单调收敛门禁。首次把尚未迁移完的直连显式登记为两类债务：旧 Route/Component 23 文件 74 调用、Feature UI/Model 45 文件 244 调用；任何新直连或调用数增加现在阻断架构门禁，白名单只能随迁移减少。Auth 头像 multipart 上传率先从 UI 移至 Feature API，Feature 越层文件降至 44，并新增上传响应 Contract，服务端只返回公开 avatar/fileId。生产同构 Auth/Contract/Admin 3 文件 72/72 与三端构建通过；提交 `269b113` 已推送 `main`，API 3302→3303，Web BUILD_ID `k_B5bg5dj0lLEe-RK-0XG` 经 canary/正式消息闭环（序号 230–233）后提升。该数字是后续收口的公开燃尽基线，不再以“已有 Slice 目录”代替完成状态。

- 2026-09-16: Frontend Feature Slice 与统一 API Contract Layer 第十七批完成并上线。平台 DeepSeek Token 总池、不可变调整流水与 Candidate Evaluation Budget 统一迁入 `features/ai-governance/{api,ui}`，Route 仅保留 Feature 公共入口；新增 AI Governance Runtime Contract，Server/Web 共同校验 Token Pool、流水、评估预算和额度调整。修复调整接口直接返回 Prisma `BigInt` 可能触发 JSON 序列化 500 的缺陷，并为幂等键复用不同调整内容增加 409 fail-closed；页面新增首屏骨架、失败重试、刷新保留数据、空流水和窄屏表格。生产同构 `ai-governance-contract` 4 文件 42/42、Web 40 文件 181 项、Contracts/Server/Web 构建及 UI/导航/架构门禁通过；门禁提升为 22 个 Contract 文件、23 个 Feature Slice、98 条契约边界且 0 违规。提交 `823194e`、`5c48716` 已推送 `main`；API 3303→3302，Web BUILD_ID `yHRqSBrdFmLsQOXHiXKFc` 经 canary 与正式双账号消息闭环（序号 226–229）后提升。本批无 Prisma 或业务数据迁移。

## 历史

- [2026-09 及此前状态流水](archive/history/STATUS-2026-09.md)
