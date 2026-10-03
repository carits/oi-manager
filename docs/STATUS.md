---
status: current
audience: development, operations
last_verified: 2026-10-03
source_of_truth: package.json, deploy/systemd/*.service, deploy/systemd/*.timer, docker-compose.yml, Prisma schema, Playwright configuration
---

## 2026-10-03 训练阶段规划改为渐进决策

- 新训练只创建一个初始阶段；课堂运行中最多准备一个下一阶段，阶段结束后由教师选择继续、使用/修改/丢弃下一阶段、临时准备新阶段或结束训练。
- 历史多阶段训练不删除数据，按原队列继续运行并禁止扩展；学生端看不到待运行阶段。无 Prisma 迁移。
- 验收通过：训练服务端 24/24、Web 单元测试 402/402、训练浏览器主流程 18 项同轮通过及分组专项 7/7；架构边界、数据库基线与全仓生产构建通过。文档认证审计仍仅受主干既有的 9 个 Rating 路由显式策略缺口阻断。

## 2026-10-01 HTTPS 证书恢复

- 线上 `carits.top` / `www.carits.top` 的 Let’s Encrypt 证书已通过 ACME webroot 重新签发，当前有效期至 2026-12-29；Nginx `:80` 对正式域名返回 308 并保留 ACME challenge，`:443` 正常反代 Web/API。
- 已安装 `certbot.timer`，并配置 `/etc/letsencrypt/renewal-hooks/deploy/oi-manager-nginx-reload.sh`：续期后先执行 `nginx -t`，再 reload Nginx。仓库提供 `pnpm tls:renewal:install` 用于在新机器恢复这套机制。
- 真实公网验收：`https://www.carits.top/login` 与 `https://www.carits.top/api/health` 均返回 200；本次未修改业务数据或应用业务代码。
- GitHub 外部探针默认目标已改为 `https://www.carits.top`，使证书错误能够被公开 HTTPS 检查直接发现；工作流是否启用仍以 GitHub 运行记录为准。

## 2026-09-28 开发文档审计完成

- 当前开发/运维文档已按 Contest-only、Stable/Evolving 双槽、CurrentJudgeRun 和 Prisma 199 模型重新核对。
- 当前入口文档中的主要英文说明已翻译为中文；命令、路径、环境变量、协议名和代码标识保留英文以避免执行歧义。
- 历史静态审计与旧运维报告保持可追溯，但已标为 `reference` 或加历史警告，不再作为当前完成度依据。详情见 [开发文档审计记录](development/DOCUMENTATION_AUDIT_2026-09-28.md)。

## 2026-09-28 UI Shell 与工作区统一已发布

- 认证应用已统一为根级 `RoleShell -> AppShell`；个人、组织和账号模块不再重建外壳，组织 layout 只保留访问边界。
- 日常工作区切换使用“dirty 确认 → 目标 `/auth/me` 权威预检 → 缓存隔离 → 软路由”，并增加切换 generation、
  组织事件来源校验和预检后的二次 dirty 检查，避免迟到响应跨组织生效或慢请求期间的新编辑丢失。
- 桌面/平板导航只保留 232px 完整侧栏或完整抽屉；旧 localStorage 侧栏偏好可一次迁移到 SSR Cookie，
  不恢复 72px compact rail。
- 发布代码提交 `f04b0aa50adb8b0dfe95310f179378db25a1ac4a`。Web 53 文件/279 项测试、TypeScript、production build、
  UI state、architecture、routes、docs 门禁通过；BUILD_ID `TPv-g5acV9SKdg2qySdoI` 的 canary 与正式消息闭环
  分别通过序号 368/369 和 370/371。API readiness 与线上页面正常，本批无数据库迁移或业务数据修改。

## 2026-09-28 TestSet 双槽模型代码侧收口

- TestSet Revision 业务模型、revisionId、latest 指针和历史版本接口已删除；每题只保留 STABLE 与可选 EVOLVING 两个当前槽，槽内容继续引用 TestdataObject。
- Problem + Slot 使用持久化写优先读写屏障：Writer 排队即关门，阻止新 Reader，等待既有 Judge/Contest 等 Reader 释放后原子替换并递增 fencing token。
- Contest 全程持有 Stable Reader；Training 每次提交选择当时 Evolving（缺失时回退 Stable）；Assignment 每次提交动态使用 Stable，不再固定数据版本。
- Hack、贡献、Selector 串行写 Evolving；Promotion 验证捕获的临时快照后排队替换 Stable，临时目录不进入业务模型，Evolving 可在验证期间继续前进。
- Prisma validate/generate、Contracts/Shared/Server/Web production build 已通过；双槽核心 8/8、API/并发 47/47、Contest/Training/Assignment/Hack/Quality/Solution 58/58 通过。当前仅为远端开发分支验证，尚未迁移或部署线上数据库。

## 2026-09-25 Contest / Training V2 边界收口

- Contest 外部 API 已统一为 `/api/contests/*`；Training Engine V2 保持 `/api/training-sessions/*`，两者无路由兼容层。
- 旧 TrainingSession V1 数据与运行快照已清理，数据库当前 TrainingSession/Stage/Participant/StageGroup 均为 0，等待通过 V2 创建新训练。


# 当前状态

## 2026-09-30 统一题目引用交互已发布

- `feature/unified-problem-reference` 将比赛、作业、训练创建/设计/运行期追加和题单的“按题号选题”统一为 VJudge 式交互：平台 + 题号自动本地解析、题名链接回显、显式添加，批量录入降为辅助入口。
- 共享 resolver 继续只按 canonical `platform + problemId` 精确查当前可访问题库；不读 `ojBindings`、不猜内部 UUID、不从外部 OJ 拉题。Selection Contract 同步由 `problemCode` 收口为 `problemId`。
- 旧 `QuickProblemInput` 已退役；题单待保存行只持有解析后的 canonical Problem，避免业务页面维护第二套识别状态。
- 本批无 Prisma、Schema、Migration 或生产业务数据修改。最终提交 `66d36215787741a10dea8356aede8ffd200a0da1` 已合并 `main` 并发布：Server 精确检索和题单 71/71、比赛与作业 21/21、Web 58 文件 387/387、组件浏览器 63/63、真实训练页面 10/10，以及 Contracts、Server、Web、Judge 构建和 docs/architecture 门禁通过。Training Engine 运行期题目身份回归 19/19、统一选题 Feature 8/8 通过；API 蓝绿切换至 3302，Web BUILD_ID 为 `DWgLUyI6U8yoApTMjnJmW`，canary 与正式消息闭环探针均通过。


## 2026-09-28 题目身份与保存完整性

- 题目创建、编辑、本地精确检索、题单身份校验和比赛题目保存已按显式主身份与保守恢复策略收口。
- Carits 题号由服务端分配；外部题必须显式提供主平台和题号；附加绑定不再隐式决定主身份。
- 本批不修改 Prisma schema 或业务数据。服务端整批事务保存、持久化幂等和历史数据治理仍属于后续独立阶段，不将前端基线保护误记为事务完成。
- 当前分支 Web 56 文件/374 项、Server 题目相关 3 文件/30 项及编辑契约定向测试通过；根生产构建、文档/架构/路由/UI 门禁通过。


## 2026-09-27 Training Engine V2 product usability closure

- 训练快速创建补齐逐题必做/选做，模拟测试保持全题必做；顺序开放的常用条件改为课堂语言，ANY/ALL 组合规则仅在高级设置中出现。
- 教练看板返回学员当前实际 Plan；训练报告按全局 Stage 展示各组人数、完成学员和计划要求完成量，换组记录带实际生效 Stage。
- 拆组支持“立即 / 下一阶段”两种生效方式；下一阶段拆组复用待生效换组事务，目标 Stage 开始前不改变学员归属。
- 验证通过：Training 领域 19/19、API Contract 37/37、Web 产品化静态测试 23/23，Contracts/Server/Web TypeScript、Server/Web production build、docs/architecture 门禁全部通过；本条仅记录代码侧收口，不表示已部署。


## 2026-09-27 Training Engine global Stage rollout

- Commit `e9d39528` is on `main` and deployed. TrainingSession now has one global current Stage; stable Groups select the default Stage plan or an optional override and no longer own independent runtime state.
- Migration `20260927_training_global_stage_model` was applied after a verified 28 MiB backup. The production consistency check reports 0 errors; inventory is 1 DRAFT Session, 3 PENDING Stages, 1 stable Group, 3 default Stage plans, and no StageProblem, Progress, or RuntimeSnapshot records.
- API is active on slot 3303. Web BUILD_ID `lEqLwt4Uqoz-KjzESqIO5` passed canary and production chat probes (message seq 356-359). Router, API, Worker, Executor, Judge, and Web are active; readiness is healthy.

- 架构迁移的机器可读事实源为 [architecture-progress.json](architecture-progress.json)；数字由 `pnpm architecture:progress` 生成，不在本文件手工重复维护。
- 当前公网仍为 HTTP；生产 HTTPS、Secure Cookie、CSP、HSTS 和外部 HTTPS 探针以机器状态中的五项证据为准。
- 本文件只保留最近五次 rollout。完整历史见 [2026-09 归档](archive/history/STATUS-2026-09.md) 与既有 archive 文档。

## 2026-09-27 Problem / Solution Contract rollout

- 发布提交 9be24325 完成 Problem / Solution JSON Contract 与 Feature API 收口：共享契约边界 210，旧页面 transport 0/0，Feature 内直接 transport 3 文件/44 调用。
- Contracts、Server/Web TypeScript、Server/Judge/Web production build、定向领域回归和文档/架构门禁通过；本批无数据库结构或业务数据迁移。
- API 已从 3302 提升至 3303；Web BUILD_ID mGP5AF9MPpbpNfsPHJavD 通过 canary 与正式消息闭环（序号 348–351）。Router、API、Web、Worker、Executor、Judge 均 active，readiness 正常。

## 最近 rollout

- 2026-09-26: Training Engine V2 单一模型完成代码与生产 schema 收口。Participant 必须属于稳定 Group，Stage 只保存教学元数据，StageGroup 是 Group × Stage 的唯一配置/运行事实；删除 currentStage、Stage 运行镜像及 legacy assignment/GroupChange。迁移前 PostgreSQL 16 备份 28 MiB，12 条 Stage assignment 无歧义回填；迁移后 Prisma diff 为 0、consistency 为 0 error。8/8 核心领域测试、相关迁移/规则/API 测试、17 项 Web Feature Contract、Contracts/Prisma/Server/Web 类型检查与 Server/Web production build 均通过。
- 2026-09-23: Training Engine 阶段驱动最终验收在 `codex/training-stage-driven-complete` 完成。修复草稿保存与 SSE/自动保存并发造成的 revision 409，提交前保存现在串行化；补齐训练 Contract 可空字段、分组换组上下文、Assignment 组织边界和阶段运行时默认值。隔离 PostgreSQL `e2e` schema 的 Playwright A–F 为 14/14，Contracts/Shared/Prisma/Server/Web 构建通过；一致性、盘点、基准、API Contract、架构和 UI 状态门禁按本轮命令复核。待完成主分支合并与候选部署验收。
- 2026-09-22: full-project usability hardening 代码侧继续收口（分支 `codex/full-project-usability-hardening`，尚未部署）。Training Workspace 权限求值改为一次加载 Participant/Override/Progress 后批量计算全部 StageProblem，消除逐题重复加载 Session/Progress 的 N+1；同时修复 `SCHEDULED` / `PAUSED` 早退导致未来 Stage 元数据可能绕过脱敏的问题。TEAM Runtime Command 由当前 Session `teamId` 规范化，修复前端“当前团队”目标永远禁用；训练报告增加学员明细 CSV 与完整 JSON 导出。Server 72 个 route 文件完成静态 `route :param` / `req.params` 一致性扫描，除已修复的 Training design-problem 参数错配外未发现同类问题。删除 17 个已废弃或基于旧 School/Teacher/Student/直接数据库写入的一次性修复、造数和迁移脚本，并修复 `CLAUDE.md` 与组织迁移文档对已不存在脚本的引用。新增相应 Training Server 回归用例定义。按本轮明确约束，**未实际执行 Server/Web/Playwright 测试、未执行 Prisma migration、未做迁移演练、未部署**；这些项目必须在后续验证批次单独完成并记录。

- 2026-09-19: Training Engine Stage 驱动代码侧收口完成：移除 Session 级 Group、participant.groupId、productMode、新写入 StageMode 与 BACK_STAGE；新增 StageGroup、ParticipantAssignment、ProblemPlan、RuntimeSnapshot、GroupChange、TimeAdjustment 和 OI scoreGoal 快照。人工与 Scheduler 的开始、推进、跳过和结束现在共用同一锁/CAS 事务；设计器冻结已开始 Stage、允许继续编排未来 Stage，运行台补齐提前结束、跳过、下一 Stage 预换组、任意延时、复制已运行 Stage 为未来 Stage 和换组报告。新增基于前序完成度/分数/尝试/有效时间的可解释分组建议，教师确认前不写入。Training JSON 路由接入共享 Runtime Contract，Training UI/Model 直连传输清零；全站 Feature UI/Model 直连由 218 降至 179。Contracts、Server/Web TypeScript、Server/Web 生产构建、Web 43 文件/191 项测试和文档/架构门禁通过；Server 新增生命周期与动态分组集成用例。按当前指令未搭建 PostgreSQL，Server 数据库测试因 `localhost:5432` 不可用而无法执行，迁移集成和隔离双角色 Playwright 未执行；当前未部署。

- 2026-09-19: AppShell 双形态响应式导航完成初始代码收口：`>=1100px` 使用 232px 完整侧栏，`<1100px` 使用完整抽屉，并删除 72px rail。该条记录的是当时的分支验证；最终合并、补充竞态防护与生产发布证据见本文件 2026-09-28 UI Shell 条目。

- 2026-09-18: 修复普通账号进入组织工作区时被 SSR `RoleLayout` 重定向回 `/identity` 的核心回归。RootLayout 与组织 Layout 现在以路由 Organization ID 调用上下文感知的 `getServerSession(organizationId)`，SSR `/api/auth/me` 显式携带 `X-OI-Organization-ID`；组织授权严格读取 `organizationRole`，不通过放宽全局 `user` 白名单绕过。隔离 E2E 增加第二学校和规范 Membership Role，Chromium 完整权限文件 19/19 通过，直接覆盖个人→组织 A→组织 B→个人和无效组织会话保持；同步修复规范 Contest 测试种子和错误密码提示。Web 42 个测试文件 186 项、类型检查、本地/生产构建及文档门禁通过；提交 `dfed3f3` 至 `f8a68bb` 已推送 `main`，最终 Web BUILD_ID `RreXTH0VxBR6iOJpaWynx` 经 canary、正式消息闭环（序号 298–301）和生产 SSR 探针后上线。生产业务数据未为测试修改，本批无数据库结构或 Server 运行时代码变更。

- 2026-09-18: Frontend Feature Slice 与统一 API Contract Layer 第二十六至三十批完成并上线。题目编辑器文件/OJ/Hack、Judge 设置/Test Graph 文件操作、题单/笔记，以及数据质量 DQS/PQS、专家审核和 Reference Solution Profile 均迁入 Problem Feature API；题单列表不再通过通用 `useResource(URL)` 绕过 Feature 边界。JSON 响应统一使用共享 Runtime Contract 和字段白名单，上传与二进制下载使用机器可审计 Raw Transport Registry。架构门禁现为 28 个 Contract、27 个 Feature Slice、132 条契约边界和 6 条 Raw Transport 登记；P1-02 Feature UI/Model 由 43 文件/242 调用降至 35 文件/218 调用。最新生产同构 `platform-problem-contract` 为 4 文件 44/44，Contracts/Server/Web 构建和文档/架构门禁通过；提交 `40287af`、`998d017`、`f3f053f`、`768aa9c`、`e23f312` 已推送 `main`，API 最终切换至 3302，Web BUILD_ID `RbSbnLHMWcFYYFm7xw1Om` 经 canary 与提升前后双账号消息闭环（序号 274–293）后上线。canary 首次健康检查出现启动抖动超时，复查进程和健康端点、重新完整检查通过后才执行提升。本批无数据库结构或业务数据迁移。

- 2026-09-17: P1-01 旧 Route/Component 直连 API 已完成退出并上线。用户管理列表/详情、平台管理员创建、账号启停与密码重置迁入新增 `user-admin` Feature API，团队 ID 校验和匿名客户端遥测也接入共享 Runtime Contract；删除无调用的旧 `UserManagement` 与 `PlannedFeaturePage`。管理用户响应改为字段白名单，服务端会剥离密码哈希、会话版本及组织内部关联。架构门禁现为 26 个 Contract、27 个 Feature Slice、121 条契约边界，`legacyTransport.files/calls` 均为 `0`；P1-02 Feature UI/Model 仍为 43 文件/242 调用，继续作为下一阶段主债务。生产同构 `identity-contract` 4 文件 36/36、`team-contract` 2 文件 44/44，Contracts/Server/Web 构建和文档/架构门禁通过；提交 `df61522`、`40c8482`、`415ecf9` 已推送 `main`，API 3302→3303，Web BUILD_ID `3z66XyF0b-4DpvWmdl-Su` 经 canary 与提升前后双账号消息闭环（序号 270–273）后上线。本批无数据库结构或业务数据迁移。

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

## Training Engine V3 当前状态

训练模块当前以 TrainingSessionProblem、TrainingSessionRound 和 TrainingRoundProblemAssignment 为唯一模型。创建页为单页，课堂工作区只保留题目调整、聚焦题目、调整分组和下一步；不存在训练模板、旧设计器或兼容接口。迁移采用开发期硬切，发现旧训练场次或旧训练提交时直接终止。

## 历史

- [2026-09 及此前状态流水](archive/history/STATUS-2026-09.md)

### Training Engine V2

已完成 Stage × stable Group 统一模型迁移、StageGroup 独立运行、分组拆分/合并 API、设计器与运行工作台兼容收口。原型 StageGroupPlan/GroupMembership/RuntimeState 表为空并已在迁移中删除；生产数据校验显示 prototype 表 0、V2 结构重复 0、当前 legacy session 不受影响。
