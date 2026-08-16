-- DropForeignKey
ALTER TABLE "Admin" DROP CONSTRAINT "Admin_id_fkey";

-- DropForeignKey
ALTER TABLE "Admin" DROP CONSTRAINT "Admin_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Admin" DROP CONSTRAINT "Admin_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "ContestProblemScore" DROP CONSTRAINT "ContestProblemScore_studentId_fkey";

-- DropForeignKey
ALTER TABLE "ContestResult" DROP CONSTRAINT "ContestResult_studentId_fkey";

-- DropForeignKey
ALTER TABLE "Milestone" DROP CONSTRAINT "Milestone_studentId_fkey";

-- DropForeignKey
ALTER TABLE "Milestone" DROP CONSTRAINT "Milestone_teacherId_fkey";

-- DropForeignKey
ALTER TABLE "PrincipalTransferLog" DROP CONSTRAINT "PrincipalTransferLog_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Problem" DROP CONSTRAINT "Problem_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Problem" DROP CONSTRAINT "Problem_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemList" DROP CONSTRAINT "ProblemList_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "School" DROP CONSTRAINT "School_currentPrincipalTeacherId_fkey";

-- DropForeignKey
ALTER TABLE "SchoolProblemList" DROP CONSTRAINT "SchoolProblemList_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Student" DROP CONSTRAINT "Student_headTeacherId_fkey";

-- DropForeignKey
ALTER TABLE "Student" DROP CONSTRAINT "Student_id_fkey";

-- DropForeignKey
ALTER TABLE "Student" DROP CONSTRAINT "Student_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Teacher" DROP CONSTRAINT "Teacher_id_fkey";

-- DropForeignKey
ALTER TABLE "Teacher" DROP CONSTRAINT "Teacher_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Team" DROP CONSTRAINT "Team_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Team" DROP CONSTRAINT "Team_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "TeamMemberExternalAccount" DROP CONSTRAINT "TeamMemberExternalAccount_studentId_fkey";

-- DropForeignKey
ALTER TABLE "Training" DROP CONSTRAINT "Training_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Training" DROP CONSTRAINT "Training_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_schoolId_fkey";

-- DropIndex
DROP INDEX "ContestProblemScore_contestId_problemId_studentId_key";

-- DropIndex
DROP INDEX "ContestResult_contestId_studentId_key";

-- DropIndex
DROP INDEX "ContestResult_studentId_idx";

-- DropIndex
DROP INDEX "Milestone_studentId_idx";

-- DropIndex
DROP INDEX "Milestone_teacherId_idx";

-- DropIndex
DROP INDEX "Problem_schoolId_status_idx";

-- DropIndex
DROP INDEX "ProblemList_schoolId_idx";

-- DropIndex
DROP INDEX "SchoolProblemList_schoolId_idx";

-- DropIndex
DROP INDEX "SchoolProblemList_schoolId_problemListId_key";

-- DropIndex
DROP INDEX "Team_schoolId_idx";

-- DropIndex
DROP INDEX "Team_schoolId_scope_isPublic_idx";

-- DropIndex
DROP INDEX "TeamMemberExternalAccount_studentId_idx";

-- DropIndex
DROP INDEX "Training_schoolId_idx";

-- DropIndex
DROP INDEX "Training_schoolId_status_idx";

-- DropIndex
DROP INDEX "User_schoolId_idx";

-- AlterTable
ALTER TABLE "ContestProblemScore" DROP COLUMN "studentId",
ALTER COLUMN "studentProfileId" SET NOT NULL,
ALTER COLUMN "studentNameSnapshot" SET NOT NULL,
ALTER COLUMN "usernameSnapshot" SET NOT NULL;

-- AlterTable
ALTER TABLE "ContestResult" DROP COLUMN "studentId",
ALTER COLUMN "studentProfileId" SET NOT NULL,
ALTER COLUMN "studentNameSnapshot" SET NOT NULL,
ALTER COLUMN "usernameSnapshot" SET NOT NULL;

-- AlterTable
ALTER TABLE "Milestone" DROP COLUMN "studentId",
DROP COLUMN "teacherId",
ALTER COLUMN "studentMembershipId" SET NOT NULL,
ALTER COLUMN "teacherMembershipId" SET NOT NULL,
ALTER COLUMN "studentNameSnapshot" SET NOT NULL,
ALTER COLUMN "teacherNameSnapshot" SET NOT NULL;

-- AlterTable
ALTER TABLE "Organization" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OrganizationMembership" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OrganizationStudentProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OrganizationTeacherProfile" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PrincipalTransferLog" DROP COLUMN "newPrincipalTeacherId",
DROP COLUMN "oldPrincipalTeacherId",
DROP COLUMN "schoolId",
ALTER COLUMN "organizationId" SET NOT NULL,
ALTER COLUMN "newPrincipalMembershipId" SET NOT NULL,
ALTER COLUMN "newPrincipalNameSnapshot" SET NOT NULL;

-- AlterTable
ALTER TABLE "Problem" DROP COLUMN "schoolId";

-- AlterTable
ALTER TABLE "ProblemList" DROP COLUMN "schoolId";

-- AlterTable
ALTER TABLE "School" DROP COLUMN "currentPrincipalTeacherId";

-- AlterTable
ALTER TABLE "SchoolProblemList" DROP COLUMN "schoolId",
ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Team" DROP COLUMN "schoolId";

-- AlterTable
ALTER TABLE "TeamMemberExternalAccount" DROP COLUMN "studentId";

-- AlterTable
ALTER TABLE "TeamMemberImportItem" DROP COLUMN "createdStudentId",
DROP COLUMN "matchedStudentId";

-- AlterTable
ALTER TABLE "Training" DROP COLUMN "schoolId";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "schoolId";

-- DropTable
DROP TABLE "Admin";

-- DropTable
DROP TABLE "Student";

-- DropTable
DROP TABLE "Teacher";

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblemScore_contestId_problemId_studentProfileId_key" ON "ContestProblemScore"("contestId", "problemId", "studentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestResult_contestId_studentProfileId_key" ON "ContestResult"("contestId", "studentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolProblemList_organizationId_problemListId_key" ON "SchoolProblemList"("organizationId", "problemListId");

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemList" ADD CONSTRAINT "ProblemList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Training" ADD CONSTRAINT "Training_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "OrganizationContributionAttribution_organizationId_createdAt_id" RENAME TO "OrganizationContributionAttribution_organizationId_createdA_idx";

