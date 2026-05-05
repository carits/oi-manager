-- 统一用户身份 ID 迁移
-- 将 Teacher/Student/Admin 主键从 id 改为 userId
-- 所有关联表的 ID 字段改为指向 User.id

-- ============================================
-- Phase 1: 删除外键约束（避免迁移时约束冲突）
-- ============================================

-- TeamMember 外键
ALTER TABLE "TeamMember" DROP CONSTRAINT IF EXISTS "TeamMember_teamId_fkey";
ALTER TABLE "TeamMember" DROP CONSTRAINT IF EXISTS "TeamMember_userId_fkey";

-- Milestone 外键
ALTER TABLE "Milestone" DROP CONSTRAINT IF EXISTS "Milestone_studentId_fkey";
ALTER TABLE "Milestone" DROP CONSTRAINT IF EXISTS "Milestone_teacherId_fkey";

-- TeamJoinRequest 外键
ALTER TABLE "TeamJoinRequest" DROP CONSTRAINT IF EXISTS "TeamJoinRequest_teamId_fkey";
ALTER TABLE "TeamJoinRequest" DROP CONSTRAINT IF EXISTS "TeamJoinRequest_studentId_fkey";

-- ContestProblemNote 外键
ALTER TABLE "ContestProblemNote" DROP CONSTRAINT IF EXISTS "ContestProblemNote_studentId_fkey";

-- ContestProblemScore 外键
ALTER TABLE "ContestProblemScore" DROP CONSTRAINT IF EXISTS "ContestProblemScore_studentId_fkey";

-- ContestResult 外键
ALTER TABLE "ContestResult" DROP CONSTRAINT IF EXISTS "ContestResult_studentId_fkey";

-- TeamMemberExternalAccount 外键
ALTER TABLE "TeamMemberExternalAccount" DROP CONSTRAINT IF EXISTS "TeamMemberExternalAccount_studentId_fkey";

-- PrincipalTransferLog 外键
ALTER TABLE "PrincipalTransferLog" DROP CONSTRAINT IF EXISTS "PrincipalTransferLog_schoolId_fkey";
ALTER TABLE "PrincipalTransferLog" DROP CONSTRAINT IF EXISTS "PrincipalTransferLog_oldPrincipalTeacherId_fkey";
ALTER TABLE "PrincipalTransferLog" DROP CONSTRAINT IF EXISTS "PrincipalTransferLog_newPrincipalTeacherId_fkey";

-- School 外键
ALTER TABLE "School" DROP CONSTRAINT IF EXISTS "School_currentPrincipalTeacherId_fkey";

-- Student headTeacher 外键
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_headTeacherId_fkey";

-- Teacher/Admin/User 外键（ onDelete Cascade）
ALTER TABLE "Teacher" DROP CONSTRAINT IF EXISTS "Teacher_userId_fkey";
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_userId_fkey";
ALTER TABLE "Admin" DROP CONSTRAINT IF EXISTS "Admin_userId_fkey";

-- ============================================
-- Phase 2: 数据迁移 - 关联表 ID 转换
-- ============================================

-- TeamMember.userId: Teacher.id → User.id (通过 Teacher.userId)
UPDATE "TeamMember" tm
SET "userId" = t."userId"
FROM "Teacher" t
WHERE tm."userId" = t."id" AND tm."userType" = 'teacher';

-- TeamMember.userId: Student.id → User.id (通过 Student.userId)
UPDATE "TeamMember" tm
SET "userId" = s."userId"
FROM "Student" s
WHERE tm."userId" = s."id" AND tm."userType" = 'student';

-- Milestone.studentId → Student.userId → User.id
ALTER TABLE "Milestone" RENAME COLUMN "studentId" TO "studentUserId";
UPDATE "Milestone" m
SET "studentUserId" = s."userId"
FROM "Student" s
WHERE m."studentUserId" = s."id";

-- Milestone.teacherId → Teacher.userId → User.id
ALTER TABLE "Milestone" RENAME COLUMN "teacherId" TO "teacherUserId";
UPDATE "Milestone" m
SET "teacherUserId" = t."userId"
FROM "Teacher" t
WHERE m."teacherUserId" = t."id";

-- TeamJoinRequest.studentId → Student.userId → User.id
ALTER TABLE "TeamJoinRequest" RENAME COLUMN "studentId" TO "userId";
UPDATE "TeamJoinRequest" tjr
SET "userId" = s."userId"
FROM "Student" s
WHERE tjr."userId" = s."id";

-- ContestProblemNote.studentId → Student.userId → User.id
ALTER TABLE "ContestProblemNote" RENAME COLUMN "studentId" TO "studentUserId";
UPDATE "ContestProblemNote" cpn
SET "studentUserId" = s."userId"
FROM "Student" s
WHERE cpn."studentUserId" = s."id";

-- ContestProblemScore.studentId → Student.userId → User.id
ALTER TABLE "ContestProblemScore" RENAME COLUMN "studentId" TO "studentUserId";
UPDATE "ContestProblemScore" cps
SET "studentUserId" = s."userId"
FROM "Student" s
WHERE cps."studentUserId" = s."id";

-- ContestResult.studentId → Student.userId → User.id
ALTER TABLE "ContestResult" RENAME COLUMN "studentId" TO "studentUserId";
UPDATE "ContestResult" cr
SET "studentUserId" = s."userId"
FROM "Student" s
WHERE cr."studentUserId" = s."id";

