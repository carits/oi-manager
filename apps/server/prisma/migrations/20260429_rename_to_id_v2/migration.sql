-- 将 Teacher/Student/Admin 主键从 userId 重命名为 id
-- 需要先删除所有依赖 FK，重命名后重建

-- ============================================
-- Phase 1: 删除所有依赖 FK 约束
-- ============================================

-- 删除指向 Teacher.userId 的 FK
ALTER TABLE "Milestone" DROP CONSTRAINT IF EXISTS "Milestone_teacherId_fkey";
ALTER TABLE "School" DROP CONSTRAINT IF EXISTS "School_currentPrincipalTeacherId_fkey";
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_headTeacherId_fkey";
ALTER TABLE "PrincipalTransferLog" DROP CONSTRAINT IF EXISTS "PrincipalTransferLog_oldPrincipalTeacherId_fkey";
ALTER TABLE "PrincipalTransferLog" DROP CONSTRAINT IF EXISTS "PrincipalTransferLog_newPrincipalTeacherId_fkey";

-- 删除指向 Student.userId 的 FK
ALTER TABLE "ContestProblemNote" DROP CONSTRAINT IF EXISTS "ContestProblemNote_studentId_fkey";
ALTER TABLE "ContestProblemScore" DROP CONSTRAINT IF EXISTS "ContestProblemScore_studentId_fkey";
ALTER TABLE "ContestResult" DROP CONSTRAINT IF EXISTS "ContestResult_studentId_fkey";
ALTER TABLE "Milestone" DROP CONSTRAINT IF EXISTS "Milestone_studentId_fkey";
ALTER TABLE "TeamJoinRequest" DROP CONSTRAINT IF EXISTS "TeamJoinRequest_userId_fkey";
ALTER TABLE "TeamMemberExternalAccount" DROP CONSTRAINT IF EXISTS "TeamMemberExternalAccount_studentId_fkey";

-- 删除指向 Admin.userId 的 FK (无)

-- 删除 Teacher/Student/Admin 到 User 的 FK
ALTER TABLE "Teacher" DROP CONSTRAINT IF EXISTS "Teacher_userId_fkey";
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_userId_fkey";
ALTER TABLE "Admin" DROP CONSTRAINT IF EXISTS "Admin_userId_fkey";

-- ============================================
-- Phase 2: 重命名主键列 userId → id
-- ============================================

-- Teacher: 重命名 userId → id
ALTER TABLE "Teacher" DROP CONSTRAINT "Teacher_pkey";
ALTER TABLE "Teacher" RENAME COLUMN "userId" TO "id";
ALTER TABLE "Teacher" ADD PRIMARY KEY ("id");

-- Student: 重命名 userId → id
ALTER TABLE "Student" DROP CONSTRAINT "Student_pkey";
ALTER TABLE "Student" RENAME COLUMN "userId" TO "id";
ALTER TABLE "Student" ADD PRIMARY KEY ("id");

-- Admin: 重命名 userId → id
ALTER TABLE "Admin" DROP CONSTRAINT "Admin_pkey";
ALTER TABLE "Admin" RENAME COLUMN "userId" TO "id";
ALTER TABLE "Admin" ADD PRIMARY KEY ("id");

-- ============================================
-- Phase 3: 重建 FK 约束
-- ============================================

-- Teacher → User FK
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_id_fkey"
  FOREIGN KEY ("id") REFERENCES "User"(id) ON DELETE CASCADE;

-- Student → User FK
ALTER TABLE "Student" ADD CONSTRAINT "Student_id_fkey"
  FOREIGN KEY ("id") REFERENCES "User"(id) ON DELETE CASCADE;

-- Admin → User FK
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_id_fkey"
  FOREIGN KEY ("id") REFERENCES "User"(id) ON DELETE CASCADE;

-- Milestone FK
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON DELETE CASCADE;
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_teacherId_fkey"
  FOREIGN KEY ("teacherId") REFERENCES "Teacher"(id);

-- School principal FK
ALTER TABLE "School" ADD CONSTRAINT "School_currentPrincipalTeacherId_fkey"
  FOREIGN KEY ("currentPrincipalTeacherId") REFERENCES "Teacher"(id);

-- Student headTeacher FK
ALTER TABLE "Student" ADD CONSTRAINT "Student_headTeacherId_fkey"
  FOREIGN KEY ("headTeacherId") REFERENCES "Teacher"(id);

-- ContestProblemNote FK
ALTER TABLE "ContestProblemNote" ADD CONSTRAINT "ContestProblemNote_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON DELETE CASCADE;

-- ContestProblemScore FK
ALTER TABLE "ContestProblemScore" ADD CONSTRAINT "ContestProblemScore_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON DELETE CASCADE;

-- ContestResult FK
ALTER TABLE "ContestResult" ADD CONSTRAINT "ContestResult_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"(id) ON DELETE CASCADE;

-- TeamJoinRequest FK (userId 存 User.id，不是 Student.id，保持不变)
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Student"(id) ON DELETE CASCADE;

-- TeamMemberExternalAccount FK
ALTER TABLE "TeamMemberExternalAccount" ADD CONSTRAINT "TeamMemberExternalAccount_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"(id);

-- PrincipalTransferLog FK
ALTER TABLE "PrincipalTransferLog" ADD CONSTRAINT "PrincipalTransferLog_oldPrincipalTeacherId_fkey"
  FOREIGN KEY ("oldPrincipalTeacherId") REFERENCES "Teacher"(id);
ALTER TABLE "PrincipalTransferLog" ADD CONSTRAINT "PrincipalTransferLog_newPrincipalTeacherId_fkey"
  FOREIGN KEY ("newPrincipalTeacherId") REFERENCES "Teacher"(id);