-- 将 Teacher/Student/Admin 主键从 userId 重命名为 id
-- 数据库当前处于混合状态：同时存在 userId 和 id 后缀的 FK
-- 需要先删除所有依赖 FK（包括新旧两种），重命名后重建

-- ============================================
-- Phase 1: 删除所有指向 Teacher/Student 的 FK 约束
-- ============================================

-- Milestone -> Teacher FKs (删除新旧两种)
ALTER TABLE "Milestone" DROP CONSTRAINT IF EXISTS "Milestone_teacherUserId_fkey";
ALTER TABLE "Milestone" DROP CONSTRAINT IF EXISTS "Milestone_teacherId_fkey";

-- Milestone -> Student FKs
ALTER TABLE "Milestone" DROP CONSTRAINT IF EXISTS "Milestone_studentUserId_fkey";
ALTER TABLE "Milestone" DROP CONSTRAINT IF EXISTS "Milestone_studentId_fkey";

-- School -> Teacher FK
ALTER TABLE "School" DROP CONSTRAINT IF EXISTS "School_currentPrincipalTeacherUserId_fkey";
ALTER TABLE "School" DROP CONSTRAINT IF EXISTS "School_currentPrincipalTeacherId_fkey";

-- Student -> Teacher FK (headTeacher)
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_headTeacherUserId_fkey";
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_headTeacherId_fkey";

-- ContestProblemNote -> Student FKs
ALTER TABLE "ContestProblemNote" DROP CONSTRAINT IF EXISTS "ContestProblemNote_studentUserId_fkey";
ALTER TABLE "ContestProblemNote" DROP CONSTRAINT IF EXISTS "ContestProblemNote_studentId_fkey";

-- ContestProblemScore -> Student FKs
ALTER TABLE "ContestProblemScore" DROP CONSTRAINT IF EXISTS "ContestProblemScore_studentUserId_fkey";
ALTER TABLE "ContestProblemScore" DROP CONSTRAINT IF EXISTS "ContestProblemScore_studentId_fkey";

-- ContestResult -> Student FKs
ALTER TABLE "ContestResult" DROP CONSTRAINT IF EXISTS "ContestResult_studentUserId_fkey";
ALTER TABLE "ContestResult" DROP CONSTRAINT IF EXISTS "ContestResult_studentId_fkey";

-- TeamJoinRequest -> Student FK
ALTER TABLE "TeamJoinRequest" DROP CONSTRAINT IF EXISTS "TeamJoinRequest_userId_fkey";

-- TeamMemberExternalAccount -> Student FKs
ALTER TABLE "TeamMemberExternalAccount" DROP CONSTRAINT IF EXISTS "TeamMemberExternalAccount_studentUserId_fkey";
ALTER TABLE "TeamMemberExternalAccount" DROP CONSTRAINT IF EXISTS "TeamMemberExternalAccount_studentId_fkey";

-- PrincipalTransferLog -> Teacher FKs
ALTER TABLE "PrincipalTransferLog" DROP CONSTRAINT IF EXISTS "PrincipalTransferLog_oldPrincipalTeacherUserId_fkey";
ALTER TABLE "PrincipalTransferLog" DROP CONSTRAINT IF EXISTS "PrincipalTransferLog_oldPrincipalTeacherId_fkey";
ALTER TABLE "PrincipalTransferLog" DROP CONSTRAINT IF EXISTS "PrincipalTransferLog_newPrincipalTeacherUserId_fkey";
ALTER TABLE "PrincipalTransferLog" DROP CONSTRAINT IF EXISTS "PrincipalTransferLog_newPrincipalTeacherId_fkey";

-- ============================================
-- Phase 2: 删除 Teacher/Student/Admin 到 User 的 FK
-- ============================================

ALTER TABLE "Teacher" DROP CONSTRAINT IF EXISTS "Teacher_userId_fkey";
ALTER TABLE "Teacher" DROP CONSTRAINT IF EXISTS "Teacher_id_fkey";
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_userId_fkey";
ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_id_fkey";
ALTER TABLE "Admin" DROP CONSTRAINT IF EXISTS "Admin_userId_fkey";
ALTER TABLE "Admin" DROP CONSTRAINT IF EXISTS "Admin_id_fkey";

-- ============================================
-- Phase 3: 重命名主键列 userId → id（如果需要）
-- ============================================

-- 先检查列是否存在，如果 userId 存在则重命名为 id
DO $$
BEGIN
    -- Teacher: 如果 userId 列存在，重命名为 id
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'Teacher' AND column_name = 'userId') THEN
        -- 先删除旧 PK（如果存在）
        EXECUTE 'ALTER TABLE "Teacher" DROP CONSTRAINT IF EXISTS "Teacher_pkey"';
        -- 重命名列
        EXECUTE 'ALTER TABLE "Teacher" RENAME COLUMN "userId" TO "id"';
        -- 设置新 PK
        EXECUTE 'ALTER TABLE "Teacher" ADD PRIMARY KEY ("id")';
    END IF;

    -- Student: 如果 userId 列存在，重命名为 id
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'Student' AND column_name = 'userId') THEN
        EXECUTE 'ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_pkey"';
        EXECUTE 'ALTER TABLE "Student" RENAME COLUMN "userId" TO "id"';
        EXECUTE 'ALTER TABLE "Student" ADD PRIMARY KEY ("id")';
    END IF;

    -- Admin: 如果 userId 列存在，重命名为 id
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'Admin' AND column_name = 'userId') THEN
        EXECUTE 'ALTER TABLE "Admin" DROP CONSTRAINT IF EXISTS "Admin_pkey"';
        EXECUTE 'ALTER TABLE "Admin" RENAME COLUMN "userId" TO "id"';
        EXECUTE 'ALTER TABLE "Admin" ADD PRIMARY KEY ("id")';
    END IF;
END $$;

-- ============================================
-- Phase 4: 重建 FK 约束
-- ============================================

-- Teacher → User FK
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_id_fkey"
  FOREIGN KEY ("id") REFERENCES "User"(id) ON DELETE CASCADE;

-- Student → User FK
ALTER TABLE "Student" ADD CONSTRAINT "Student_id_fkey"
  FOREIGN KEY ("id") REFERENCES "User"(id) ON DELETE CASCADE;

-- Admin → User FK（如果 Admin 表存在）
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Admin') THEN
        EXECUTE 'ALTER TABLE "Admin" ADD CONSTRAINT "Admin_id_fkey"
                  FOREIGN KEY ("id") REFERENCES "User"(id) ON DELETE CASCADE';
    END IF;
END $$;

-- Milestone FKs
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

-- TeamJoinRequest FK (userId 存 Student.id，不是 User.id)
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Student"(id) ON DELETE CASCADE;

-- TeamMemberExternalAccount FK
ALTER TABLE "TeamMemberExternalAccount" ADD CONSTRAINT "TeamMemberExternalAccount_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"(id);

-- PrincipalTransferLog FKs
ALTER TABLE "PrincipalTransferLog" ADD CONSTRAINT "PrincipalTransferLog_oldPrincipalTeacherId_fkey"
  FOREIGN KEY ("oldPrincipalTeacherId") REFERENCES "Teacher"(id);
ALTER TABLE "PrincipalTransferLog" ADD CONSTRAINT "PrincipalTransferLog_newPrincipalTeacherId_fkey"
  FOREIGN KEY ("newPrincipalTeacherId") REFERENCES "Teacher"(id);