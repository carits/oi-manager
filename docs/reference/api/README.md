---
status: reference
audience: development, testing
last_verified: 2026-09-14
source_of_truth: apps/server/src/modules, packages/contracts/src, scripts/generate-architecture-inventory.mjs
---

# HTTP 接口清单

本清单由服务端路由扫描生成。校园业务必须带组织 URL 与有效成员关系；旧学生、教师、学校端点仅作为退役入口，不再承载业务。

共享 Contract 已成为新接口的唯一 DTO 边界。`packages/contracts` 同时声明 HTTP 方法、作用域、请求/查询和成功响应
Runtime Schema；Server Adapter 在调用 Application Service 前后校验，Web Feature API 在发送请求和消费成功响应时再次校验。
当前已完成 Auth/Health/Identity，以及 Assignment 进度与人工完成、Blog Discovery、Contest Rating、Solution Review
相似度和 Training 设计/校验/保存的端到端接入。后续端点只能扩展这一目录和门禁，不得另建 Shared interface
或页面私有响应类型作为事实源。Training 结构保存成功响应固定为重新读取后的 Design DTO，而非内部 Session 记录。

`pnpm api:auth-audit` 会把本清单中的全部端点与 Express 路由声明、路由挂载认证和
`scripts/api-public-endpoints.json` 对照。当前 614 个端点中 600 个必须认证，14 个允许匿名访问；
任何新增匿名端点都必须登记最小公开理由，否则 `pnpm docs:check` 失败。该门禁只证明认证边界，
本人、同组织、跨组织及各管理员的资源级授权继续由权限矩阵测试证明。

