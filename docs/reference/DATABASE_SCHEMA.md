---
status: reference
audience: development, testing
last_verified: 2026-09-06
source_of_truth: apps/server/prisma/schema.prisma
---

# 数据库模型

校园身份与档案唯一来源为组织成员关系、学生组织档案与教师组织档案。全局账号不再保存校园归属，旧学生、教师和管理员模型已删除。学校资料通过学校资料表关联学校组织。

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
| `CaritsAccount` | 以 Prisma schema 为准 |
| `CaritsLedgerEntry` | 以 Prisma schema 为准 |
| `CaritsTransaction` | 以 Prisma schema 为准 |
| `Contest` | 以 Prisma schema 为准 |
| `ContestProblem` | 以 Prisma schema 为准 |
| `ContestProblemScore` | 以 Prisma schema 为准 |
| `ContestRecord` | 以 Prisma schema 为准 |
| `ContestResource` | 以 Prisma schema 为准 |
| `ContestResult` | 以 Prisma schema 为准 |
| `ContestUserProblemStatus` | 以 Prisma schema 为准 |
| `ContributionEvent` | 以 Prisma schema 为准 |
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
| `ProblemDataGenerationJob` | 独立数据生成队列、程序版本、基础 Revision、租约、fencing token 和晋升结果 |
| `ProblemDataGenerationCase` | 一次参数/直接输入对应的候选测试点、逐阶段状态、内容对象与预览 |
| `TestcaseCandidate` | 已通过技术验证、等待或已经晋升的候选测试点；固定内容对象、基线 Revision、命中 Subtask 与晋升状态 |
| `WrongSolutionSample` | 私有历史/人工错误程序样本索引；执行指纹同时包含语言、源码和提交级 IO，源码访问仍遵守原提交权限 |
| `WrongBehaviorCluster` | 错误行为代表簇、权重、类别及 Evaluation/Holdout 分区 |
| `WrongCorpusRevision` | 一次不可变 Corpus 构建摘要与固定分层 |
| `BugCategory` | 管理员维护的错误类型与权重 |
| `CandidateEvaluationRun` | Candidate 的 L1/L2/Holdout 阶段、预算和评估摘要 |
| `CanonicalSelectionRun` | Selector 输入、输出、质量差值、状态和晋升 Revision |
| `ProblemCandidatePolicy` | 题目候选池、Top-K、正式点数、发布阈值与 observe/auto 策略 |
| `EvaluationCreditAccount` | 用户或平台按日 Evaluation Credits 的可用、预占和消费账户 |
| `EvaluationCreditLedgerEntry` | Evaluation Credits 预占/结算/释放不可变幂等流水 |
| `ValidatorSpec` | Validator DSL AST、模板生成源码、编译/验证和激活状态 |
| `ProblemFeatureDefinition` | 题目 Feature 注册表和提取配置 |
| `ProblemSubtaskRule` | Feature 到 OI Subtask 的声明式规则 |
| `BlobObject` | 全局 SHA-256 内容对象、存储层级与延迟删除时间 |
| `BlobReference` | Blob 到 Candidate/Revision/程序等业务 owner 的权限引用 |
| `ProblemTestcase` | 规范化测试点；一份输入/答案可关联多个 Test Group |
| `ProblemSubtask` | OI 稳定数字 Subtask、满分和顺序 |
| `ProblemSubtaskDependency` | Subtask 有向无环依赖关系 |
| `ProblemTestGroup` | Subtask 的官方计分组或系统 Hack Gate |
| `ProblemTestcaseGroup` | Testcase 与 Test Group 多对多关系及点级限制/分值 |
| `TestdataObject` | 题目内以 SHA-256 寻址的不可变测试内容对象，可被多个 Revision 复用 |
| `ProblemTestSetRevision` | 题库正式不可变测试版本、父版本、来源、Judge 投影与一致性哈希 |
| `ProblemTestSetRevisionCase` | ACM Revision 中有序的输入/答案映射和限制覆盖 |
| `ProblemTestSetRevisionSubtask` | OI Revision 内稳定 Subtask、副本分值与顺序 |
| `ProblemTestSetRevisionDependency` | OI Revision 内不可变 Subtask 依赖 |
| `ProblemTestSetRevisionGroup` | OI Revision 内 Official Group/Hack Gate 副本 |
| `ProblemTestSetRevisionGroupCase` | OI Revision Group 与内容对象/Testcase 的不可变关联 |
| `ProblemList` | 以 Prisma schema 为准 |
| `ProblemListEntry` | 以 Prisma schema 为准 |
| `ProblemListSection` | 以 Prisma schema 为准 |
| `ProblemListShare` | 以 Prisma schema 为准 |
| `ProblemNote` | 以 Prisma schema 为准 |
| `ProblemStatement` | 以 Prisma schema 为准 |
| `RejudgeBatch` | 一次范围重测请求及其作用域、请求者、计数和关联 JudgeRun |
| `School` | 学校资料；`directoryStatus` 区分待核验、正式、隐藏和历史隔离；`nameKey` 仅由非 legacy 学校占用并保存全局唯一正式名称 |
| `SchoolProblemList` | 以 Prisma schema 为准 |
| `Submission` | 不可变用户提交意图；以 `workspaceScope + organizationId` 固化个人/具体校园归属，以提交级 IO 固化 stdin/stdout 或文件名，并通过 `currentJudgeRunId` 指向当前逻辑评测 |
| `Team` | 以 Prisma schema 为准 |
| `TeamJoinRequest` | 以 Prisma schema 为准 |
| `TeamMember` | 以 Prisma schema 为准 |
| `TeamMemberExternalAccount` | 以 Prisma schema 为准 |
| `TeamMemberImportBatch` | 以 Prisma schema 为准 |
| `TeamMemberImportItem` | 以 Prisma schema 为准 |
| `TeamOperationLog` | 以 Prisma schema 为准 |
| `TeamProblemList` | 以 Prisma schema 为准 |
| `TestdataFile` | 以 Prisma schema 为准 |
| `Training` | 以 Prisma schema 为准 |
| `TrainingAttachment` | 以 Prisma schema 为准 |
| `TrainingParticipant` | 以 Prisma schema 为准 |
| `TrainingProblem` | 以 Prisma schema 为准 |
| `TrainingProblemContentSnapshot` | 活动题面/题解不可变 revision 快照；当前版本取最大 revision |
| `TrainingProblemStatementSet` | 活动一道题的一次多题面选择 revision |
| `TrainingProblemStatementSnapshot` | 选择集合内不可变的题面副本、顺序和默认标记 |
| `TrainingSolution` | 以 Prisma schema 为准 |
| `TrainingUserProblemStatus` | 以 Prisma schema 为准 |
| `User` | 以 Prisma schema 为准 |
| `UserProblemContent` | 用户独立题面版本与兼容题解；题面按名称软删除并使用 private/public 可见性 |
| `UserArchivedProblem` | 以 Prisma schema 为准 |
| `UserNotification` | 以 Prisma schema 为准 |
| `UserPlatformBinding` | 以 Prisma schema 为准 |
| `UserStatusLog` | 以 Prisma schema 为准 |
| `carits_sequence` | 以 Prisma schema 为准 |
