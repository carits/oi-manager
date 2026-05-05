-- 将 Teacher/Student/Admin 主键从 userId 改为 id
-- 数据库当前状态：Teacher/Student/Admin 的主键是 userId
-- 目标状态：主键改为 id，值等于 User.id

-- ============================================
-- Phase 1: 添加新主键列 id
-- ============================================

-- Teacher: 添加 id 列，值等于 userId
ALTER TABLE "Teacher" ADD COLUMN "id" TEXT;
UPDATE "Teacher" SET "id" = "userId";
ALTER TABLE "Teacher" ALTER COLUMN "id" SET NOT NULL;

-- Student: 添加 id 列，值等于 userId
ALTER TABLE "Student" ADD COLUMN "id" TEXT;
UPDATE "Student" SET "id" = "userId";
ALTER TABLE "Student" ALTER COLUMN "id" SET NOT NULL;

-- Admin: 添加 id 列，值等于 userId
ALTER TABLE "Admin" ADD COLUMN "id" TEXT;
UPDATE "Admin" SET "id" = "userId";
ALTER TABLE "Admin" ALTER COLUMN "id" SET NOT NULL;

-- ============================================
-- Phase 2: 删除旧主键约束，设置新主键
-- ============================================

-- Teacher
ALTER TABLE "Teacher" DROP CONSTRAINT "Teacher_pkey";
ALTER TABLE "Teacher" ADD PRIMARY KEY ("id");
ALTER TABLE "Teacher" DROP COLUMN "userId";

-- Student
ALTER TABLE "Student" DROP CONSTRAINT "Student_pkey";
ALTER TABLE "Student" ADD PRIMARY KEY ("id");
ALTER TABLE "Student" DROP COLUMN "userId";

-- Admin
ALTER TABLE "Admin" DROP CONSTRAINT "Admin_pkey";
ALTER TABLE "Admin" ADD PRIMARY KEY ("id");
ALTER TABLE "Admin" DROP COLUMN "userId";

-- ============================================
-- Phase 3: 更新关联表字段名
-- ============================================

-- School.currentPrincipalTeacherUserId → currentPrincipalTeacherId
ALTER TABLE "School" RENAME COLUMN "currentPrincipalTeacherUserId" TO "currentPrincipalTeacherId";

-- Student.headTeacherUserId → headTeacherId
ALTER TABLE "Student" RENAME COLUMN "headTeacherUserId" TO "headTeacherId";

-- Milestone.studentUserId → studentId, teacherUserId → teacherId
ALTER TABLE "Milestone" RENAME COLUMN "studentUserId" TO "studentId";
ALTER TABLE "Milestone" RENAME COLUMN "teacherUserId" TO "teacherId";

-- ContestResult.studentUserId → studentId
ALTER TABLE "ContestResult" RENAME COLUMN "studentUserId" TO "studentId";

-- ContestProblemNote.studentUserId → studentId
ALTER TABLE "ContestProblemNote" RENAME COLUMN "studentUserId" TO "studentId";

-- ContestProblemScore.studentUserId → studentId
ALTER TABLE "ContestProblemScore" RENAME COLUMN "studentUserId" TO "studentId";

-- TeamMemberExternalAccount.studentUserId → studentId
ALTER TABLE "TeamMemberExternalAccount" RENAME COLUMN "studentUserId" TO "studentId";

-- TeamMemberImportItem.matchedStudentUserId → matchedStudentId, createdStudentUserId → createdStudentId
ALTER TABLE "TeamMemberImportItem" RENAME COLUMN "matchedStudentUserId" TO "matchedStudentId";
ALTER TABLE "TeamMemberImportItem" RENAME COLUMN "createdStudentUserId" TO "createdStudentId";

-- TeamMemberImportBatch.operatorUserId → operatorId
ALTER TABLE "TeamMemberImportBatch" RENAME COLUMN "operatorUserId" TO "operatorId";

-- TeamOperationLog.operatorUserId → operatorId, targetUserId → targetId
ALTER TABLE "TeamOperationLog" RENAME COLUMN "operatorUserId" TO "operatorId";
ALTER TABLE "TeamOperationLog" RENAME COLUMN "targetUserId" TO "targetId";

-- PrincipalTransferLog.oldPrincipalTeacherUserId → oldPrincipalTeacherId, newPrincipalTeacherUserId → newPrincipalTeacherId
ALTER TABLE "PrincipalTransferLog" RENAME COLUMN "oldPrincipalTeacherUserId" TO "oldPrincipalTeacherId";
ALTER TABLE "PrincipalTransferLog" RENAME COLUMN "newPrincipalTeacherUserId" TO "newPrincipalTeacherId";

-- TeamJoinRequest 已经是 userId（存 User.id），保持不变
-- TeamMember 已经是 userId（存 User.id），保持不变
