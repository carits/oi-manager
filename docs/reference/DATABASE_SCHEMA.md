---
status: reference
audience: development
last_verified: 2026-08-02
source_of_truth: apps/server/prisma/schema.prisma
---

# 数据库 Schema

数据库 provider 为 PostgreSQL。下表登记全部 54 个 Prisma 模型；字段和约束的最终
定义始终以 `apps/server/prisma/schema.prisma` 为准。

## 身份与学校（12）

| 模型 | 关键字段 | 用途 |
|------|----------|------|
| `Admin` | `id`, `name`, `schoolId` | 超管/平台管理员扩展 |
| `User` | `id`, `username`, `passwordHash`, `role`, `status` | 全局登录账号；`role` 仅保留平台权限，旧 `schoolId` 仅作兼容 |
| `Teacher` | `id`, `name`, `schoolId`, `status` | 教师扩展 |
| `Student` | `id`, `name`, `schoolId`, `headTeacherId`, `rating` | 学生扩展 |
| `PersonalProfile` | `userId`, `rating`, timestamps | 全角色按需启用的个人身份与个人 Rating |
| `School` | `id`, `name`, `currentPrincipalTeacherId`, `status` | 学校与当前负责人 |
| `Organization` | `id`, `name`, `type`, `status` | 统一组织工作区；首期由学校一一映射 |
| `OrganizationMembership` | `organizationId`, `userId`, `memberRole`, `relationType`, `status` | 用户在组织内的有效成员关系与邀请状态 |
| `OrganizationStudentProfile` | `membershipId`, `name`, `enrollmentYear`, `headTeacherMembershipId`, `rating` | 学生在单个校园内的独立档案 |
| `OrganizationTeacherProfile` | `membershipId`, `name`, `title`, `status` | 教师在单个校园内的独立档案 |
| `LoginLog` | `username`, `loginRole`, `userRole`, `result`, `ipAddress` | 登录审计 |
| `PasswordResetLog` | `operatorId`, `targetUserId`, `resetMethod`, `result` | 密码重置审计 |
| `UserStatusLog` | `operatorId`, `targetUserId`, `oldStatus`, `newStatus` | 状态变更审计 |
| `PrincipalTransferLog` | `schoolId`, `oldPrincipalTeacherId`, `newPrincipalTeacherId` | 负责人转移 |

## 团队与导入（8）

| 模型 | 关键字段 | 用途 |
|------|----------|------|
| `Team` | `id`, `name`, `schoolId`, `scope`, `isPublic` | 校园或个人团队 |
| `TeamMember` | `teamId`, `userId`, `userType`, `role`, `status` | 成员与团队角色 |
| `TeamJoinRequest` | `teamId`, `userId`, `status`, `processedBy` | 加入申请 |
| `TeamMemberExternalAccount` | `teamId`, `studentId`, `platform`, `platformUsername` | 成员外部账号 |
| `TeamMemberImportBatch` | `teamId`, `operatorId`, `platform`, count fields | 导入批次 |
| `TeamMemberImportItem` | `batchId`, source fields, match fields, `status` | 导入行 |
| `TeamOperationLog` | `teamId`, `operatorId`, `action`, target fields | 团队审计 |
| `UserNotification` | `userId`, `scope`, `type`, `sourceType`, `sourceId`, `readAt` | 当前工作区的用户通知 |

## 题目与题单（12）