列表上下文与通知一致性约定：团队关联的比赛、训练和题单统一使用 `teamId` 查询参数，并由服务端重新校验当前用户的团队关系；教师读取团队管理邀请时必须同时提供当前 `organizationId`，避免跨学校聚合。通知列表使用真实游标分页，读取接口返回权威 `unreadCount`；客户端不得通过本地减一推断未读数，超过首批 50 条时必须继续分页。
`pnpm api:anonymous-audit` 会向运行中的 API 实际发送 614 个无会话请求：600 个受保护端点必须返回
401，14 个公开端点必须返回非鉴权、非 5xx 响应。参数统一替换为不存在的审计 ID，写请求使用空对象，
用于验证认证中间件必须先于业务写入执行。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/data-products` | 读取当前 ACTIVE 数据商品及公开质量证书，不返回隐藏证据或测试数据 |
| `GET` | `/api/data-products/:id` | 读取指定商品证书；已停售商品仍保留历史状态但不能购买 |
| `POST` | `/api/problems/:problemId/data-products` | 题目管理员绑定 Revision 与质量快照发布商品；服务端自动定级定价 |
| `POST` | `/api/data-products/:id/purchase` | 以 UUID Idempotency-Key 和服务端价格购买 PERSONAL/ORGANIZATION/CONTEST 许可证 |
| `GET` | `/api/data-purchases` | 读取本人或本人可管理范围内的购买记录 |
| `GET` | `/api/data-entitlements` | 读取本人或本人可管理范围内的固定版本授权 |
| `GET` | `/api/data-entitlements/:id` | 读取授权与追加式 Revision 历史；越权统一返回 404 |
| `GET` | `/api/data-entitlements/:id/revisions/:revisionId/manifest` | 按 includes 返回安全数据清单与受控对象链接 |
| `GET` | `/api/data-entitlements/:id/revisions/:revisionId/objects/:objectId` | 重验授权、Revision 与对象归属后流式下载单个对象 |
| `POST` | `/api/data-entitlements/:id/upgrades` | 按商品更新策略追加同题新 Revision 授权 |
| `POST` | `/api/test-set-quality-incidents` | 题目管理员登记质量事故；Critical 会自动停售并通知买家 |
| `GET` | `/api/problems/:problemId/test-set-quality-incidents` | 题目管理员读取事故历史 |
| `POST` | `/api/test-set-quality-incidents/:id/confirm` | 确认非 Critical 事故 |
| `POST` | `/api/test-set-quality-incidents/:id/resolve` | 绑定修复 Revision 并向既有授权追加免费修复版本 |
| `POST` | `/api/problems/:problemId/solution-contributions` | 创建题解投稿草稿并固定来源、授权和组织归因 |
| `GET` | `/api/problems/:problemId/solution-contributions/me` | 读取本人对指定题目的投稿 |
| `GET` | `/api/problems/:problemId/solutions` | 按当前发布版本可见性读取题解列表 |
| `GET` | `/api/solution-contributions/:id` | 作者或题目管理员读取投稿、版本、验证与审核历史 |
| `PATCH` | `/api/solution-contributions/:id` | 编辑仍可修改或要求重投的题解草稿 |
| `POST` | `/api/solution-contributions/:id/submit` | 冻结首个投稿 Revision 并发起技术验证 |
| `POST` | `/api/solution-contributions/:id/resubmit` | 要求修改后追加新的不可变投稿 Revision |
| `POST` | `/api/solution-contributions/:id/verification/refresh` | 从 JudgeRun 同步当前投稿 Revision 的技术验证结果 |
| `GET` | `/api/solutions/:solutionId` | 按各版本固化的 visibilityPolicy 返回当前题解和可见历史 |
| `GET` | `/api/solutions/:solutionId/versions/:versionId` | 按指定历史版本自身可见性读取只读内容 |
| `POST` | `/api/solutions/:solutionId/corrections` | 基于当前发布版本创建纠错投稿 |
| `GET` | `/api/review/solution-contributions` | 题目管理员读取可管理投稿审核队列 |
| `POST` | `/api/review/solution-contributions/:id/reviews` | 事务串行写入通过、要求修改或拒绝审核 |
| `POST` | `/api/review/solution-contributions/:id/request-revision` | 要求投稿作者修改并追加重投版本 |
| `POST` | `/api/review/solution-contributions/:id/reject` | 拒绝当前投稿 Revision |
| `POST` | `/api/review/solution-contributions/:id/accept` | 以 expected-status CAS 采纳已验证且审核通过的投稿 |
| `POST` | `/api/review/solution-contributions/:id/publish` | 幂等发布不可变题解版本并生成贡献奖励事件 |
| `POST` | `/api/review/solution-contributions/:id/similarity/retry` | 题目管理员重试失败或补建遗漏的当前投稿相似度任务 |
| `GET` | `/api/review/solution-contributions/:id/similarity-comparison` | 相似度 READY 后由题目审核者读取限长并排匹配片段；每次访问写平台审计 |
| `GET` | `/api/blog-discovery` | 匿名发现 PUBLIC 博客；登录后同时发现 PLATFORM 博客 |
| `GET` | `/api/blog-discovery/:id` | 按 ID 或 slug 读取公开知识文章，不返回不可见版本 |
| `GET` | `/api/blog-discovery/:id/community` | 读取公开文章的安全互动计数；匿名响应为空本人状态，登录态只增加当前账号的反应与收藏 |
| `GET` | `/api/blog-discovery/:id/comments` | 分页读取公开文章评论及首批回复 |
| `GET` | `/api/blog-discovery/:id/comments/:commentId/replies` | 以游标分页读取一层回复 |
| `POST` | `/api/submissions/:id/blog-snapshots` | 提交作者为本人终态提交创建可选源码的脱敏不可变博客快照 |
| `GET` | `/api/blogs/:id/community` | 读取有权访问的已发布博客互动汇总和本人反应/收藏状态 |
| `GET` | `/api/blogs/:id/comments` | 分页读取可见评论及一层回复 |
| `GET` | `/api/blogs/:id/comments/:commentId/replies` | 登录用户按游标分页读取指定顶层评论的一层回复 |
| `POST` | `/api/blogs/:id/comments` | 创建评论或一层回复 |
| `DELETE` | `/api/blogs/:id/comments/:commentId` | 作者或平台治理人员隐藏评论 |
| `PUT` | `/api/blogs/:id/reactions/:type` | 幂等设置 LIKE/HELPFUL 反应 |
| `DELETE` | `/api/blogs/:id/reactions/:type` | 幂等取消 LIKE/HELPFUL 反应 |
| `PUT` | `/api/blogs/:id/bookmark` | 幂等设置账号收藏 |
| `DELETE` | `/api/blogs/:id/bookmark` | 幂等取消账号收藏 |
| `POST` | `/api/blogs/:id/reports` | 举报文章或评论并固化证据摘要 |
| `GET` | `/api/platform/blog-reports` | 平台治理人员分页读取举报摘要，不返回证据正文 |
| `GET` | `/api/platform/blog-reports/:id` | 填写原因并写平台审计后读取固化证据 |
| `POST` | `/api/platform/blog-reports/:id/decision` | 处理举报并可隐藏评论、暂停或移除文章 |
| `PUT` | `/api/platform/blogs/:id/featured` | 平台治理人员设置或退役社区精选 |
| `GET` | `/api/ratings/me` | 读取本人全部全局/组织 OI、IOI、ACM Rating 账户 |
| `GET` | `/api/ratings/global/:track` | 分页读取指定 Track 的全局 Rating 榜 |
| `GET` | `/api/ratings/organizations/:organizationId/:track` | 有效组织成员读取组织 Rating 榜 |
| `GET` | `/api/ratings/users/:userId/history` | 本人读取指定池和 Track 的不可变 Rating 变化历史 |
| `GET` | `/api/contests/:id/rating-config` | 读取比赛 Rating 范围、Track、权重、最低人数、revision 和冻结状态 |
| `PUT` | `/api/contests/:id/rating-config` | 管理员在比赛开始前按 revision CAS 保存 Rating 配置 |
| `GET` | `/api/contests/:id/rating-participation` | 读取本人本场 Rating 组织归属选项、当前快照和冻结状态 |
| `PUT` | `/api/contests/:id/rating-participation` | 平台 BOTH 比赛参赛者在首次提交前显式选择计入的组织 |
| `GET` | `/api/contests/:id/rating` | 读取比赛最终榜单、Batch 和 Rating 变化 |
| `POST` | `/api/contests/:id/finalize` | 比赛结束且评测完成后生成不可变最终榜单并幂等结算 Rating |
| `POST` | `/api/contests/:id/rating/rebuild` | 赛后重测完成后生成新榜单并从受影响池完整重放 Rating |
| `POST` | `/api/contests/:id/problems/:contestProblemId/final-submission/:submissionId` | OI 比赛结束前指定本题最终提交 |
| `PATCH` | `/api/contests/:id/rating-participants/:userId` | 管理员设置带原因的 Rating 参赛者处置 |
| `GET` | `/api/platform-contests` | 登录用户读取可见的平台比赛；平台/超级管理员同时获得管理信息 |
| `POST` | `/api/platform-contests` | 平台或超级管理员创建可配置 GLOBAL/BOTH Rating 的平台比赛 |
| `GET` | `/api/assignments` | 按校园、团队和状态读取本人可见或可管理的独立作业 |
| `POST` | `/api/assignments` | 教师或负责人创建校园作业草稿 |
| `GET` | `/api/assignments/:id` | 读取按角色裁剪的作业、固定题目版本和本人名单 |
| `GET` | `/api/assignments/:id/workspace` | 读取学生本人或管理者的进度、订正、反馈和成绩快照 |
| `PATCH` | `/api/assignments/:id` | 以 revision CAS 修改 DRAFT 基本信息 |
| `PUT` | `/api/assignments/:id/problems` | 固定题目 TestSet Revision、顺序和评分目标 |
| `PUT` | `/api/assignments/:id/roster` | 保存 DRAFT 学生名单快照 |
| `POST` | `/api/assignments/:id/validate` | 运行发布前结构检查 |
| `POST` | `/api/assignments/:id/publish` | 原子生成名单/进度并冻结作业 |
| `POST` | `/api/assignments/:id/submit` | 按固定 Revision 创建独立作业提交与 JudgeRun |
| `GET` | `/api/assignments/:id/progress` | 管理者读取服务端成绩矩阵 |
| `POST` | `/api/assignments/:id/progress/:progressId/manual-completion` | 管理者按版本 CAS 和必填原因设置或取消人工完成 |
| `POST` | `/api/assignments/:id/corrections` | 原子创建订正事实和事件 |
| `POST` | `/api/assignments/:id/feedback` | 原子创建学生可见或内部反馈 |
| `POST` | `/api/assignments/:id/score-adjustments` | 追加人工调分事实 |
| `POST` | `/api/assignments/:id/score-adjustments/:adjustmentId/reverse` | 追加调分冲正事实 |
| `POST` | `/api/assignments/:id/close` | 手工关闭作业并生成成绩快照 |
| `POST` | `/api/assignments/:id/review` | 进入批改状态 |
| `POST` | `/api/assignments/:id/release` | 发布最终成绩快照 |
| `POST` | `/api/assignments/:id/archive` | 归档已发布成绩的作业 |
| `POST` | `/api/assignments/:id/cancel` | 取消尚未进入终态的作业 |
| `GET` | `/api/chat/privacy` | 读取账号的跨关系完整用户名发现设置 |
| `PATCH` | `/api/chat/privacy` | 修改账号的跨关系完整用户名发现设置 |
| `GET` | `/api/chat/users/search` | 按共享关系模糊搜索或按隐私设置精确搜索账号 |
| `GET` | `/api/chat/friend-requests` | 查询联系申请（内部兼容路径） |
| `POST` | `/api/chat/friend-requests` | 创建联系申请（内部兼容路径） |
| `POST` | `/api/chat/friend-requests/:id/accept` | 接受好友申请 |
| `POST` | `/api/chat/friend-requests/:id/reject` | 拒绝好友申请 |
| `POST` | `/api/chat/friend-requests/:id/cancel` | 撤销好友申请 |
| `GET` | `/api/chat/friends` | 查询好友关系 |
| `DELETE` | `/api/chat/friends/:userId` | 删除好友关系并保留会话历史 |
| `GET` | `/api/chat/blocks` | 查询本人黑名单 |
| `POST` | `/api/chat/blocks/:userId` | 拉黑用户并解除好友关系 |
| `DELETE` | `/api/chat/blocks/:userId` | 解除本人发起的拉黑 |
| `GET` | `/api/chat/conversations` | 按 active/archived 与 opaque cursor 分页查询本人会话；旧数组响应暂时兼容 |
| `POST` | `/api/chat/conversations` | 为现有好友创建或恢复唯一会话 |
| `GET` | `/api/chat/conversations/:id/messages` | 读取最新消息页，或通过 beforeSeq/afterSeq 分页；V2 返回页元数据 |
| `POST` | `/api/chat/conversations/:id/messages` | 幂等发送文字或平台表情消息并重新校验双方账号、联系人、拉黑和表情发布状态 |
| `GET` | `/api/chat/sticker-packs` | 查询当前已发布表情包；没有表情时返回空数组 |
| `GET` | `/api/chat/stickers/:stickerId/content` | 读取不可变表情 WebP |
| `GET` | `/api/chat/stickers/:stickerId/poster` | 读取减少动态效果和审核使用的静态 poster |
| `POST` | `/api/chat/conversations/:id/read` | 单调推进已读序号并修正未读投影 |
| `POST` | `/api/chat/conversations/:id/archive` | 仅为本人归档会话 |
| `POST` | `/api/chat/conversations/:id/unarchive` | 恢复本人归档的会话 |
| `POST` | `/api/chat/conversations/:id/clear` | 仅为本人清空当前历史视图 |
| `GET` | `/api/chat/unread` | 查询私信未读和待处理好友申请数 |
| `GET` | `/api/chat/events` | 账号级持久事件 SSE；支持 `Last-Event-ID` 补偿 |
| `POST` | `/api/chat/reports` | 举报对方消息并固化有限上下文证据 |
| `GET` | `/api/platform/chat-reports` | 管理员查询私信举报摘要 |
| `GET` | `/api/platform/chat-reports/:id` | 填写原因并审计读取举报证据 |
| `POST` | `/api/platform/chat-reports/:id/resolve` | 确认处理举报 |
| `POST` | `/api/platform/chat-reports/:id/dismiss` | 驳回举报 |
| `POST` | `/api/platform/chat-sticker-imports` | 超管上传 ZIP 并获得表情包检查报告及 reportHash |
| `POST` | `/api/platform/chat-sticker-imports/:id/publish` | 超管按 reportHash 原子发布已检查表情包 |
| `GET` | `/api/platform/chat-sticker-packs` | 超管查询全部表情包版本和状态 |
| `POST` | `/api/platform/chat-sticker-packs/:id/retire` | 超管退役表情包，历史消息保持可读 |
| `GET` | `/api/problems/:id/judge-programs` | 列出题目的版本化 STD、Validator、Classifier 与 Generator |
| `GET` | `/api/problems/judge-program-templates` | 返回共享能力矩阵、机器 Schema 和模板摘要；摘要仅含 Fixture/Profile/教学项数量，不含源码、Fixture 或 Generator 配置 |
| `GET` | `/api/problems/judge-program-templates/:templateId` | 返回完整版本化模板包：源码或 DSL、协议、Fixture、Generator Schema/Profile、教学说明和必须修改项 |
| `GET` | `/api/judge-program-templates` | 模板摘要目录的稳定账号级别名，供管理工作台与向导使用 |
| `GET` | `/api/judge-program-templates/:templateId` | 完整模板详情的稳定账号级别名，供预览、复制、下载和草稿初始化使用 |
| `GET` | `/api/problems/:id/judge-program-drafts` | 读取当前管理员按程序类型保存的服务端草稿 |
| `POST` | `/api/problems/:id/judge-program-drafts` | 新建或按程序类型更新带 revision 的服务端草稿 |
| `PATCH` | `/api/problems/:id/judge-program-drafts/:draftId` | 以 expectedRevision 更新指定服务端草稿 |
| `DELETE` | `/api/problems/:id/judge-program-drafts/:draftId` | 删除本人的指定服务端草稿 |
| `GET` | `/api/problems/:id/judge-program-audit-logs` | 题目管理者读取程序生命周期审计摘要 |
| `POST` | `/api/problems/:id/judge-programs` | 创建逻辑程序及首个不可变 draft 版本，不同步编译、不自动激活 |
| `POST` | `/api/problems/:id/judge-programs/:programId/versions` | 追加新的不可变 draft 程序版本 |
| `POST` | `/api/problems/:id/judge-programs/:programId/versions/:versionId/compile` | 创建持久化异步 Judge 编译任务 |
| `POST` | `/api/problems/:id/judge-programs/:programId/versions/:versionId/preflight` | 运行协议 Fixture；Validator 要求正负样例，Generator 检查确定性，Classifier 严格验证 Schema 与 Subtask |
| `GET` | `/api/problems/:id/judge-programs/:programId/versions/:versionId/verification` | 查询编译/预检任务、报告和安全错误 |
| `POST` | `/api/problems/:id/judge-programs/:programId/fixture-sets` | 保存或复用结构化 Fixture Set |
| `GET` | `/api/problems/:id/judge-programs/:programId/fixture-sets` | 查询逻辑程序的 Fixture Set 历史 |
| `PATCH` | `/api/problems/:id/judge-programs/:programId` | 仅激活 verified 版本或归档逻辑程序 |
| `POST` | `/api/problems/:id/data-generation-jobs` | 创建直接输入或 Generator 参数批次 |
| `GET` | `/api/problems/:id/data-generation-jobs` | 列出题目的候选数据生成任务 |
| `GET` | `/api/problems/:id/data-generation-jobs/:jobId` | 读取任务、逐点阶段和内容预览 |
| `POST` | `/api/problems/:id/data-generation-jobs/:jobId/cancel` | 取消尚未完成的数据生成任务 |
| `POST` | `/api/problems/:id/data-generation-jobs/:jobId/promote` | 以 CAS 发布选中候选点到下一 TestSet Revision |
| `POST` | `/api/problems/:id/candidates/data` | 可提交用户贡献直接 Candidate 数据 |
| `POST` | `/api/problems/:id/candidates/generator` | 可提交用户按 `oj.generator/v1` 贡献 C++17/Python3 Generator |
| `GET` | `/api/problems/:id/contribution-readiness` | 返回 STD、Validator、Classifier、Corpus 的统一贡献就绪状态与阻断原因 |
| `GET` | `/api/problems/:id/contributions/mine` | 贡献者读取自己的任务；题目管理者读取本题任务及安全阶段摘要 |
| `GET` | `/api/problems/:id/contributions/:jobId` | 本人或题目管理者读取贡献任务、逐点阶段与 Candidate 子结果 |
| `GET` | `/api/problems/:id/candidates/mine` | 贡献者读取自己的 Candidate 粗粒度阶段与结论 |
| `GET` | `/api/problems/:id/candidates/:candidateId` | 本人或题目管理者读取 Candidate；普通用户不返回 Kill/隐藏 Feature |
| `POST` | `/api/problems/:id/candidates/:candidateId/cancel` | 取消尚未开始评估的自己的 Candidate |
| `GET` | `/api/problems/:id/candidate-pool` | 题目管理者读取有界 Candidate Pool、逐 Subtask readiness、容量、策略和成员替换审计 |
| `PUT` | `/api/problems/:id/candidate-policy` | 题目管理者以 revision CAS 更新 observe/auto 与容量策略 |
| `GET` | `/api/problems/:id/wrong-corpus` | 题目管理者读取私有错误语料的聚类汇总，不返回历史源码 |
| `POST` | `/api/problems/:id/wrong-corpus/rebuild` | 从本地错误/部分分提交幂等重建 bootstrap Corpus |
| `GET` | `/api/problems/:id/quality` | 读取当前 Revision 的 DQS/PQS 质量摘要；普通用户只获得脱敏证书，管理者同时获得历史和任务摘要 |
| `GET` | `/api/problems/:id/test-set-revisions/:revisionId/quality` | 读取指定不可变 Revision 的质量证书；完整 evidence 仅题目管理者可见 |
| `POST` | `/api/problems/:id/quality-evaluation-jobs` | 题目管理者按固定 Revision/Corpus/规则输入幂等触发 DQS 异步评估 |
| `GET` | `/api/problems/:id/quality-evaluation-jobs` | 题目管理者读取质量评估任务状态，不在列表响应暴露完整固定输入 |
| `GET` | `/api/problems/:id/quality-evaluation-jobs/:jobId` | 题目管理者读取单个任务的固定输入、租约终态和质量证书 |
| `GET` | `/api/problems/:id/solution-profiles` | 题目管理者读取 Reference Solution Profiles 及其固定 Revision 评测结果 |
| `POST` | `/api/problems/:id/solution-profiles` | 题目管理者从本题本地终态提交创建带预期总分/Subtask 区间的 Profile，并触发重新评估 |
| `PATCH` | `/api/problems/:id/solution-profiles/:profileId` | 以 `expectedRevision` CAS 更新或停用 Profile；冲突返回 `SOLUTION_PROFILE_STALE` |
| `GET` | `/api/problems/:id/problem-quality-assessments` | 读取 PQS 历史；非管理者响应使用公开字段白名单 |
| `POST` | `/api/problems/:id/problem-quality-assessments/automated` | 题目管理者为当前内容版本生成幂等 PQS 自动评估 |
| `POST` | `/api/problems/:id/problem-quality-assessments/:assessmentId/expert-review` | 仅 platform_admin/super_admin 追加不可覆盖的专家评分和审查意见 |
| `GET` | `/api/problems/:id/selector-runs` | 题目管理者读取 Selector 运行历史 |
| `POST` | `/api/problems/:id/selector-runs/preview` | 对至多 25 个待选 Candidate 执行相对当前正式 Revision 的真实 dry-run，不创建 Selection Run 或 Revision |
| `POST` | `/api/problems/:id/canonical-emergency-publish` | 题目管理者填写原因后紧急发布 Hack Gate Candidate；不能绕过结构、保护、Official Core 或 Revision CAS |
| `GET` | `/api/resources/evaluation-credit-packages` | 读取服务端固定 Carits 兑换套餐 |
| `GET` | `/api/resources/evaluation-credits` | 读取本人免费/已购 Credits、贡献等级、今日使用和预占 |
| `GET` | `/api/resources/evaluation-credit-purchases` | 读取本人资源兑换流水 |
| `POST` | `/api/resources/evaluation-credits/purchase` | 按固定 packageCode 与 Idempotency-Key 用 Carits 兑换长期 Credits |
| `GET` | `/api/platform/contributions` | 超管/平台管理员读取贡献与奖励审计 |
| `GET` | `/api/platform/contributions/:id/evidence` | 超管/平台管理员只读核验贡献绑定的 Candidate 或正式 TestSet Revision；`kind=candidate` 或 `kind=revision`，服务端校验事件、题目与晋升版本关系 |
| `POST` | `/api/platform/contributions/:id/accept` | 超级管理员接受紧急发布的 pending 贡献 |
| `POST` | `/api/platform/contributions/:id/reject` | 超级管理员填写原因并拒绝 pending 贡献 |
| `POST` | `/api/platform/contributions/:id/revoke` | 超级管理员撤销已接受贡献；已发 Carits 通过新冲正交易处理 |
| `POST` | `/api/platform/contributions/:id/retry-reward` | 超级管理员将连续失败的奖励投递审计重入队；仅 `failed` 状态允许 |
| `GET` | `/api/problems/:id/feature-definitions` | 读取题目 Feature 注册表 |
| `PUT` | `/api/problems/:id/feature-definitions` | 保存最多 128 个声明式 Feature |
| `GET` | `/api/problems/:id/subtask-rules` | 读取 OI 声明式 Subtask Rule |
| `PUT` | `/api/problems/:id/subtask-rules` | 保存最多 64 条 Subtask Rule |
| `GET` | `/api/problems/:id/validator-specs` | 题目管理者列出不可变 Validator DSL 版本 |
| `POST` | `/api/problems/:id/validator-specs` | 校验 DSL、生成可信 C++ 并执行真实沙箱编译 |
| `POST` | `/api/problems/:id/validator-specs/:specId/materialize` | 将 DSL 物化为不可变 Validator ProgramVersion；仍需 Judge 编译、预检和显式激活 |
| `POST` | `/api/problems/:id/validator-specs/:specId/activate` | 旧客户端兼容路由；行为同 materialize，不直接激活 |
| `POST` | `/api/problems/:id/ai/validator-spec` | 通过统一 Token 池让 DeepSeek 生成 Validator DSL 草案 |
| `POST` | `/api/problems/:id/ai/validator-spec/:requestId/save` | 审阅后保存 AI DSL 为不可变 Validator Spec |
| `POST` | `/api/problems/:id/ai/validator` | 从官方 Markdown 题面生成并编译 Validator 草案 |
| `GET` | `/api/problems/:id/ai/validator/:requestId` | 读取自己的 Validator 生成请求和真实 Token 用量 |
| `POST` | `/api/problems/:id/ai/validator/:requestId/repair` | 最多两轮关联修复并重新编译 Validator |
| `POST` | `/api/problems/:id/ai/validator/:requestId/save` | 将已审阅草案保存为新的 Validator 程序版本 |
| `GET` | `/api/platform-admin/ai/token-pool` | 平台管理员读取统一 Token 总池 |
| `GET` | `/api/platform-admin/ai/token-usage` | 平台管理员分页读取不可变 Token 流水 |
| `POST` | `/api/platform-admin/ai/token-pool/adjust` | 平台管理员按幂等键充值或人工调整 Token |
| `GET` | `/api/platform-admin/ai/evaluation-budget` | 平台管理员读取 Evaluation Credits、Candidate、Blob 和孤儿对象概览 |
| `GET` | `/api/problems/:id/hack-config` | 题目管理者读取 ACM/OI Hack 配置 |
| `PUT` | `/api/problems/:id/hack-config` | 编译检查并保存 STD、Validator、Classifier 和 Hack 开关 |
| `GET` | `/api/problems/:id/hacks` | 查看自己的 Hack 记录；题目管理者查看全部 |
| `POST` | `/api/problems/:id/hacks` | 以直接数据或生成器发起题目级 Hack；证明程序支持提交级文件 IO |
| `GET` | `/api/problems/:id/hacks/:hackId` | 查看有权限的 Hack 详情 |
| `POST` | `/api/problems/:id/hacks/:hackId/retry` | 题目管理者重新执行系统错误任务 |
| `GET` | `/api/problems/:id/test-graph` | 题目管理者读取规范化 OI 测试图和迁移检查结果 |
| `PUT` | `/api/problems/:id/test-graph` | 校验并保存 Subtask/Group/Testcase 测试图 |
| `POST` | `/api/problems/:id/test-graph/testcases` | 将当前题目的输入与答案文件配对注册为稳定 Testcase |
| `PATCH` | `/api/problems/:id/test-graph/testcases/:testcaseId/protection` | 题目管理者填写原因后永久保护测试点；写入平台审计 |
| `GET` | `/api/problems/:id/test-set-revisions` | 题目管理者列出正式测试版本历史 |
| `GET` | `/api/problems/:id/test-set-revisions/:revisionId` | 读取单个不可变 Revision 和只读 Judge 投影 |
| `POST` | `/api/problems/:id/judge-mode-transition` | 显式创建 ACM/OI 模式转换 Revision 并关闭 Hack |
| `GET` | `/api/contests/:id/problems/:contestProblemId/test-set-update` | 活动管理员比较固定 Revision 与题库最新版及冻结状态 |
| `POST` | `/api/contests/:id/problems/:contestProblemId/test-set-update` | 仅在未开始且无提交时手动固定到指定 Revision |
| `GET` | `/api/readiness` | 蓝绿 API 候选的关键依赖 readiness；只检查数据库，Revision 投影一致性由独立运维诊断检查 |
| `DELETE` | `/api/problems/:id/statement-versions/:versionId` | 软删除自己的题面版本 |
| `GET` | `/api/problems/:id/statement-versions` | 列出官方、我的和公开题面版本 |
| `GET` | `/api/problems/:id/statement-versions/:versionId` | 读取可访问的个人题面版本 |
| `GET` | `/api/problems/:id/statement-versions/:versionId/file` | 读取个人 PDF 题面 |

Hack 列表接口仅返回状态、前后 Verdict、失败阶段等摘要字段。候选输入、生成器源码和被 Hack
程序只由单条详情接口返回，并继续执行“本人或题目管理者”权限校验。活动任务冲突时重新执行接口
返回 `409 HACK_ALREADY_ACTIVE`。
| `GET` | `/api/contests/:id/problems/:contestProblemId/statements` | 读取活动当前可见题面快照集合 |
| `GET` | `/api/contests/:id/problems/:contestProblemId/statement/file` | 读取活动 PDF 题面快照 |
| `GET` | `/api/contests/:id/statement-management` | 读取活动多题面管理矩阵 |
| `PATCH` | `/api/problems/:id/statement-versions/:versionId` | 重命名或切换个人题面可见性 |
| `POST` | `/api/problems/:id/statement-versions` | 从官方、用户版本或空白创建独立题面 |
| `POST` | `/api/problems/:id/statement-versions/:versionId/pdf` | 上传或替换个人 PDF 题面 |
| `POST` | `/api/contests/:id/problems/:contestProblemId/content/:kind/pdf` | 管理员替换活动 PDF 并创建新 revision |
| `PUT` | `/api/problems/:id/statement-versions/:versionId/content` | 更新个人 Markdown 题面内容 |
| `PUT` | `/api/contests/:id/statement-management` | 保存活动多题面选择和唯一默认项 |
| `DELETE` | `/api/files/:id` | 见对应路由实现 |
| `DELETE` | `/api/oj-accounts/:id` | 见对应路由实现 |
| `DELETE` | `/api/oj-fetcher/jobs/:id` | 见对应路由实现 |
| `DELETE` | `/api/organizations/:organizationId/members/students/:profileId` | 见对应路由实现 |
| `DELETE` | `/api/organizations/:organizationId/members/teachers/:profileId` | 见对应路由实现 |
| `DELETE` | `/api/platform-bindings/:platform` | 见对应路由实现 |
| `DELETE` | `/api/problem-lists/:id` | 见对应路由实现 |
| `DELETE` | `/api/problem-lists/:id/shares/:shareId` | 见对应路由实现 |
| `DELETE` | `/api/problem-lists/entries/:entryId` | 见对应路由实现 |
| `DELETE` | `/api/problem-lists/sections/:sectionId` | 见对应路由实现 |
| `DELETE` | `/api/problems/:id` | 见对应路由实现 |
| `DELETE` | `/api/problems/:id/attachments/:attachmentId` | 见对应路由实现 |
| `DELETE` | `/api/problems/:id/statements/:statementId` | 见对应路由实现 |
| `DELETE` | `/api/problems/:id/testdata/:fileId` | 见对应路由实现 |
| `DELETE` | `/api/teams/:id` | 见对应路由实现 |
| `DELETE` | `/api/teams/:id/admins/:adminId` | 见对应路由实现 |
| `DELETE` | `/api/teams/:id/invites/:inviteId` | 见对应路由实现 |
| `DELETE` | `/api/teams/:id/members/:memberId` | 见对应路由实现 |
| `DELETE` | `/api/teams/:teamId/problem-lists/:id` | 见对应路由实现 |
| `DELETE` | `/api/contests/:id` | 见对应路由实现 |
| `DELETE` | `/api/contests/:id/problems/:problemId` | 见对应路由实现 |
| `GET` | `/api/admin/data/submission-stats` | 见对应路由实现 |
| `GET` | `/api/auth/me` | 见对应路由实现 |
| `GET` | `/api/carits/me` | 见对应路由实现 |
| `GET` | `/api/carits/me/transactions` | 见对应路由实现 |
| `GET` | `/api/carits/organizations/:organizationId` | 见对应路由实现 |
| `GET` | `/api/carits/organizations/:organizationId/transactions` | 见对应路由实现 |
| `GET` | `/api/carits/platform` | 见对应路由实现 |
| `GET` | `/api/contributions/me/events` | 见对应路由实现 |
| `GET` | `/api/contributions/me/summary` | 见对应路由实现 |
| `GET` | `/api/contributions/organizations/:organizationId/events` | 见对应路由实现 |
| `GET` | `/api/contributions/organizations/:organizationId/rankings` | 见对应路由实现 |
| `GET` | `/api/contributions/platform` | 见对应路由实现 |
| `GET` | `/api/contributions/rankings/users` | 见对应路由实现 |
| `GET` | `/api/files/:id` | 见对应路由实现 |
| `GET` | `/api/files/:id/download` | 见对应路由实现 |
| `GET` | `/api/files/:id/public` | 见对应路由实现 |
| `GET` | `/api/files/by-owner/:ownerType/:ownerId` | 见对应路由实现 |
| `GET` | `/api/health` | 无依赖 liveness，返回版本化 `{schemaVersion:1,status:"ok",service:"api",timestamp}` 并保留一个客户端周期的 `success/message` 兼容字段 |
| `GET` | `/api/me/contests` | 见对应路由实现 |
| `GET` | `/api/me/homeworks` | 见对应路由实现 |
| `GET` | `/api/me/overview` | 见对应路由实现 |
| `GET` | `/api/notifications` | 见对应路由实现 |
| `GET` | `/api/organizations` | 登录用户搜索 `verified` 公开学校及当前关系 |
| `GET` | `/api/me/organizations` | 当前用户的成员、申请与邀请 |
| `GET` | `/api/me/organization-join-applications` | 当前用户的组织申请历史 |
| `GET` | `/api/me/organization-creation-applications` | 当前用户的学校创建申请 |
| `GET` | `/api/me/organization-creation-applications/:id` | 查看本人学校创建申请 |
| `GET` | `/api/organizations/:organizationId/join-applications` | 有权限的校园成员查看申请 |
| `GET` | `/api/organizations/:organizationId/join-applications/:id` | 查看申请详情 |
| `GET` | `/api/organizations/:organizationId/invitations` | 查看有权限范围内的邀请 |
| `GET` | `/api/oj-accounts` | 见对应路由实现 |
| `GET` | `/api/oj-accounts/stats` | 见对应路由实现 |
| `GET` | `/api/oj-fetcher/:platform/:problemId` | 见对应路由实现 |
| `GET` | `/api/oj-fetcher/jobs` | 见对应路由实现 |
| `GET` | `/api/oj-fetcher/platforms` | 见对应路由实现 |
| `GET` | `/api/oj-fetcher/platforms/:platform/config` | 见对应路由实现 |
| `GET` | `/api/organizations/:organizationId/members/activities/contests` | 见对应路由实现 |
| `GET` | `/api/organizations/:organizationId/members/activities/homeworks` | 见对应路由实现 |
| `GET` | `/api/organizations/:organizationId/members/campus` | 见对应路由实现 |
| `GET` | `/api/organizations/:organizationId/members/students` | 见对应路由实现 |
| `GET` | `/api/organizations/:organizationId/members/teachers` | 见对应路由实现 |
| `GET` | `/api/platform-bindings` | 见对应路由实现 |
| `GET` | `/api/platform-bindings/:platform` | 见对应路由实现 |
| `GET` | `/api/platform-bindings/:platform/config-schema` | 见对应路由实现 |
| `GET` | `/api/platform-bindings/platforms` | 见对应路由实现 |
| `GET` | `/api/platform/organizations` | 超管按目录状态和关键词分页查询学校；默认排除 legacy |
| `GET` | `/api/platform/organizations/:organizationId` | 见对应路由实现 |
| `GET` | `/api/platform/organizations/:organizationId/students` | 见对应路由实现 |
| `GET` | `/api/platform/organizations/:organizationId/teachers` | 见对应路由实现 |
| `PATCH` | `/api/platform/organizations/:organizationId/directory-status` | 超管以并发版本和原因变更学校目录状态 |
| `GET` | `/api/platform/organization-creation-applications` | 超管分页查询学校创建申请 |
| `GET` | `/api/platform/organization-creation-applications/:id` | 超管查看创建申请完整审核资料 |
| `GET` | `/api/problem-lists` | 见对应路由实现 |
| `GET` | `/api/problem-lists/:id` | 见对应路由实现 |
| `GET` | `/api/problem-lists/:id/entries/:entryId/files/:fileId` | 见对应路由实现 |
| `GET` | `/api/problem-lists/:id/entries/:entryId/problem` | 见对应路由实现 |
| `GET` | `/api/problem-lists/:id/share-candidates` | 见对应路由实现 |
| `GET` | `/api/problem-lists/:id/shares` | 见对应路由实现 |
| `GET` | `/api/problems` | 见对应路由实现 |
| `GET` | `/api/problems/:id` | 见对应路由实现 |
| `GET` | `/api/problems/:id/ai/usage` | 见对应路由实现 |
| `GET` | `/api/problems/:id/attachments` | 见对应路由实现 |
| `GET` | `/api/problems/:id/judge-config` | 见对应路由实现 |
| `GET` | `/api/problems/:id/note` | 见对应路由实现 |
| `GET` | `/api/problems/:id/submissions` | 见对应路由实现 |
| `GET` | `/api/problems/:id/testdata` | 见对应路由实现 |
| `GET` | `/api/problems/:id/testdata/download/:filename` | 见对应路由实现 |
| `GET` | `/api/problems/:id/testdata/export` | 见对应路由实现 |
| `GET` | `/api/problems/:id/testdata/files/:fileId/download` | 见对应路由实现 |
| `GET` | `/api/problems/library/creators` | 见对应路由实现 |
| `GET` | `/api/rankings/organizations/:organizationId/:metric` | 见对应路由实现 |
| `GET` | `/api/rankings/personal/rating` | 见对应路由实现 |
| `GET` | `/api/rankings/personal/solved` | 见对应路由实现 |
| `GET` | `/api/stats/global` | 见对应路由实现 |
| `GET` | `/api/stats/schools` | 见对应路由实现 |
| `GET` | `/api/submissions` | 见对应路由实现 |
| `GET` | `/api/submissions/:id` | 见对应路由实现 |
| `GET` | `/api/team-import/:batchId/preview` | 见对应路由实现 |
| `GET` | `/api/team-import/:batchId/result` | 见对应路由实现 |
| `GET` | `/api/team-import/history/:teamId` | 见对应路由实现 |
| `GET` | `/api/team-import/luogu/groups` | 见对应路由实现 |
| `GET` | `/api/team-import/platforms` | 见对应路由实现 |
| `GET` | `/api/team-import/teams` | 见对应路由实现 |
| `GET` | `/api/team-import/vjudge/groups` | 见对应路由实现 |
| `GET` | `/api/teams` | 见对应路由实现 |
| `GET` | `/api/teams/:id` | 见对应路由实现 |
| `GET` | `/api/teams/:id/admins` | 见对应路由实现 |
| `GET` | `/api/teams/:id/available-members` | 见对应路由实现 |
| `GET` | `/api/teams/:id/join-requests` | 见对应路由实现 |
| `GET` | `/api/teams/:id/pending-invites` | 见对应路由实现 |
| `GET` | `/api/teams/:teamId/problem-lists` | 见对应路由实现 |
| `GET` | `/api/teams/:teamId/contests` | 见对应路由实现 |
| `GET` | `/api/teams/admin-invitations` | 见对应路由实现 |
| `GET` | `/api/teams/check-team-id` | 见对应路由实现 |
| `GET` | `/api/teams/invitations` | 见对应路由实现 |
| `GET` | `/api/teams/member-invitations` | 见对应路由实现 |
| `GET` | `/api/teams/mine` | 见对应路由实现 |
| `GET` | `/api/teams/my-admin-teams` | 见对应路由实现 |
| `GET` | `/api/teams/my-member-teams` | 见对应路由实现 |
| `GET` | `/api/teams/organization/:organizationId` | 见对应路由实现 |
| `GET` | `/api/contests/:id` | 见对应路由实现 |
| `GET` | `/api/contests/:id/attachments` | 见对应路由实现 |
| `GET` | `/api/contests/:id/overview` | 见对应路由实现 |
| `GET` | `/api/contests/:id/problem-status` | 见对应路由实现 |
| `GET` | `/api/contests/:id/problems` | 见对应路由实现 |
| `GET` | `/api/contests/:id/problems/:problemId/attachments` | 见对应路由实现 |
| `GET` | `/api/contests/:id/problems/:problemId/detail` | 见对应路由实现 |
| `GET` | `/api/contests/:id/problems/:problemId/files/:fileId` | 见对应路由实现 |
| `GET` | `/api/contests/:id/problems/:problemId/note` | 见对应路由实现 |
| `GET` | `/api/contests/:id/problems/:problemId/solution` | 见对应路由实现 |
| `GET` | `/api/contests/:id/ranking` | 见对应路由实现 |
| `GET` | `/api/contests/:id/record` | 见对应路由实现 |
| `GET` | `/api/contests/:id/solutions` | 见对应路由实现 |
| `GET` | `/api/contests/:id/submissions` | 见对应路由实现 |
| `GET` | `/api/contests/:id/submissions/:submissionId` | 见对应路由实现 |
| `GET` | `/api/users` | 见对应路由实现 |
| `GET` | `/api/users/:id` | 见对应路由实现 |
| `GET` | `/api/users/:userId/profile` | 见对应路由实现 |
| `GET` | `/api/workspaces` | 见对应路由实现 |
| `PATCH` | `/api/notifications/:id/read` | 见对应路由实现 |
| `PATCH` | `/api/organizations/:organizationId/join-policy` | 负责人或超管修改加入策略 |
| `POST` | `/api/admin/data/fix-carits-remote-id` | 见对应路由实现 |
| `POST` | `/api/admin/data/fix-hdu-memory` | 见对应路由实现 |
| `POST` | `/api/admin/data/fix-submission-visibility` | 见对应路由实现 |
| `POST` | `/api/admin/data/reset-user-password` | 见对应路由实现 |
| `POST` | `/api/admin/data/rejudge-all-carits` | 见对应路由实现 |
| `POST` | `/api/admin/data/rejudge-all-local` | 重测所有已完成的本地评测提交（兼容任意题目来源） |
| `POST` | `/api/admin/demo-scenario/v2/events` | 见对应路由实现 |
| `POST` | `/api/admin/demo-scenario/v2/prepare` | 见对应路由实现 |
| `POST` | `/api/admin/demo-scenario/v3/events` | 见对应路由实现 |
| `POST` | `/api/admin/demo-scenario/v3/prepare` | 见对应路由实现 |
| `POST` | `/api/auth/avatar` | 见对应路由实现 |
| `POST` | `/api/auth/login` | 见对应路由实现 |
| `POST` | `/api/auth/sessions/revoke` | 递增会话代数、退出其他设备并为当前浏览器换发 HttpOnly Cookie |
| `POST` | `/api/auth/logout` | 见对应路由实现 |
| `POST` | `/api/auth/register` | 见对应路由实现 |
| `POST` | `/api/auth/switch-workspace` | 见对应路由实现 |
| `POST` | `/api/files/upload` | 见对应路由实现 |
| `POST` | `/api/notifications/read-all` | 见对应路由实现 |
| `POST` | `/api/organization-join-applications` | 提交加入学校申请 |
| `POST` | `/api/organization-join-applications/:id/cancel` | 撤销本人待审核申请 |
| `POST` | `/api/organization-creation-applications` | 普通账号申请创建学校 |
| `POST` | `/api/organization-creation-applications/:id/cancel` | 撤销本人待审核学校创建申请 |
| `POST` | `/api/organizations/:organizationId/join-applications/:id/approve` | 审批通过加入申请 |
| `POST` | `/api/organizations/:organizationId/join-applications/:id/reject` | 拒绝加入申请 |
| `POST` | `/api/organizations/:organizationId/invitations` | 邀请现有账号加入学校 |
| `POST` | `/api/organizations/:organizationId/invitations/:id/revoke` | 撤回待处理邀请 |
| `POST` | `/api/organization-invitations/:id/accept` | 接受本人学校邀请 |
| `POST` | `/api/organization-invitations/:id/decline` | 拒绝本人学校邀请 |
| `POST` | `/api/platform/organization-creation-applications/:id/approve` | 超管批准申请并原子创建学校 |
| `POST` | `/api/platform/organization-creation-applications/:id/reject` | 超管拒绝学校创建申请 |
| `POST` | `/api/oj-accounts` | 见对应路由实现 |
| `POST` | `/api/oj-accounts/:id/login` | 见对应路由实现 |
| `POST` | `/api/oj-accounts/:id/verify` | 见对应路由实现 |
| `POST` | `/api/oj-accounts/batch-verify` | 见对应路由实现 |
| `POST` | `/api/oj-fetcher/download-attachment` | 见对应路由实现 |
| `POST` | `/api/oj-fetcher/jobs/:id/retry` | 见对应路由实现 |
| `POST` | `/api/oj-fetcher/jobs/batch` | 见对应路由实现 |
| `POST` | `/api/organizations/:organizationId/members/activities/contests` | 见对应路由实现 |
| `POST` | `/api/organizations/:organizationId/members/principal-transfer` | 见对应路由实现 |
| `POST` | `/api/organizations/:organizationId/members/students` | 见对应路由实现 |
| `POST` | `/api/organizations/:organizationId/members/teachers` | 见对应路由实现 |
| `POST` | `/api/platform-bindings/:platform/bind` | 见对应路由实现 |
| `POST` | `/api/platform-bindings/:platform/refresh` | 见对应路由实现 |
| `POST` | `/api/platform/organizations` | 见对应路由实现 |
| `POST` | `/api/platform/organizations/:organizationId/principal` | 见对应路由实现 |
| `POST` | `/api/problem-lists` | 见对应路由实现 |
| `POST` | `/api/problem-lists/:id/create-assignment` | 从题单创建固定当前 TestSet Revision 的独立作业草稿 |
| `POST` | `/api/problem-lists/:id/sections` | 见对应路由实现 |
| `POST` | `/api/problem-lists/:id/shares` | 见对应路由实现 |
| `POST` | `/api/problem-lists/sections/:sectionId/entries/single` | 见对应路由实现 |
| `POST` | `/api/problems` | 见对应路由实现 |
| `POST` | `/api/problems/:id/ai/format` | 见对应路由实现 |
| `POST` | `/api/problems/:id/ai/translate` | 见对应路由实现 |
| `POST` | `/api/problems/:id/attachments` | 见对应路由实现 |
| `POST` | `/api/problems/:id/copy-to-school` | 见对应路由实现 |
| `POST` | `/api/problems/:id/solution-pdf` | 见对应路由实现 |
| `POST` | `/api/problems/:id/statement-pdf` | 见对应路由实现 |
| `POST` | `/api/problems/:id/statements/pdf` | 见对应路由实现 |
| `POST` | `/api/problems/:id/testdata` | 见对应路由实现 |
| `POST` | `/api/problems/:id/testdata/auto` | 见对应路由实现 |
| `POST` | `/api/problem-selection/resolve` | 按“平台 + 题号”批量精确解析可用 canonical Problem；不抓取、不创建外部题目 |
| `POST` | `/api/submit` | 创建题库本地提交；可用 `inputFilename/outputFilename` 独立选择提交级文件 IO |
| `POST` | `/api/submit/rejudge` | 见对应路由实现 |
| `POST` | `/api/telemetry/client-errors` | 匿名、限流的浏览器运行时错误指纹上报；不保存原始堆栈或凭据 |
| `POST` | `/api/team-import/:batchId/confirm` | 见对应路由实现 |
| `POST` | `/api/team-import/luogu/import` | 见对应路由实现 |
| `POST` | `/api/team-import/luogu/preview` | 见对应路由实现 |
| `POST` | `/api/team-import/luogu/validate` | 见对应路由实现 |
| `POST` | `/api/team-import/start` | 见对应路由实现 |
| `POST` | `/api/team-import/vjudge/import` | 见对应路由实现 |
| `POST` | `/api/team-import/vjudge/preview` | 见对应路由实现 |
| `POST` | `/api/team-import/vjudge/validate` | 见对应路由实现 |
| `POST` | `/api/teams` | 见对应路由实现 |
| `POST` | `/api/teams/:id/admins` | 见对应路由实现 |
| `POST` | `/api/teams/:id/avatar` | 见对应路由实现 |
| `POST` | `/api/teams/:id/join-request` | 见对应路由实现 |
| `POST` | `/api/teams/:id/leave` | 见对应路由实现 |
| `POST` | `/api/teams/:id/members` | 见对应路由实现 |
| `POST` | `/api/teams/:id/transfer` | 见对应路由实现 |
| `POST` | `/api/teams/:teamId/problem-lists` | 见对应路由实现 |
| `POST` | `/api/teams/:teamId/contests` | 创建团队训练/比赛；`type=homework` 返回 `410 LEGACY_HOMEWORK_API_RETIRED` |
| `POST` | `/api/teams/admin-invitations/:invitationId/accept` | 见对应路由实现 |
| `POST` | `/api/teams/admin-invitations/:invitationId/reject` | 见对应路由实现 |
| `POST` | `/api/teams/invitations/:invitationId/accept` | 见对应路由实现 |
| `POST` | `/api/teams/invitations/:invitationId/reject` | 见对应路由实现 |
| `POST` | `/api/teams/join-requests/:requestId/approve` | 见对应路由实现 |
| `POST` | `/api/teams/join-requests/:requestId/reject` | 见对应路由实现 |
| `POST` | `/api/teams/member-invitations/:invitationId/accept` | 见对应路由实现 |
| `POST` | `/api/teams/member-invitations/:invitationId/reject` | 见对应路由实现 |
| `POST` | `/api/contests/:id/create-makeup-homework` | 从已结束活动创建固定原题版本的独立 Assignment 补题草稿 |
| `POST` | `/api/contests/:id/finish` | 见对应路由实现 |
| `POST` | `/api/contests/:id/problems` | 见对应路由实现 |
| `GET` | `/api/contests/:id/rejudge/preview` | 见对应路由实现 |
| `GET` | `/api/contests/:id/submission-users` | 见对应路由实现 |
| `POST` | `/api/contests/:id/rejudge` | 见对应路由实现 |
| `POST` | `/api/contests/:id/start` | 见对应路由实现 |
| `POST` | `/api/contests/:id/submit` | 创建活动本地提交；可用 `inputFilename/outputFilename` 独立选择提交级文件 IO |
| `POST` | `/api/users/:id/reset-password` | 见对应路由实现 |
| `POST` | `/api/users/platform-admin` | 见对应路由实现 |
| `POST` | `/api/workspaces/organization-invitations/:id/:action` | 见对应路由实现 |
| `POST` | `/api/workspaces/organizations/:id/invitations` | 见对应路由实现 |
| `PUT` | `/api/auth/password` | 见对应路由实现 |
| `PUT` | `/api/auth/profile` | 见对应路由实现 |
| `PUT` | `/api/oj-accounts/:id` | 见对应路由实现 |
| `PUT` | `/api/oj-fetcher/platforms/:platform/config` | 见对应路由实现 |
| `PUT` | `/api/organizations/:organizationId/members/campus` | 见对应路由实现 |
| `PUT` | `/api/organizations/:organizationId/members/campus/announcement` | 见对应路由实现 |
| `PUT` | `/api/organizations/:organizationId/members/students/:profileId` | 见对应路由实现 |
| `PUT` | `/api/organizations/:organizationId/members/students/:profileId/status` | 见对应路由实现 |
| `PUT` | `/api/organizations/:organizationId/members/teachers/:profileId` | 见对应路由实现 |
| `PUT` | `/api/organizations/:organizationId/members/teachers/:profileId/status` | 见对应路由实现 |
| `PUT` | `/api/platform/organizations/:organizationId` | 见对应路由实现 |
| `PUT` | `/api/platform/organizations/:organizationId/principal` | 见对应路由实现 |
| `PUT` | `/api/problem-lists/:id` | 见对应路由实现 |
| `PUT` | `/api/problem-lists/:id/sections/reorder` | 见对应路由实现 |
| `PUT` | `/api/problem-lists/entries/:entryId` | 见对应路由实现 |
| `PUT` | `/api/problem-lists/sections/:sectionId` | 见对应路由实现 |
| `PUT` | `/api/problem-lists/sections/:sectionId/entries/reorder` | 见对应路由实现 |
| `PUT` | `/api/problems/:id` | 见对应路由实现 |
| `PUT` | `/api/problems/:id/judge-config` | 见对应路由实现 |
| `PUT` | `/api/problems/:id/note` | 见对应路由实现 |
| `PUT` | `/api/problems/:id/statements/:statementId/visibility` | 见对应路由实现 |
| `PUT` | `/api/teams/:id` | 见对应路由实现 |
| `PUT` | `/api/teams/:id/announcement` | 见对应路由实现 |
| `PUT` | `/api/contests/:id` | 见对应路由实现 |
| `PUT` | `/api/contests/:id/end-time` | 见对应路由实现 |
| `PUT` | `/api/contests/:id/problems/:problemId` | 见对应路由实现 |
| `PUT` | `/api/contests/:id/problems/:problemId/note` | 见对应路由实现 |
| `PUT` | `/api/contests/:id/problems/reorder` | 见对应路由实现 |
| `PUT` | `/api/contests/:id/record` | 见对应路由实现 |
| `GET` | `/api/training-session-templates` | 获取内置及当前账号/学校/团队可用的 Stage 骨架模板 |
| `POST` | `/api/training-sessions/:id/templates` | 将可管理 Session 的 Stage、分组和规则骨架保存为个人/学校/团队模板；不复制题目和运行数据 |
| `DELETE` | `/api/training-session-templates/:id` | 停用自定义模板；既有训练不受影响 |
| `GET` | `/api/training-sessions` | 查询独立教练训练 |
| `POST` | `/api/training-sessions` | 创建独立教练训练 |
| `POST` | `/api/training-sessions/participant-preview` | 使用与创建/发布相同的权限和学生边界解析训练对象及权威人数 |
| `GET` | `/api/training-sessions/:id` | 获取权威训练工作区、进度和权限 |
| `GET` | `/api/training-sessions/:id/design` | 管理员获取 Stage 驱动设计 DTO、稳定 ID、Stage 分组、固定/最新 Revision 和 Subtask |
| `GET` | `/api/training-sessions/:id/design-problems/:problemId` | 校验题目归属并返回可固定的最新正式 Revision |
| `POST` | `/api/training-sessions/:id/structure/validate` | 无写入校验阶段、顺序解锁、Revision 和 Subtask 结构 |
| `PUT` | `/api/training-sessions/:id/structure` | 按稳定 ID 差异更新尚未开始的 Stage；训练锁和 Revision CAS 阻止覆盖，已开始定义冻结 |
| `GET` | `/api/training-sessions/:id/roster` | 查询基础学员名单；不返回 Session 级分组 |
| `PUT` | `/api/training-sessions/:id/roster` | 事务保存基础学员名单；Stage 分组由结构接口保存 |
| `POST` | `/api/training-sessions/:id/publish` | 发布训练并固定参与名单；Stage 在实际开始时生成不可变快照 |
| `POST` | `/api/training-sessions/:id/clone` | 复制可复用定义为新的 DRAFT，不复制参与名单、运行快照、进度或事件 |
| `POST` | `/api/training-sessions/:id/runtime-participants` | 运行中加入范围内学员，记录迟到/补训语义和原因 |
| `POST` | `/api/training-sessions/:id/runtime-participants/:participantId/leave` | 记录学员中途退出，保留此前进度、提交和报告历史 |
| `POST` | `/api/training-sessions/:id/stage-transitions` | 开始、完成/提前结束、跳过 pending Stage 或结束 Session；不支持回滚 |
| `POST` | `/api/training-sessions/:id/stages/:stageId/group-changes` | 即时换组或预设下一 Stage 分组，必须记录原因 |
| `POST` | `/api/training-sessions/:id/stages/:stageId/end` | 结束当前阶段并记录结束原因与备注 |
| `POST` | `/api/training-sessions/:id/stages/:stageId/clone` | 复制未来阶段定义，不复制运行时快照、进度或事件 |
| `POST` | `/api/training-sessions/:id/stages/:stageId/move-participant` | 将学员移动到当前阶段的指定分组并保留历史进度 |
| `GET` | `/api/training-sessions/:id/stages/:stageId/group-suggestions` | 为尚未开始的 grouped Stage 生成基于前序完成度、分数、尝试次数和有效时间的可解释分组建议；只预览，不自动写入 |
| `POST` | `/api/training-sessions/:id/stages/:stageId/time-extensions` | 追加 Stage 延时记录，不改写计划时长 |
| `POST` | `/api/training-sessions/:id/stages/:stageId/runtime-problems` | 向当前 Stage 临时追加全体、分组或个人题目；不改写 RuntimeSnapshot |
| `POST` | `/api/training-sessions/:id/commands` | 执行暂停、Focus、锁定、提示、消息和个人干预；不能改写 Stage 定义 |
| `GET` | `/api/training-sessions/:id/drafts/:stageProblemId` | 获取指定阶段题目的训练代码草稿 |
| `PUT` | `/api/training-sessions/:id/drafts/:stageProblemId` | 按阶段题目 ID 乐观锁保存训练代码草稿 |
| `POST` | `/api/training-sessions/:id/heartbeat` | 上报可见且聚焦的有效训练时间 |
| `POST` | `/api/training-sessions/:id/submit` | 使用固定 Revision/专项投影创建训练提交 |
| `GET` | `/api/training-sessions/:id/coach-dashboard` | 教练实时进度、卡题概览以及学员当前实际 StagePlan |
| `GET` | `/api/training-sessions/:id/peer-progress` | 按训练榜单模式和同学可见性返回服务端裁剪后的进度 |
| `GET` | `/api/training-sessions/:id/report` | Stage 时间轴、各组完成情况、计划/延时/实际时间、快照哈希、带生效 Stage 的换组，以及学员过程报告 |
| `GET` | `/api/training-sessions/:id/events` | 可补偿的训练 SSE 事件流 |
| `POST` | `/api/training-sessions/:id/join` | 范围内成员按迟到规则加入训练 |
| `POST` | `/api/training-sessions/:id/archive` | 归档草稿或已结束训练 |
| `POST` | `/api/training-sessions/:id/hints` | 教练创建分级提示 |
| `GET` | `/api/training-sessions/:id/problems/:stageProblemId/hints` | 获取当前学员已满足条件的提示 |
| `POST` | `/api/training-sessions/:id/hints/:hintId/open` | 幂等记录并打开提示 |
| `PATCH` | `/api/training-sessions/:id/hints/:hintId` | 更新尚未开始阶段的提示定义 |
| `DELETE` | `/api/training-sessions/:id/hints/:hintId` | 删除尚未开始阶段的提示定义 |
| `POST` | `/api/training-sessions/:id/strategy-decisions` | 记录 ACM 策略训练决策 |
| `PUT` | `/api/users/:id/status` | 见对应路由实现 |
| `GET` | `/api/problems/:id/checker` | 题目 Checker 文件列表 |
| `GET` | `/api/problems/:id/checker/:fileName/download` | 下载 Checker 源码 |
| `POST` | `/api/problems/:id/checker` | 上传 Checker 源码 |
| `DELETE` | `/api/problems/:id/checker/:checkerId` | 删除 Checker 源码 |
| `GET` | `/api/problems/:id/my-content` | 获取自己的题面、题解及可共享校园 |
| `GET` | `/api/problems/:id/content-options` | 获取创建活动时可选用的题面与题解 |
| `PUT` | `/api/problems/:id/my-content/:kind` | 保存自己的 Markdown 题面或题解 |
| `PUT` | `/api/problems/:id/my-content/:kind/shares` | 设置个人内容的平台/校园共享范围 |
| `POST` | `/api/problems/:id/my-content/:kind/pdf` | 上传自己的 PDF 题面或题解 |
| `DELETE` | `/api/problems/:id/my-content/:kind` | 删除自己的当前版本；既有活动快照不受影响 |
| `GET` | `/api/contests/:id/problems/:contestProblemId/my-content` | 从活动上下文读取自己的版本 |
| `PUT` | `/api/contests/:id/problems/:contestProblemId/content/:kind` | 管理员编辑活动 Markdown 并创建新 revision |
| `GET` | `/api/contests/:id/problems/:contestProblemId/content-options` | 管理员获取活动可选内容与当前快照 |
| `GET` | `/api/contests/:id/problems/:contestProblemId/content-options/:optionKey/preview` | 管理员预览候选内容 |
| `GET` | `/api/contests/:id/problems/:contestProblemId/content-options/:optionKey/file` | 管理员预览候选 PDF |
| `PUT` | `/api/contests/:id/problems/:contestProblemId/content-selection` | 选择活动题面与题解并追加不可变快照 |
| `GET` | `/api/contests/:id/problems/:contestProblemId/content/:kind/file` | 读取活动当前 PDF 快照 |
| `POST` | `/api/blogs` | 创建可覆盖编辑的知识文章草稿 |
| `GET` | `/api/blogs` | 分页查询本人博客、草稿和归档 |
| `GET` | `/api/blogs/:id` | 按当前版本可见范围读取博客；作者额外获取草稿 |
| `PATCH` | `/api/blogs/:id/draft` | 使用 expectedRevision CAS 更新正文、结构化引用、系列和标签草稿 |
| `POST` | `/api/blogs/:id/publish` | 解析固定引用、执行可见性 fail-closed 检查并发布不可变新版本 |
| `POST` | `/api/blogs/:id/archive` | 作者归档文章，保留已发布版本与引用 |
| `GET` | `/api/blogs/:id/versions` | 仅列出当前读者有权读取的历史版本 |
| `GET` | `/api/blogs/:id/versions/:versionId` | 按该版本发布时固定可见范围读取不可变内容 |
| `GET` | `/api/blogs/:id/references` | 读取当前可见版本的结构化事实引用 |
| `POST` | `/api/blogs/:id/versions/:versionId/convert-to-solution-contribution` | 复制固定 Blog Version 为独立 SolutionContribution 草稿，不直接生成正式题解 |
| `POST` | `/api/blog-drafts/from-contest/:trainingId` | 从本人已结算 Standing Snapshot 创建比赛复盘草稿 |
| `POST` | `/api/blog-drafts/from-solution/:solutionVersionId` | 从有权读取的固定题解版本创建学习博客草稿 |
| `GET` | `/api/problems/:problemId/blogs` | 基于 BlogReference 反向查询当前读者可见的题目相关博客 |
| `GET` | `/api/contests/:contestId/blogs` | 基于固定榜单/Rating 引用反向查询比赛复盘 |
| `GET` | `/api/solutions/:solutionId/related-blogs` | 反向查询固定题解版本相关博客 |
| `GET` | `/api/users/:userId/blogs` | 分页查询指定作者对当前读者可见的已发布博客 |
| `POST` | `/api/blog-series` | 创建个人或组织范围内名称规范化唯一的博客系列 |
| `GET` | `/api/blog-series` | 分页查询本人可管理博客系列 |
| `GET` | `/api/blog-series/:seriesId` | 按系列可见范围读取有序文章，并二次裁剪不可读条目 |
| `PATCH` | `/api/blog-series/:seriesId` | 作者使用 expectedRevision CAS 更新系列元数据和可见范围 |
| `PUT` | `/api/blog-series/:seriesId/entries` | 作者按完整 postIds 集合事务重排系列文章 |
| `GET` | `/api/blog-tags` | 获取可使用的系统标签与本人作者标签 |
| `POST` | `/api/blog-tags` | 在本人命名空间创建或复用 NFKC 规范化唯一标签 |
| `POST` | `/api/platform/blog-tags` | 超管或平台管理员创建或复用受控系统标签 |
| `GET` | `/api/blog-tags/:tagId/blogs` | 通过标签反向查询当前读者可见的已发布博客 |

## Training Engine V2 API

Training Session 使用一条全局 Stage 时间轴。设计器通过 `/design`、`/structure/validate` 与 `/structure` 保存 Stage、稳定 Group、默认 StagePlan 和可选 Group override；运行期使用统一 `/stage-transitions` 推进全班当前 Stage。不存在按组启动、暂停或推进 Stage 的 API。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/training-sessions/:id/design` | 读取 Stage、稳定 Group 和 StagePlan 设计数据 |
| `POST` | `/api/training-sessions/:id/structure/validate` | 校验尚未开始的训练结构 |
| `PUT` | `/api/training-sessions/:id/structure` | 以 statusRevision CAS 保存结构 |
| `GET` | `/api/training-sessions/:id/grouping` | 读取稳定分组与当前成员归属 |
| `PUT` | `/api/training-sessions/:id/grouping` | 保存尚未开始训练的稳定分组 |
| `POST` | `/api/training-sessions/:id/grouping/change` | 调整稳定分组归属 |
| `PUT` | `/api/training-sessions/:id/stage-group-matrix` | 保存默认 StagePlan 与可选分组覆盖；路径名仅对应现有数据库模型，不表示独立运行单元 |
| `POST` | `/api/training-sessions/:id/stage-transitions` | 开始、推进、跳过未来 Stage 或结束整场训练 |
| `POST` | `/api/training-sessions/:id/stages/:stageId/group-changes` | 即时换组或预设目标 Stage 换组 |
| `POST` | `/api/training-sessions/:id/stages/:stageId/time-extensions` | 追加 Stage 延时记录 |
| `POST` | `/api/training-sessions/:id/stages/:stageId/clone` | 将 Stage 定义复制为新的未来 Stage |
| `POST` | `/api/training-sessions/:id/groups/split` | 拆分稳定分组，可立即或在目标 Stage 开始时生效，不创建运行时间线 |
| `POST` | `/api/training-sessions/:id/groups/merge` | 合并稳定分组，不改变全局当前 Stage |

所有 JSON 请求/响应经过 Training Contracts 校验。Stage 转换采用训练锁与 `statusRevision` CAS；Stage 首次开始时创建不可变 RuntimeSnapshot，开始后的定义和计划不可改写，已结束 Stage 不允许回滚。