-- TeamMemberExternalAccount.studentId → Student.userId → User.id
ALTER TABLE "TeamMemberExternalAccount" RENAME COLUMN "studentId" TO "studentUserId";
UPDATE "TeamMemberExternalAccount" tmea
SET "studentUserId" = s."userId"
FROM "Student" s
WHERE tmea."studentUserId" = s."id";

-- TeamMemberImportBatch.operatorId → User.id (假设存的是 User.id，无需转换)
ALTER TABLE "TeamMemberImportBatch" RENAME COLUMN "operatorId" TO "operatorUserId";

-- TeamMemberImportItem 字段重命名和数据迁移
ALTER TABLE "TeamMemberImportItem" RENAME COLUMN "matchedStudentId" TO "matchedStudentUserId";
UPDATE "TeamMemberImportItem" tmi
SET "matchedStudentUserId" = s."userId"
FROM "Student" s
WHERE tmi."matchedStudentUserId" = s."id";

ALTER TABLE "TeamMemberImportItem" RENAME COLUMN "createdStudentId" TO "createdStudentUserId";
UPDATE "TeamMemberImportItem" tmi
SET "createdStudentUserId" = s."userId"
FROM "Student" s
WHERE tmi."createdStudentUserId" = s."id";

-- TeamOperationLog.operatorId → User.id (通过 Teacher.userId 或 Student.userId)
ALTER TABLE "TeamOperationLog" RENAME COLUMN "operatorId" TO "operatorUserId";
UPDATE "TeamOperationLog" tol
SET "operatorUserId" = t."userId"
FROM "Teacher" t
WHERE tol."operatorUserId" = t."id" AND tol."operatorType" = 'teacher';

UPDATE "TeamOperationLog" tol
SET "operatorUserId" = s."userId"
FROM "Student" s
WHERE tol."operatorUserId" = s."id" AND tol."operatorType" = 'student';

-- TeamOperationLog.targetId → User.id (如果 targetType 是 teacher/student)
ALTER TABLE "TeamOperationLog" RENAME COLUMN "targetId" TO "targetUserId";
UPDATE "TeamOperationLog" tol
SET "targetUserId" = t."userId"
FROM "Teacher" t
WHERE tol."targetUserId" = t."id" AND tol."targetType" = 'teacher';

UPDATE "TeamOperationLog" tol
SET "targetUserId" = s."userId"
FROM "Student" s
WHERE tol."targetUserId" = s."id" AND tol."targetType" = 'student';

-- PrincipalTransferLog 字段重命名和数据迁移
ALTER TABLE "PrincipalTransferLog" RENAME COLUMN "oldPrincipalTeacherId" TO "oldPrincipalTeacherUserId";
UPDATE "PrincipalTransferLog" ptl
SET "oldPrincipalTeacherUserId" = t."userId"
FROM "Teacher" t
WHERE ptl."oldPrincipalTeacherUserId" = t."id";

ALTER TABLE "PrincipalTransferLog" RENAME COLUMN "newPrincipalTeacherId" TO "newPrincipalTeacherUserId";
UPDATE "PrincipalTransferLog" ptl
SET "newPrincipalTeacherUserId" = t."userId"
FROM "Teacher" t
WHERE ptl."newPrincipalTeacherUserId" = t."id";

-- School.currentPrincipalTeacherId → Teacher.userId → User.id
ALTER TABLE "School" RENAME COLUMN "currentPrincipalTeacherId" TO "currentPrincipalTeacherUserId";
UPDATE "School" sch
SET "currentPrincipalTeacherUserId" = t."userId"
FROM "Teacher" t
WHERE sch."currentPrincipalTeacherUserId" = t."id";

-- Student.headTeacherId → Teacher.userId → User.id
ALTER TABLE "Student" RENAME COLUMN "headTeacherId" TO "headTeacherUserId";
UPDATE "Student" stu
SET "headTeacherUserId" = t."userId"
FROM "Teacher" t
WHERE stu."headTeacherUserId" = t."id";

-- ============================================
-- Phase 3: 主键变更 - Teacher/Student/Admin
-- ============================================

-- Teacher: 删除旧主键，设置新主键
ALTER TABLE "Teacher" DROP CONSTRAINT "Teacher_pkey";
ALTER TABLE "Teacher" DROP COLUMN "id";
ALTER TABLE "Teacher" ADD PRIMARY KEY ("userId");

-- Student: 删除旧主键，设置新主键
ALTER TABLE "Student" DROP CONSTRAINT "Student_pkey";
ALTER TABLE "Student" DROP COLUMN "id";
ALTER TABLE "Student" ADD PRIMARY KEY ("userId");

-- Admin: 删除旧主键，设置新主键
ALTER TABLE "Admin" DROP CONSTRAINT "Admin_pkey";
ALTER TABLE "Admin" DROP COLUMN "id";
ALTER TABLE "Admin" ADD PRIMARY KEY ("userId");

-- ============================================
-- Phase 4: 更新唯一约束和索引
-- ============================================

-- 删除旧的唯一约束（userId @unique）
ALTER TABLE "Teacher" DROP CONSTRAINT IF EXISTS "Teacher_userId_key";
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_userId_key";
ALTER TABLE "Admin" DROP CONSTRAINT IF EXISTS "Admin_userId_key";

-- 更新索引（Prisma 会在 sync 时自动处理）
-- 这里只删除旧索引，新索引由 Prisma 创建

-- ============================================
-- Phase 5: 重建外键约束（Prisma db push 会自动处理）
-- ============================================

-- 注意：此迁移后需要运行 prisma db push 或 prisma generate
-- Prisma 会自动重建正确的外键约束