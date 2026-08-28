---
status: reference
audience: development, testing
last_verified: 2026-08-28
source_of_truth: apps/server/prisma/schema.prisma
---

# 数据库模型

校园身份与档案唯一来源为组织成员关系、学生组织档案与教师组织档案。全局账号不再保存校园归属，旧学生、教师和管理员模型已删除。学校资料通过学校资料表关联学校组织。

| 模型 | 说明 |
|---|---|
| `AiUsageLog` | 以 Prisma schema 为准 |
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
| `JudgeRun` | 一次逻辑评测运行，固定测试版本/配置哈希并聚合可重试的 JudgeAttempt |
| `LoginLog` | 以 Prisma schema 为准 |
| `Milestone` | 以 Prisma schema 为准 |
| `OjAccount` | 以 Prisma schema 为准 |
| `OjFetchJob` | 以 Prisma schema 为准 |
| `OjPlatformConfig` | 以 Prisma schema 为准 |
| `Organization` | 以 Prisma schema 为准 |
| `OrganizationContributionAttribution` | 以 Prisma schema 为准 |
| `OrganizationMembership` | 以 Prisma schema 为准 |
| `OrganizationStudentProfile` | 以 Prisma schema 为准 |
| `OrganizationTeacherProfile` | 以 Prisma schema 为准 |
| `PasswordResetLog` | 以 Prisma schema 为准 |
| `PersonalProfile` | 以 Prisma schema 为准 |
| `PrincipalTransferLog` | 以 Prisma schema 为准 |
| `Problem` | 以 Prisma schema 为准 |
| `ProblemAttachment` | 以 Prisma schema 为准 |
| `ProblemChecker` | Lemon SPJ 源码与头文件记录 |
| `ProblemHackAttempt` | 题目级 ACM/OI Hack 独立队列、前后 Verdict/分数、命中 Subtask 与落库状态 |
| `ProblemHackConfig` | 题目级 Hack 开关、STD、Validator、OI Classifier 和配置 revision |
| `TestcaseCandidate` | 已通过技术验证、等待或已经晋升的候选测试点；固定内容对象、基线 Revision、命中 Subtask 与晋升状态 |
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
| `School` | 以 Prisma schema 为准 |
| `SchoolProblemList` | 以 Prisma schema 为准 |
| `Submission` | 不可变用户提交意图；以 `workspaceScope + organizationId` 固化个人/具体校园归属，并通过 `currentJudgeRunId` 指向当前逻辑评测 |
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