| 模型 | 关键字段 | 用途 |
|------|----------|------|
| `Problem` | `id`, `libraryScope`, `libraryKey`, `schoolId`, `platform`, `problemId`, `status`, `ownerId`, `sourceProblemId` | 平台/学校隔离的题库题目 |
| `ProblemAttachment` | `problemId`, `fileName`, `fileUrl`, `fileSize` | 题目附件 |
| `ProblemStatement` | `problemId`, `type`, `format`, `language`, content/file | 多题面 |
| `ProblemNote` | `problemId`, `userId`, `content` | 用户题目笔记 |
| `TestdataFile` | `problemId`, `filename`, `size`, `md5` | 测试数据 |
| `UserArchivedProblem` | `userId`, `platform`, `problemId`, metadata | 用户归档题 |
| `ProblemList` | `id`, `title`, `ownerId`, `ownerType`, `scope`, `visibility` | 校园或个人题单 |
| `ProblemListSection` | `problemListId`, `title`, `sortOrder` | 题单章节 |
| `ProblemListEntry` | `sectionId`, `problemId`, `sortOrder`, `alias` | 题单条目 |
| `ProblemListShare` | `problemListId`, `targetType`, `targetId`, `permission` | 分享权限 |
| `SchoolProblemList` | `schoolId`, `problemListId`, `addedBy` | 学校题单 |
| `TeamProblemList` | `teamId`, `problemListId`, `addedBy` | 团队题单 |

## 训练与比赛（14）

| 模型 | 关键字段 | 用途 |
|------|----------|------|
| `Training` | `id`, `teamId`, `schoolId`, `scope`, `type`, time fields | 校园或个人训练/作业/比赛 |
| `TrainingProblem` | `trainingId`, `problemId`, `orderIndex`, `points` | 任务题目 |
| `TrainingAttachment` | `trainingProblemId`, `fileName`, `fileUrl` | 任务附件 |
| `TrainingParticipant` | `trainingId`, `userId`, `userType` | 参与者 |
| `TrainingSolution` | `trainingProblemId`, `content`, `visible` | 题解 |
| `TrainingUserProblemStatus` | `trainingId`, `userId`, `bestScore`, `bestResult` | 用户题目状态 |
| `Contest` | `id`, `title`, `teamId`, `status`, `type` | 历史比赛实体 |
| `ContestProblem` | `contestId`, `problemId`, `orderIndex`, `points` | 比赛题目 |
| `ContestProblemScore` | `contestId`, `problemId`, `studentId`, `score` | 单题成绩 |
| `ContestRecord` | `trainingId`, `userId`, `content` | 比赛记录 |
| `ContestResource` | `contestId`, `fileName`, `fileUrl` | 比赛资源 |
| `ContestResult` | `contestId`, `studentId`, `rank`, `score` | 比赛结果 |
| `ContestUserProblemStatus` | `contestId`, `userId`, `bestScore`, `bestResult` | 比赛题目状态 |
| `Milestone` | `studentId`, `teacherId`, `milestoneDate`, `type` | 成长里程碑 |

## 提交与外部 OJ（5）

| 模型 | 关键字段 | 用途 |
|------|----------|------|
| `Submission` | `id`, `userId`, `oj`, `problemId`, `result`, `workspaceScope` | 按工作区隔离的统一提交 |
| `OjAccount` | `platform`, `username`, encrypted password/cookie fields | 平台账号池 |
| `OjFetchJob` | `platform`, `problemId`, `status`, attachment fields | 抓题任务 |
| `OjPlatformConfig` | `platform`, encrypted `cookies`, timestamps | 全局平台配置 |
| `UserPlatformBinding` | `userId`, `platform`, `platformUsername`, `bindingStatus` | 用户绑定 |

## 文件、AI 与内部（3）

| 模型 | 关键字段 | 用途 |
|------|----------|------|
| `File` | storage/path/name, MIME, category, owner, access fields | 文件元数据 |
| `AiUsageLog` | `userId`, `problemId`, `action`, token/cost fields | AI 调用记录 |
| `carits_sequence` | `id`, `nextId` | Carits 数字序列 |

## 变更规则

- 不手写 SQL 表结构作为替代文档。
- 修改模型后同步 Prisma Client、测试 fixture、本页和数据迁移策略。
- 需要并发语义的功能必须在 PostgreSQL 上测试。
- `pnpm docs:check` 会比较本页模型名与 Schema，缺失或多余都会失败。
