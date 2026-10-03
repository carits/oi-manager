---
status: reference
audience: development, testing
last_verified: 2026-09-13
source_of_truth: apps/server/prisma/schema.prisma
---

# 数据库模型

校园身份与档案唯一来源为组织成员关系、学生组织档案与教师组织档案。全局账号不再保存校园归属，旧学生、教师和管理员模型已删除。学校资料通过学校资料表关联学校组织。`User.sessionVersion` 是轻量会话撤销代数；密码变化或主动退出其他设备时递增，不建立可变 Session 表。

独立作业由 `Assignment`、`AssignmentProblem`、`AssignmentRecipient`、`AssignmentRecipientOverride`、`AssignmentProblemProgress`、`AssignmentCorrection`、`AssignmentFeedback`、`AssignmentScoreAdjustment`、`AssignmentGradeSnapshot` 和 `AssignmentEvent` 组成。作业题目只保存 canonical Problem；每次 `Submission/JudgeRun` 固定作业上下文和当时取得的 Stable 槽身份，旧 `Training(type=homework)` 只作为迁移来源保留。

联系人和私信域由 `ChatPrivacySetting`、`FriendRequest`、`Friendship`、`UserBlock`、`DirectConversation`、`DirectConversationMember`、`DirectMessage`、`ChatUserEvent`、`ChatReport`、`ChatMaintenanceCursor`、`ChatStickerPack`、`ChatSticker` 和 `ChatStickerImport` 组成。有序用户对和数据库约束保证唯一关系与会话；消息不可编辑，举报先保存独立证据快照，终态满一年后最小化证据并释放可清理消息引用。表情包版本和资源不可变，退役版本继续服务历史消息。

