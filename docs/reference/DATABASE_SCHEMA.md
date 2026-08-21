---
status: reference
audience: development, testing
last_verified: 2026-08-21
source_of_truth: apps/web/src/app and e2e/fixtures/routes.ts
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
| `ProblemList` | 以 Prisma schema 为准 |
| `ProblemListEntry` | 以 Prisma schema 为准 |
| `ProblemListSection` | 以 Prisma schema 为准 |
| `ProblemListShare` | 以 Prisma schema 为准 |
| `ProblemNote` | 以 Prisma schema 为准 |
| `ProblemStatement` | 以 Prisma schema 为准 |
| `School` | 以 Prisma schema 为准 |
| `SchoolProblemList` | 以 Prisma schema 为准 |
| `Submission` | 以 Prisma schema 为准 |
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