| 模型 | 说明 |
|---|---|
| `ChatPrivacySetting` | 账号级聊天发现隐私设置 |
| `ChatReport` | 举报、有限上下文证据与审核状态 |
| `ChatMaintenanceCursor` | 未读修复、消息 GC 和举报证据释放的持久扫描位置 |
| `ChatUserEvent` | 支持 SSE 补偿的七天持久事件 |
| `DirectConversation` | 有序用户对唯一的一对一会话 |
| `DirectConversationMember` | 用户侧已读、未读、归档和清空位置 |
| `DirectMessage` | 会话内有序、幂等且不可编辑的文字或平台表情消息 |
| `ChatStickerPack` | 版本化且可退役的平台表情包 |
| `ChatSticker` | 内容寻址的不可变动画/静态表情资源 |
| `ChatStickerImport` | 有时限、带检查报告哈希的表情包发布暂存记录 |
| `FriendRequest` | 可过期的联系申请状态机 |
| `Friendship` | 可移除和恢复的账号级联系人关系（内部兼容名称） |
| `UserBlock` | 方向性账号拉黑关系 |
| `AiUsageLog` | 以 Prisma schema 为准 |
| `AiTokenPool` | 平台唯一 DeepSeek Token 总池，保存可用、预占、已消费和 CAS 版本 |
| `AiTokenLedgerEntry` | 充值、预占、结算、释放和人工调整的幂等不可变流水 |
| `AiGenerationRequest` | Validator/翻译/格式化 AI 请求、父修复链、真实用量与编译结果 |
| `Assignment` | 独立作业聚合根，保存学校/团队范围、生命周期、版本化必做/选做/挑战计分策略和乐观锁 revision |
| `AssignmentCorrection` | 教师布置的逐学生逐题订正事实及达标分数 |
| `AssignmentEvent` | 作业内单调、追加式审计事件 |
| `AssignmentFeedback` | 学生可见或教师内部的不可变作业反馈 |
| `AssignmentGradeSnapshot` | 截止、关闭、订正后或发布时的版本化成绩快照 |
| `AssignmentProblem` | 有序作业题目、评分目标；提交时动态取得 Stable/Judge 满分、作业满分、类别、权重和评分目标 |
| `AssignmentProblemProgress` | 收件人逐题的学习、时效、订正和分数投影，可由提交事实重建 |
| `AssignmentRecipient` | 发布时固定的学生名单和个人有效截止时间 |
| `AssignmentRecipientOverride` | 收件人的追加式延期、免交或状态覆盖事实 |
| `AssignmentScoreAdjustment` | 只能追加和冲正的人工调分流水 |
| `BlogPost` | 知识发布聚合根，保存作者、归属、状态和当前不可变版本指针 |
| `BlogPostDraft` | 可覆盖编辑的草稿，使用 revision 乐观锁并保存未发布引用与分类 |
| `BlogPostVersion` | 发布时生成的不可变 Markdown、可见范围、组织与分类快照 |
| `BlogReference` | 指向题目/测试版本、题解版本、榜单快照或 RatingChange 的不可变结构化引用 |
| `BlogSeries` | 个人或组织范围的可见系列，名称规范化唯一并使用 revision CAS |
| `BlogSeriesEntry` | 系列与文章的有序多对多关系 |
| `BlogTag` | 平台系统标签或作者命名空间内受控、规范化唯一的标签 |
| `BlogPostTag` | 当前文章与标签的反向查询索引；历史分类另固化于 BlogPostVersion |
| `BlogSubmissionSnapshot` | 提交作者显式创建的脱敏不可变快照；只保存安全摘要、可选源码和内容哈希，供 BlogReference 固定引用 |
| `BlogComment` | 已发布博客的一层评论/回复及可治理状态 |
| `BlogReaction` | 用户对博客的 LIKE/HELPFUL 幂等反应 |
| `BlogBookmark` | 用户账号级博客收藏 |
| `BlogReport` | 文章/评论举报、固化证据与治理结论 |
| `BlogFeature` | 可退役且带审计的社区精选事实 |
| `CaritsAccount` | 用户、组织或系统的 Carits 账户；余额与不可变分录同事务更新 |
| `ContestStandingEntry` | 最终榜单中带组织快照、并列组和 Rating 资格的参赛者事实 |
| `ContestStandingSnapshot` | 只以规范 `contestId` 归属比赛的版本化不可变最终排名输入 |
| `ContestRatingConfig` | 一场规范 Contest 唯一的冻结 Rating 策略；物理表沿用历史名称，但领域模型不再关联 Training |
| `RatingBatch` | 以规范 `contestId` 归属比赛和 RatingPool 的不可变结算/重放批次 |
| `CaritsLedgerEntry` | 交易内按账户聚合的双向分录；posted 后不得追加、修改或删除 |
| `CaritsTransaction` | 平衡的 Carits 交易、幂等业务引用、请求指纹及冲正关系；同键差异载荷必须拒绝 |
| `Contest` | 唯一比赛聚合；以独立 `publicId` 支持数字路由，并直接拥有题目、参赛者、生命周期、Rating 配置、最终榜单快照和结算批次 |
| `ContestParticipant` | 比赛参赛者与 Rating 锁定事实；保存比赛内用户身份、组织快照、处置状态和首交时间 |
| `ContestProblem` | 比赛题目；固定 Canonical Problem、Stable Reader/hash/fence、序号、别名与内容快照，不关联 TrainingProblem |
| `ContestProblemScore` | 以 Prisma schema 为准 |
| `ContestRecord` | 活动记录；普通训练使用 `trainingId`，比赛使用 `canonicalContestId`，数据库约束每行只能归属一类活动 |
| `ContestResource` | 以 Prisma schema 为准 |
| `ContestResult` | 以 Prisma schema 为准 |
| `ContestUserProblemStatus` | 比赛用户题目状态；只保存必填的 Contest/ContestProblem 身份，不含旧 Training 整数键 |
| `ContributionEvent` | Candidate/Hack 正式晋升产生的版本化声誉事实及证据快照 |
| `ContributionRewardDelivery` | 贡献事件的 Carits 奖励投递，含租约、fencing、按毛发放统计的日预算、有界重试、入账与冲正引用 |
| `ContributionProject` | 以 Prisma schema 为准 |
| `File` | 以 Prisma schema 为准 |
| `JudgeAttempt` | 一次 JudgeRun 的物理执行尝试，保存状态、执行者、fencing token、租约、阶段结果与六段延迟；终态不可重新打开 |
| `JudgeRun` | 一次逻辑评测运行，固定测试版本、配置哈希与提交级输入/输出文件 IO，并聚合可重试的 JudgeAttempt |
| `LoginLog` | 以 Prisma schema 为准 |
| `Milestone` | 以 Prisma schema 为准 |
| `OjAccount` | 以 Prisma schema 为准 |
| `OjFetchJob` | 以 Prisma schema 为准 |
| `OjPlatformConfig` | 以 Prisma schema 为准 |
| `Organization` | 以 Prisma schema 为准 |
| `OrganizationContributionAttribution` | 以 Prisma schema 为准 |
| `OrganizationMembership` | 以 Prisma schema 为准 |
| `OrganizationMembershipRole` | 成员关系的规范化多角色分配；迁移期与旧 `memberRole` 双读 |
| `OrganizationMembershipCapability` | 成员关系的显式能力授予，授权策略按稳定 capability key 读取 |
| `OrganizationJoinApplication` | 用户主动加入学校的申请、审核结果及内外分离备注 |
| `OrganizationInvitation` | 学校向现有账号发送的独立邀请与响应状态 |
| `OrganizationAuditLog` | 加入策略、申请审批、邀请和成员恢复的持久化审计 |
| `OrganizationCreationApplication` | 普通账号申请创建学校，保存标准化名称、负责人资料与内外分离的审核说明 |
| `OrganizationStudentProfile` | 以 Prisma schema 为准 |
| `OrganizationTeacherProfile` | 以 Prisma schema 为准 |
| `PasswordResetLog` | 以 Prisma schema 为准 |
| `PlatformAuditLog` | 组织创建申请、审核和超管直接创建的平台级审计 |
| `PersonalProfile` | 以 Prisma schema 为准 |
| `PrincipalTransferLog` | 以 Prisma schema 为准 |
| `Problem` | 以 Prisma schema 为准 |
| `ProblemAttachment` | 以 Prisma schema 为准 |
| `ProblemChecker` | Lemon SPJ 源码与头文件记录 |
| `ProblemHackAttempt` | 题目级 ACM/OI Hack 独立队列、Generator 协议、证明程序提交级文件 IO、前后 Verdict/分数、命中 Subtask 与落库状态 |
| `ProblemHackConfig` | 题目级 Hack 开关、STD、Validator、OI Classifier 和配置 revision |
| `ProblemJudgeProgram` | 题目的逻辑 STD、Validator、Classifier 或命名 Generator 及当前版本指针 |
| `ProblemJudgeProgramVersion` | 不可变程序源码版本、哈希、语言、协议/模板、compiled/verified/active/retired 生命周期、预检报告、作者和 AI 来源 |
| `ProblemJudgeProgramDraft` | 题目管理员按程序类型保存、带乐观锁 revision 的服务端编辑草稿 |
| `ProblemJudgeProgramFixtureSet` | 不可变的结构化协议 Fixture 集合及内容哈希，可被程序版本和验证任务复用 |
| `ProblemJudgeProgramVerificationJob` | Judge 异步编译/预检任务，保存租约、fencing token、尝试次数、报告和终态错误 |
| `ProblemJudgeProgramAuditLog` | 程序创建、编译、预检、激活、退役等操作的题目级不可变审计 |
| `ProblemDataGenerationJob` | 独立数据生成队列、程序版本、基础 Evolving graph/fence、租约和写入结果 |
| `ProblemDataGenerationCase` | 一次参数/直接输入对应的候选测试点、逐阶段状态、内容对象与预览 |
| `TestcaseCandidate` | 已通过技术验证、等待或已经晋升的候选测试点；固定内容对象、基线槽/graph/fence、命中 Subtask、语义指纹、保护期与逐 Subtask 选择结果 |
| `WrongSolutionSample` | 私有历史/人工错误程序样本索引；执行指纹同时包含语言、源码和提交级 IO，源码访问仍遵守原提交权限 |
| `WrongBehaviorCluster` | 错误行为代表簇、权重、类别及 Evaluation/Holdout 分区 |
| `WrongCorpusRevision` | 一次不可变 Corpus 构建摘要与固定分层 |
| `BugCategory` | 管理员维护的错误类型与权重 |
| `CandidateEvaluationRun` | Candidate 的 L1/L2/Holdout 持久阶段；同一评估轮共享预算 ID，保存租约、fencing token、重试和真实资源用量 |
| `TestcaseMembershipRetirement` | 当前槽以高价值 Candidate 替换成员时的追加式审计；不复制 Blob |
| `CanonicalSelectionRun` | Selector 输入、输出、质量差值、状态和 Evolving graph |
| `ProblemCandidatePolicy` | 题目候选池、Top-K、正式点数、发布阈值与 observe/auto 策略 |
| `QualityEvaluationJob` | 固定 slot/graph、Corpus、规则、Feature、程序和 Checker 输入的异步 DQS 任务；租约/fencing/重试状态可变，固定输入由数据库触发器保护 |
| `TestSetQualitySnapshot` | slot/graph 级不可变 DQS 证书；保存六维评分、Evaluation/Holdout 分离覆盖、Confidence、Maturity、Critical Gate 和私有 evidence |
| `ProblemSolutionProfile` | 题目级版本化代表解配置；引用本题固定 graph 的本地终态提交，保存算法类别、复杂度、预期总分和 Subtask 分数区间，作为 OI Subtask Quality 的固定输入 |
| `ProblemQualityAssessment` | 内容版本级 PQS；自动评分/evidence 不可覆盖，平台质量审核员只能追加一次专家评分与审查证据 |
| `SolutionContribution` | 题解投稿聚合根，保存作者、组织归因、状态与当前不可变投稿 Revision |
| `SolutionContributionRevision` | 每次提交/重投冻结的题解内容、题面快照、来源授权和目标测试集 slot/graph |
| `SolutionVerification` | 题解代码针对固定测试集 slot/graph 的 Judge 技术验证结果 |
| `SolutionReview` | 审核人的不可变审核事实；冲突审核由投稿级锁和状态 CAS 串行化 |
| `SolutionSimilarityJob` | 当前投稿 Revision 的持久异步相似度任务，保存租约、fencing、有界重试和终态错误 |
| `SolutionContentFingerprint` | 正式题解或投稿 Revision 的版本化正文/代码 bottom-k 指纹，可按内容哈希复用计算 |
| `ProblemSolution` | 已发布题解稳定身份与当前版本指针 |
| `ProblemSolutionVersion` | 不可变发布版本，固化内容、验证、来源和发布时 visibilityPolicy |
| `DataProduct` | 固定 slot/graph 与质量快照的数据商品；服务端自动等级、更新策略、includes、卖方范围和停售状态 |
| `DataProductPrice` | 商品按 PERSONAL/ORGANIZATION/CONTEST 许可证生成的不可变服务端价格 |
| `DataPurchase` | UUID 幂等购买、固定价格/graph/质量证书与 Carits posted 交易关联 |
| `DataEntitlement` | 个人、组织或 `Training(type=contest)` 范围的授权根；身份字段不可变，可审计撤销 |
| `TestSetQualityIncident` | slot/graph 质量事故、确认/解决审计与修复 graph；Critical 驱动商品停售 |
| `EvaluationCreditAccount` | 用户或平台按日 Evaluation Credits 的可用、预占和消费账户 |
| `EvaluationCreditLedgerEntry` | Evaluation Credits 可用额度的不可变幂等流水；预占为负数，结算/释放记录未用额度退回 |
| `EvaluationCreditWallet` | 用户长期有效的已购 Evaluation Credits 可用、预占和消费投影 |
| `EvaluationCreditWalletEntry` | 已购额度的购买、预占、结算与释放流水 |
| `EvaluationCreditReservation` | 任务对免费账户、已购钱包和平台日预算的固定分配与跨日结算记录；主路径事务结算并由 Scheduler 对账恢复孤儿/终态遗留 |
| `ResourcePurchase` | 服务端固定套餐、Carits 交易和 Credits 钱包分录的幂等业务关联 |
| `ValidatorSpec` | Validator DSL AST、模板生成源码、编译/验证和激活状态 |
| `ProblemFeatureDefinition` | 题目 Feature 注册表和提取配置 |
| `ProblemSubtaskRule` | Feature 到 OI Subtask 的声明式规则 |
| `BlobObject` | 全局 SHA-256 内容对象、存储层级与延迟删除时间 |
| `BlobReference` | Blob 到 Candidate/TestSet 槽/程序等业务 owner 的权限引用 |
| `ProblemTestcase` | 规范化测试点；一份输入/答案可关联多个 Test Group |
| `ProblemSubtask` | OI 稳定数字 Subtask、满分和顺序 |
| `ProblemSubtaskDependency` | Subtask 有向无环依赖关系 |
| `ProblemTestGroup` | Subtask 的官方计分组或系统 Hack Gate |
| `ProblemTestcaseGroup` | Testcase 与 Test Group 多对多关系及点级限制/分值 |
| `TestdataObject` | 题目内以 SHA-256 寻址的不可变测试内容对象，可被 Stable/Evolving 及其他业务引用复用 |
| `ProblemTestSetSlot` | 每题 Stable/Evolving 当前槽；Judge 投影、graph hash、fencing token、gate 与物化路径 |
| `ProblemTestSetSlotCase` | ACM 槽当前有序输入/答案关系，引用 TestdataObject |
| `ProblemTestSetSlotSubtask` | OI 槽当前 Subtask |
| `ProblemTestSetSlotDependency` | 当前槽 Subtask 依赖 |
| `ProblemTestSetSlotGroup` | 当前槽 Official Group/Hack Gate |
| `ProblemTestSetSlotGroupCase` | 当前槽 Group 与内容对象/Testcase 的关系 |
| `ProblemTestSetReader` | `(problem, slot)` 当前 Reader 租约；Judge、Contest、Training 等持有 |
| `ProblemTestSetWriter` | writer-priority 排队写入、fencing、staging 与终态审计 |
| `ProblemTestSetPromotionJob` | 捕获 Evolving graph/fence 的 Promotion 验证任务；临时副本不入模型 |
| `ProblemList` | 可复用题目集合根 |
| `ProblemListEntry` | 题单中的 canonical Problem 条目 |
| `ProblemListSection` | 题单章节与顺序 |
| `ProblemListShare` | 题单分享关系 |
| `ProblemNote` | 用户私有题目笔记 |
| `ProblemStatement` | 题目官方题面 |
| `RatingAccount` | 用户在 Rating Pool 中的当前投影 |
| `RatingChange` | 比赛结算产生的不可变 Rating 变化 |
| `RatingPool` | Rating 赛制与作用域池 |
| `RatingRebuildJob` | Rating 重放/重建任务 |
| `RejudgeBatch` | 批量重测任务与状态 |
| `School` | 学校组织资料 |
| `SchoolProblemList` | 学校与题单关联 |
| `SolutionSimilarityCheck` | 题解投稿 Revision 的正文/代码相似度风险提示、来源声明和审核匹配证据 |
| `Submission` | 不可变用户提交意图；以 `workspaceScope + organizationId` 固化个人/具体校园归属，以提交级 IO 固化 stdin/stdout 或文件名，并通过 `currentJudgeRunId` 指向当前逻辑评测；比赛提交只使用 Contest/ContestProblem 身份，执行结果只存于 JudgeRun/JudgeAttempt |
| `Team` | 以 Prisma schema 为准 |
| `TeamJoinRequest` | 以 Prisma schema 为准 |
| `TeamMember` | 以 Prisma schema 为准 |
| `TeamMemberExternalAccount` | 以 Prisma schema 为准 |
| `TeamMemberImportBatch` | 以 Prisma schema 为准 |
| `TeamMemberImportItem` | 以 Prisma schema 为准 |
| `TeamOperationLog` | 以 Prisma schema 为准 |
| `TeamProblemList` | 以 Prisma schema 为准 |
| `TestdataFile` | 以 Prisma schema 为准 |
| `TrainingSession` | 训练聚合根；保存范围、赛制、READY/RUNNING/PAUSED/ENDED/ARCHIVED 生命周期、总时长、有效运行时间和 currentRoundId |
| `TrainingSessionProblem` | Session 内稳定题目身份；同一 sessionId + problemId 唯一，移出和重加分配不改变历史身份 |
| `TrainingSessionRound` | 有序课堂轮次；生命周期为 PENDING/RUNNING/ENDED，保存独立计时和结束原因 |
| `TrainingRoundProblemAssignment` | Round × Group × SessionProblem 的有效题集分配与顺序 |
| `TrainingSessionGroup` | 整场训练的稳定分组 |
| `TrainingSessionGroupChange` | 学员跨稳定分组的审计记录 |
| `TrainingSessionParticipant` | 学员、当前 groupId、当前题目、心跳和有效活跃时间 |
| `TrainingSessionProblemProgress` | Participant × SessionProblem 的稳定进度，换组或题目暂时移出不删除 |
| `TrainingSessionCommand` | 带会话单调序号的课堂控制命令审计 |
| `TrainingSessionOverlay` | 面向全员、分组或用户的运行期聚焦覆盖 |
| `TrainingSessionProblemDraft` | Participant × SessionProblem 代码草稿 |
| `TrainingSessionScoreEvent` | 训练提交产生的幂等分数事件 |
| `TrainingSessionEvent` | SSE 补偿使用的会话单调持久事件 |
| `ContestRatingConfig` | 比赛开始前可配置、开始或首交时冻结的 Contest Rating 规则快照 |
| `User` | 全局账号、密码摘要、状态与会话撤销代数；不保存学校身份 |
| `UserProblemContent` | 用户独立题面版本与兼容题解；题面按名称软删除并使用 private/public 可见性 |
| `UserNotification` | 以 Prisma schema 为准 |
| `UserPlatformBinding` | 以 Prisma schema 为准 |
| `UserStatusLog` | 以 Prisma schema 为准 |
| `carits_sequence` | 以 Prisma schema 为准 |

## Training Engine V3 表约束

`TrainingSessionProblem` 通过 `sessionId + problemId` 唯一约束保证稳定身份。`TrainingRoundProblemAssignment` 通过轮次、分组、稳定训练题目建立唯一分配，并以 `active` 和 `orderIndex` 表示当前题集。服务层保证一个 Session 同时至多一个 RUNNING Round，`currentRoundId` 必须指向本 Session 的运行轮次。Participant、Progress、Draft、ScoreEvent、Overlay 和 Submission 均引用稳定 SessionProblem，不引用轮次分配。
