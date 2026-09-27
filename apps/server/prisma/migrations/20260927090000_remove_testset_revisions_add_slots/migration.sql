-- CreateEnum
CREATE TYPE "ProblemTestSetSlotKind" AS ENUM ('STABLE', 'EVOLVING');

-- CreateEnum
CREATE TYPE "ProblemTestSetReaderStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProblemTestSetWriterStatus" AS ENUM ('QUEUED', 'DRAINING', 'APPLYING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- Remove historical references to deleted TestSet revisions.
DELETE FROM "BlogReference" WHERE "referenceType"::text = 'PROBLEM_REVISION';

ALTER TABLE "BlogReference"
DROP CONSTRAINT IF EXISTS "BlogReference_target_shape_check";

-- AlterEnum
BEGIN;
CREATE TYPE "BlogReferenceType_new" AS ENUM ('PROBLEM', 'SOLUTION_VERSION', 'CONTEST_STANDING', 'RATING_CHANGE', 'SUBMISSION_SNAPSHOT');
ALTER TABLE "BlogReference" ALTER COLUMN "referenceType" TYPE "BlogReferenceType_new" USING ("referenceType"::text::"BlogReferenceType_new");
ALTER TYPE "BlogReferenceType" RENAME TO "BlogReferenceType_old";
ALTER TYPE "BlogReferenceType_new" RENAME TO "BlogReferenceType";
DROP TYPE "BlogReferenceType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "ContestProblem" DROP CONSTRAINT "ContestProblem_testSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "Problem" DROP CONSTRAINT "Problem_latestTestSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemHackAttempt" DROP CONSTRAINT "ProblemHackAttempt_baseTestSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemHackAttempt" DROP CONSTRAINT "ProblemHackAttempt_promotedRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "TestcaseCandidate" DROP CONSTRAINT "TestcaseCandidate_baseTestSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "TestcaseCandidate" DROP CONSTRAINT "TestcaseCandidate_promotedRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "QualityEvaluationJob" DROP CONSTRAINT "QualityEvaluationJob_revisionId_fkey";

-- DropForeignKey
ALTER TABLE "TestSetQualitySnapshot" DROP CONSTRAINT "TestSetQualitySnapshot_revisionId_fkey";

-- DropForeignKey
ALTER TABLE "DataProduct" DROP CONSTRAINT "DataProduct_revisionId_fkey";

-- DropForeignKey
ALTER TABLE "DataPurchase" DROP CONSTRAINT "DataPurchase_purchasedRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "DataEntitlementRevision" DROP CONSTRAINT "DataEntitlementRevision_entitlementId_fkey";

-- DropForeignKey
ALTER TABLE "DataEntitlementRevision" DROP CONSTRAINT "DataEntitlementRevision_dataProductId_fkey";

-- DropForeignKey
ALTER TABLE "DataEntitlementRevision" DROP CONSTRAINT "DataEntitlementRevision_testSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "DataEntitlementRevision" DROP CONSTRAINT "DataEntitlementRevision_qualitySnapshotId_fkey";

-- DropForeignKey
ALTER TABLE "DataEntitlementRevision" DROP CONSTRAINT "DataEntitlementRevision_sourceIncidentId_fkey";

-- DropForeignKey
ALTER TABLE "TestSetQualityIncident" DROP CONSTRAINT "TestSetQualityIncident_revisionId_fkey";

-- DropForeignKey
ALTER TABLE "TestSetQualityIncident" DROP CONSTRAINT "TestSetQualityIncident_fixedByRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "SolutionContribution" DROP CONSTRAINT "SolutionContribution_targetTestSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "SolutionContributionRevision" DROP CONSTRAINT "SolutionContributionRevision_targetTestSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "SolutionVerification" DROP CONSTRAINT "SolutionVerification_verifiedTestSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemSolutionVersion" DROP CONSTRAINT "ProblemSolutionVersion_verifiedTestSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "JudgeRun" DROP CONSTRAINT "JudgeRun_testSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_testSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevision" DROP CONSTRAINT "ProblemTestSetRevision_problemId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevision" DROP CONSTRAINT "ProblemTestSetRevision_parentRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionCase" DROP CONSTRAINT "ProblemTestSetRevisionCase_revisionId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionCase" DROP CONSTRAINT "ProblemTestSetRevisionCase_testcaseId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionCase" DROP CONSTRAINT "ProblemTestSetRevisionCase_inputObjectId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionCase" DROP CONSTRAINT "ProblemTestSetRevisionCase_outputObjectId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionSubtask" DROP CONSTRAINT "ProblemTestSetRevisionSubtask_revisionId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionDependency" DROP CONSTRAINT "ProblemTestSetRevisionDependency_subtaskId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionDependency" DROP CONSTRAINT "ProblemTestSetRevisionDependency_dependsOnId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionGroup" DROP CONSTRAINT "ProblemTestSetRevisionGroup_revisionId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionGroup" DROP CONSTRAINT "ProblemTestSetRevisionGroup_subtaskId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionGroupCase" DROP CONSTRAINT "ProblemTestSetRevisionGroupCase_revisionId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionGroupCase" DROP CONSTRAINT "ProblemTestSetRevisionGroupCase_groupId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionGroupCase" DROP CONSTRAINT "ProblemTestSetRevisionGroupCase_testcaseId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionGroupCase" DROP CONSTRAINT "ProblemTestSetRevisionGroupCase_inputObjectId_fkey";

-- DropForeignKey
ALTER TABLE "ProblemTestSetRevisionGroupCase" DROP CONSTRAINT "ProblemTestSetRevisionGroupCase_outputObjectId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStageProblem" DROP CONSTRAINT "TrainingSessionStageProblem_testSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "AssignmentProblem" DROP CONSTRAINT "AssignmentProblem_testSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "BlogReference" DROP CONSTRAINT "BlogReference_problemRevisionId_fkey";

-- DropIndex
DROP INDEX "ContestProblem_testSetRevisionId_idx";

-- DropIndex
DROP INDEX "Problem_latestTestSetRevisionId_idx";

-- DropIndex
DROP INDEX "ProblemHackAttempt_baseTestSetRevisionId_idx";

-- DropIndex
DROP INDEX "ProblemHackAttempt_promotedRevisionId_idx";

-- DropIndex
DROP INDEX "TestcaseCandidate_baseTestSetRevisionId_idx";

-- DropIndex
DROP INDEX "TestcaseCandidate_promotedRevisionId_idx";

-- DropIndex
DROP INDEX "QualityEvaluationJob_revisionId_qualityRuleVersion_idx";

-- DropIndex
DROP INDEX "TestSetQualitySnapshot_revisionId_qualityRuleVersion_corpus_key";

-- DropIndex
DROP INDEX "DataProduct_revisionId_status_idx";

-- DropIndex
DROP INDEX "DataProduct_revisionId_qualitySnapshotId_updatePolicy_key";

-- DropIndex
DROP INDEX "DataPurchase_purchasedRevisionId_idx";

-- DropIndex
DROP INDEX "TestSetQualityIncident_revisionId_status_idx";

-- DropIndex
DROP INDEX "TestSetQualityIncident_fixedByRevisionId_idx";

-- DropIndex
DROP INDEX "CanonicalSelectionRun_promotedRevisionId_idx";

-- DropIndex
DROP INDEX "SolutionContribution_targetTestSetRevisionId_idx";

-- DropIndex
DROP INDEX "SolutionContributionRevision_targetTestSetRevisionId_idx";

-- DropIndex
DROP INDEX "SolutionVerification_verifiedTestSetRevisionId_idx";

-- DropIndex
DROP INDEX "ProblemSolutionVersion_verifiedTestSetRevisionId_idx";

-- DropIndex
DROP INDEX "JudgeRun_testSetRevisionId_idx";

-- DropIndex
DROP INDEX "Submission_testSetRevisionId_idx";

-- DropIndex
DROP INDEX "TestcaseMembershipRetirement_fromRevisionId_toRevisionId_idx";

-- DropIndex
DROP INDEX "TrainingSessionStageProblem_testSetRevisionId_idx";

-- DropIndex
DROP INDEX "AssignmentProblem_testSetRevisionId_idx";

-- DropIndex
DROP INDEX "BlogReference_problemRevisionId_idx";


-- AlterTable
ALTER TABLE "ContestProblem"
ADD COLUMN     "testSetFencingToken" INTEGER,
ADD COLUMN     "testSetGraphHash" TEXT,
ADD COLUMN     "testSetJudgeConfigHash" TEXT,
ADD COLUMN     "testSetReaderId" TEXT,
ADD COLUMN     "testSetSlot" "ProblemTestSetSlotKind" NOT NULL DEFAULT 'STABLE';

-- AlterTable
ALTER TABLE "Problem"
ADD COLUMN     "dataContributionEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProblemDataGenerationJob"
ADD COLUMN     "baseTestSetFencingToken" INTEGER,
ADD COLUMN     "baseTestSetGraphHash" TEXT,
ADD COLUMN     "expectedEvolvingFence" INTEGER,
ADD COLUMN     "promotedGraphHash" TEXT,
ADD COLUMN     "testSetReaderId" TEXT;

-- AlterTable
ALTER TABLE "ProblemHackAttempt"
ADD COLUMN     "baseFencingToken" INTEGER,
ADD COLUMN     "baseGraphHash" TEXT,
ADD COLUMN     "baseSlot" "ProblemTestSetSlotKind" NOT NULL DEFAULT 'EVOLVING',
ADD COLUMN     "promotedGraphHash" TEXT,
ADD COLUMN     "testSetReaderId" TEXT;

-- AlterTable
ALTER TABLE "TestcaseCandidate"
ADD COLUMN     "baseFencingToken" INTEGER,
ADD COLUMN     "baseGraphHash" TEXT,
ADD COLUMN     "baseSlot" "ProblemTestSetSlotKind" NOT NULL DEFAULT 'EVOLVING',
ADD COLUMN     "promotedGraphHash" TEXT;

-- AlterTable
ALTER TABLE "QualityEvaluationJob"
ADD COLUMN     "graphHash" TEXT,
ADD COLUMN     "slot" "ProblemTestSetSlotKind",
ADD COLUMN     "testSetReaderId" TEXT;

-- AlterTable
ALTER TABLE "TestSetQualitySnapshot"
ADD COLUMN     "graphHash" TEXT,
ADD COLUMN     "slot" "ProblemTestSetSlotKind",
ADD COLUMN     "testSetAgeDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DataProduct"
ADD COLUMN     "graphHash" TEXT,
ADD COLUMN     "slot" "ProblemTestSetSlotKind" NOT NULL DEFAULT 'STABLE';

-- AlterTable
ALTER TABLE "DataPurchase"
ADD COLUMN     "purchasedGraphHash" TEXT;

-- AlterTable
ALTER TABLE "DataEntitlement"
ADD COLUMN     "problemId" TEXT;

-- AlterTable
ALTER TABLE "TestSetQualityIncident"
ADD COLUMN     "affectedGraphHash" TEXT,
ADD COLUMN     "fixedByGraphHash" TEXT,
ADD COLUMN     "slot" "ProblemTestSetSlotKind";

-- AlterTable
ALTER TABLE "CandidateEvaluationRun"
ADD COLUMN     "testSetReaderId" TEXT;

-- AlterTable
ALTER TABLE "CanonicalSelectionRun"
ADD COLUMN     "baseGraphHash" TEXT,
ADD COLUMN     "promotedGraphHash" TEXT;

-- AlterTable
ALTER TABLE "SolutionContribution"
ADD COLUMN     "targetTestSetGraphHash" TEXT,
ADD COLUMN     "targetTestSetSlot" "ProblemTestSetSlotKind" NOT NULL DEFAULT 'STABLE';

-- AlterTable
ALTER TABLE "SolutionContributionRevision"
ADD COLUMN     "targetTestSetGraphHash" TEXT,
ADD COLUMN     "targetTestSetSlot" "ProblemTestSetSlotKind" NOT NULL DEFAULT 'STABLE';

-- AlterTable
ALTER TABLE "SolutionVerification"
ADD COLUMN     "verifiedTestSetGraphHash" TEXT,
ADD COLUMN     "verifiedTestSetSlot" "ProblemTestSetSlotKind" NOT NULL DEFAULT 'STABLE';

-- AlterTable
ALTER TABLE "ProblemSolutionVersion"
ADD COLUMN     "verifiedTestSetGraphHash" TEXT,
ADD COLUMN     "verifiedTestSetSlot" "ProblemTestSetSlotKind" NOT NULL DEFAULT 'STABLE';

-- AlterTable
ALTER TABLE "JudgeRun"
ADD COLUMN     "testSetFencingToken" INTEGER,
ADD COLUMN     "testSetGraphHash" TEXT,
ADD COLUMN     "testSetReaderId" TEXT,
ADD COLUMN     "testSetSlot" "ProblemTestSetSlotKind";

-- AlterTable
ALTER TABLE "Submission"
ADD COLUMN     "testSetFencingToken" INTEGER,
ADD COLUMN     "testSetGraphHash" TEXT,
ADD COLUMN     "testSetSlot" "ProblemTestSetSlotKind";

-- AlterTable
ALTER TABLE "TestcaseMembershipRetirement"
ADD COLUMN     "fromGraphHash" TEXT,
ADD COLUMN     "toGraphHash" TEXT;

-- CreateTable
CREATE TABLE "ProblemTestSetSlot" (
    "problemId" TEXT NOT NULL,
    "slot" "ProblemTestSetSlotKind" NOT NULL,
    "mode" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "judgeConfig" TEXT NOT NULL,
    "judgeConfigHash" TEXT NOT NULL,
    "graphHash" TEXT NOT NULL,
    "materializedPath" TEXT NOT NULL,
    "fencingToken" INTEGER NOT NULL DEFAULT 1,
    "writerGateClosed" BOOLEAN NOT NULL DEFAULT false,
    "activeReaderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemTestSetSlot_pkey" PRIMARY KEY ("problemId","slot")
);

-- CreateTable
CREATE TABLE "ProblemTestSetSlotCase" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "slot" "ProblemTestSetSlotKind" NOT NULL,
    "testcaseId" TEXT,
    "inputObjectId" TEXT NOT NULL,
    "outputObjectId" TEXT NOT NULL,
    "inputName" TEXT NOT NULL,
    "outputName" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "score" INTEGER,
    "time" TEXT,
    "memory" TEXT,
    "source" TEXT NOT NULL DEFAULT 'official',

    CONSTRAINT "ProblemTestSetSlotCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemTestSetSlotSubtask" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "slot" "ProblemTestSetSlotKind" NOT NULL,
    "subtaskId" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "ProblemTestSetSlotSubtask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemTestSetSlotDependency" (
    "id" TEXT NOT NULL,
    "subtaskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    CONSTRAINT "ProblemTestSetSlotDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemTestSetSlotGroup" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "slot" "ProblemTestSetSlotKind" NOT NULL,
    "subtaskId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "aggregation" TEXT NOT NULL DEFAULT 'min',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProblemTestSetSlotGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemTestSetSlotGroupCase" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "slot" "ProblemTestSetSlotKind" NOT NULL,
    "groupId" TEXT NOT NULL,
    "testcaseId" TEXT,
    "inputObjectId" TEXT NOT NULL,
    "outputObjectId" TEXT NOT NULL,
    "inputName" TEXT NOT NULL,
    "outputName" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER,
    "time" TEXT,
    "memory" TEXT,
    "source" TEXT NOT NULL DEFAULT 'official',

    CONSTRAINT "ProblemTestSetSlotGroupCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemTestSetReader" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "slot" "ProblemTestSetSlotKind" NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "ProblemTestSetReaderStatus" NOT NULL DEFAULT 'ACTIVE',
    "fencingToken" INTEGER NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "ProblemTestSetReader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemTestSetWriter" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "slot" "ProblemTestSetSlotKind" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "requestedBy" TEXT,
    "requestHash" TEXT NOT NULL,
    "status" "ProblemTestSetWriterStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "stagingPath" TEXT,

    CONSTRAINT "ProblemTestSetWriter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemTestSetPromotionJob" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "evolvingGraphHash" TEXT NOT NULL,
    "evolvingFencingToken" INTEGER NOT NULL,
    "validationReport" JSONB,
    "validatorPassed" BOOLEAN,
    "standardPassed" BOOLEAN,
    "acceptedReplayPassed" BOOLEAN,
    "knownWrongReplaySummary" JSONB,
    "requestedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemTestSetPromotionJob_pkey" PRIMARY KEY ("id")
);



DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "JudgeRun" WHERE "status" IN ('QUEUED','RUNNING')) THEN
    RAISE EXCEPTION 'TESTSET_SLOT_MIGRATION_ACTIVE_JUDGE_RUNS';
  END IF;
  IF EXISTS (SELECT 1 FROM "Contest" WHERE lower("status") IN ('running','paused')) THEN
    RAISE EXCEPTION 'TESTSET_SLOT_MIGRATION_ACTIVE_CONTESTS';
  END IF;
END $$;

UPDATE "Problem" p SET "dataContributionEnabled"=true
WHERE EXISTS (SELECT 1 FROM "ProblemHackConfig" h WHERE h."problemId"=p."id" AND h."enabled"=true)
   OR EXISTS (SELECT 1 FROM "ProblemCandidatePolicy" c WHERE c."problemId"=p."id")
   OR EXISTS (SELECT 1 FROM "TestcaseCandidate" c WHERE c."problemId"=p."id")
   OR EXISTS (SELECT 1 FROM "ProblemHackAttempt" h WHERE h."problemId"=p."id");

INSERT INTO "ProblemTestSetSlot" ("problemId","slot","mode","source","judgeConfig","judgeConfigHash","graphHash","materializedPath","fencingToken","writerGateClosed","activeReaderCount","createdAt","updatedAt")
SELECT r."problemId",'STABLE',r."mode",r."source",r."judgeConfig",r."judgeConfigHash",r."graphHash",'slots/stable',1,false,0,r."createdAt",CURRENT_TIMESTAMP
FROM "ProblemTestSetRevision" r JOIN "Problem" p ON p."latestTestSetRevisionId"=r."id";
INSERT INTO "ProblemTestSetSlot" ("problemId","slot","mode","source","judgeConfig","judgeConfigHash","graphHash","materializedPath","fencingToken","writerGateClosed","activeReaderCount","createdAt","updatedAt")
SELECT r."problemId",'EVOLVING',r."mode",r."source",r."judgeConfig",r."judgeConfigHash",r."graphHash",'slots/evolving',1,false,0,r."createdAt",CURRENT_TIMESTAMP
FROM "ProblemTestSetRevision" r JOIN "Problem" p ON p."latestTestSetRevisionId"=r."id" WHERE p."dataContributionEnabled";

INSERT INTO "ProblemTestSetSlotCase" ("id","problemId","slot","testcaseId","inputObjectId","outputObjectId","inputName","outputName","orderIndex","score","time","memory","source")
SELECT md5(c."id"||':'||s."slot"::text),s."problemId",s."slot",c."testcaseId",c."inputObjectId",c."outputObjectId",c."inputName",c."outputName",c."orderIndex",c."score",c."time",c."memory",c."source"
FROM "ProblemTestSetSlot" s JOIN "Problem" p ON p."id"=s."problemId" JOIN "ProblemTestSetRevisionCase" c ON c."revisionId"=p."latestTestSetRevisionId";
INSERT INTO "ProblemTestSetSlotSubtask" ("id","problemId","slot","subtaskId","score","orderIndex")
SELECT md5(st."id"||':'||s."slot"::text),s."problemId",s."slot",st."subtaskId",st."score",st."orderIndex"
FROM "ProblemTestSetSlot" s JOIN "Problem" p ON p."id"=s."problemId" JOIN "ProblemTestSetRevisionSubtask" st ON st."revisionId"=p."latestTestSetRevisionId";
INSERT INTO "ProblemTestSetSlotDependency" ("id","subtaskId","dependsOnId")
SELECT md5(d."id"||':'||s."slot"::text),md5(d."subtaskId"||':'||s."slot"::text),md5(d."dependsOnId"||':'||s."slot"::text)
FROM "ProblemTestSetSlot" s JOIN "Problem" p ON p."id"=s."problemId" JOIN "ProblemTestSetRevisionSubtask" st ON st."revisionId"=p."latestTestSetRevisionId" JOIN "ProblemTestSetRevisionDependency" d ON d."subtaskId"=st."id";
INSERT INTO "ProblemTestSetSlotGroup" ("id","problemId","slot","subtaskId","key","name","kind","score","aggregation","orderIndex")
SELECT md5(g."id"||':'||s."slot"::text),s."problemId",s."slot",md5(g."subtaskId"||':'||s."slot"::text),g."key",g."name",g."kind",g."score",g."aggregation",g."orderIndex"
FROM "ProblemTestSetSlot" s JOIN "Problem" p ON p."id"=s."problemId" JOIN "ProblemTestSetRevisionGroup" g ON g."revisionId"=p."latestTestSetRevisionId";
INSERT INTO "ProblemTestSetSlotGroupCase" ("id","problemId","slot","groupId","testcaseId","inputObjectId","outputObjectId","inputName","outputName","orderIndex","score","time","memory","source")
SELECT md5(gc."id"||':'||s."slot"::text),s."problemId",s."slot",md5(gc."groupId"||':'||s."slot"::text),gc."testcaseId",gc."inputObjectId",gc."outputObjectId",gc."inputName",gc."outputName",gc."orderIndex",gc."score",gc."time",gc."memory",gc."source"
FROM "ProblemTestSetSlot" s JOIN "Problem" p ON p."id"=s."problemId" JOIN "ProblemTestSetRevisionGroupCase" gc ON gc."revisionId"=p."latestTestSetRevisionId";

UPDATE "ContestProblem" x SET "testSetGraphHash"=r."graphHash","testSetJudgeConfigHash"=r."judgeConfigHash","testSetFencingToken"=1,"testSetSlot"='STABLE' FROM "ProblemTestSetRevision" r WHERE x."testSetRevisionId"=r."id";
UPDATE "ProblemDataGenerationJob" x SET "baseTestSetGraphHash"=r."graphHash","baseTestSetFencingToken"=1,"expectedEvolvingFence"=1 FROM "ProblemTestSetRevision" r WHERE x."baseTestSetRevisionId"=r."id";
UPDATE "ProblemDataGenerationJob" x SET "promotedGraphHash"=r."graphHash" FROM "ProblemTestSetRevision" r WHERE x."promotedRevisionId"=r."id";
UPDATE "ProblemHackAttempt" x SET "baseGraphHash"=r."graphHash","baseFencingToken"=1,"baseSlot"='EVOLVING' FROM "ProblemTestSetRevision" r WHERE x."baseTestSetRevisionId"=r."id";
UPDATE "ProblemHackAttempt" x SET "promotedGraphHash"=r."graphHash" FROM "ProblemTestSetRevision" r WHERE x."promotedRevisionId"=r."id";
UPDATE "TestcaseCandidate" x SET "baseGraphHash"=r."graphHash","baseFencingToken"=1,"baseSlot"='EVOLVING' FROM "ProblemTestSetRevision" r WHERE x."baseTestSetRevisionId"=r."id";
UPDATE "TestcaseCandidate" x SET "promotedGraphHash"=r."graphHash" FROM "ProblemTestSetRevision" r WHERE x."promotedRevisionId"=r."id";
UPDATE "QualityEvaluationJob" x SET "graphHash"=r."graphHash","slot"='STABLE' FROM "ProblemTestSetRevision" r WHERE x."revisionId"=r."id";
UPDATE "TestSetQualitySnapshot" x SET "graphHash"=r."graphHash","slot"='STABLE',"testSetAgeDays"=x."revisionAgeDays" FROM "ProblemTestSetRevision" r WHERE x."revisionId"=r."id";
UPDATE "DataProduct" x SET "graphHash"=r."graphHash","slot"='STABLE' FROM "ProblemTestSetRevision" r WHERE x."revisionId"=r."id";
UPDATE "DataPurchase" x SET "purchasedGraphHash"=r."graphHash" FROM "ProblemTestSetRevision" r WHERE x."purchasedRevisionId"=r."id";
UPDATE "DataEntitlement" e SET "problemId"=p."problemId" FROM "DataPurchase" dp JOIN "DataProduct" p ON p."id"=dp."dataProductId" WHERE e."purchaseId"=dp."id";
UPDATE "TestSetQualityIncident" x SET "affectedGraphHash"=r."graphHash","slot"='STABLE' FROM "ProblemTestSetRevision" r WHERE x."revisionId"=r."id";
UPDATE "TestSetQualityIncident" x SET "fixedByGraphHash"=r."graphHash" FROM "ProblemTestSetRevision" r WHERE x."fixedByRevisionId"=r."id";
UPDATE "CanonicalSelectionRun" x SET "baseGraphHash"=r."graphHash" FROM "ProblemTestSetRevision" r WHERE x."baseTestSetRevisionId"=r."id";
UPDATE "CanonicalSelectionRun" x SET "promotedGraphHash"=r."graphHash" FROM "ProblemTestSetRevision" r WHERE x."promotedRevisionId"=r."id";
UPDATE "SolutionContribution" x SET "targetTestSetGraphHash"=r."graphHash" FROM "ProblemTestSetRevision" r WHERE x."targetTestSetRevisionId"=r."id";
UPDATE "SolutionContributionRevision" x SET "targetTestSetGraphHash"=r."graphHash" FROM "ProblemTestSetRevision" r WHERE x."targetTestSetRevisionId"=r."id";
UPDATE "SolutionVerification" x SET "verifiedTestSetGraphHash"=r."graphHash" FROM "ProblemTestSetRevision" r WHERE x."verifiedTestSetRevisionId"=r."id";
UPDATE "ProblemSolutionVersion" x SET "verifiedTestSetGraphHash"=r."graphHash" FROM "ProblemTestSetRevision" r WHERE x."verifiedTestSetRevisionId"=r."id";
UPDATE "JudgeRun" x SET "testSetGraphHash"=r."graphHash","testSetFencingToken"=1,"testSetSlot"='STABLE' FROM "ProblemTestSetRevision" r WHERE x."testSetRevisionId"=r."id";
UPDATE "Submission" x SET "testSetGraphHash"=r."graphHash","testSetFencingToken"=1,"testSetSlot"='STABLE' FROM "ProblemTestSetRevision" r WHERE x."testSetRevisionId"=r."id";
UPDATE "TestcaseMembershipRetirement" x SET "fromGraphHash"=a."graphHash","toGraphHash"=b."graphHash" FROM "ProblemTestSetRevision" a,"ProblemTestSetRevision" b WHERE x."fromRevisionId"=a."id" AND x."toRevisionId"=b."id";

DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM "QualityEvaluationJob" WHERE "graphHash" IS NULL OR "slot" IS NULL)
 OR EXISTS (SELECT 1 FROM "TestSetQualitySnapshot" WHERE "graphHash" IS NULL OR "slot" IS NULL)
 OR EXISTS (SELECT 1 FROM "DataProduct" WHERE "graphHash" IS NULL)
 OR EXISTS (SELECT 1 FROM "DataPurchase" WHERE "purchasedGraphHash" IS NULL)
 OR EXISTS (SELECT 1 FROM "DataEntitlement" WHERE "problemId" IS NULL)
 OR EXISTS (SELECT 1 FROM "TestSetQualityIncident" WHERE "affectedGraphHash" IS NULL OR "slot" IS NULL)
 OR EXISTS (SELECT 1 FROM "CanonicalSelectionRun" WHERE "baseGraphHash" IS NULL)
 OR EXISTS (SELECT 1 FROM "SolutionContribution" WHERE "targetTestSetGraphHash" IS NULL)
 OR EXISTS (SELECT 1 FROM "SolutionContributionRevision" WHERE "targetTestSetGraphHash" IS NULL)
 OR EXISTS (SELECT 1 FROM "SolutionVerification" WHERE "verifiedTestSetGraphHash" IS NULL)
 OR EXISTS (SELECT 1 FROM "ProblemSolutionVersion" WHERE "verifiedTestSetGraphHash" IS NULL)
 OR EXISTS (SELECT 1 FROM "TestcaseMembershipRetirement" WHERE "fromGraphHash" IS NULL OR "toGraphHash" IS NULL)
 THEN RAISE EXCEPTION 'TESTSET_SLOT_MIGRATION_UNMAPPED_REQUIRED_REFERENCE'; END IF;
END $$;

ALTER TABLE "QualityEvaluationJob" ALTER COLUMN "graphHash" SET NOT NULL,ALTER COLUMN "slot" SET NOT NULL;
ALTER TABLE "TestSetQualitySnapshot" ALTER COLUMN "graphHash" SET NOT NULL,ALTER COLUMN "slot" SET NOT NULL;
ALTER TABLE "DataProduct" ALTER COLUMN "graphHash" SET NOT NULL;
ALTER TABLE "DataPurchase" ALTER COLUMN "purchasedGraphHash" SET NOT NULL;
ALTER TABLE "DataEntitlement" ALTER COLUMN "problemId" SET NOT NULL;
ALTER TABLE "TestSetQualityIncident" ALTER COLUMN "affectedGraphHash" SET NOT NULL,ALTER COLUMN "slot" SET NOT NULL;
ALTER TABLE "CanonicalSelectionRun" ALTER COLUMN "baseGraphHash" SET NOT NULL;
ALTER TABLE "SolutionContribution" ALTER COLUMN "targetTestSetGraphHash" SET NOT NULL;
ALTER TABLE "SolutionContributionRevision" ALTER COLUMN "targetTestSetGraphHash" SET NOT NULL;
ALTER TABLE "SolutionVerification" ALTER COLUMN "verifiedTestSetGraphHash" SET NOT NULL;
ALTER TABLE "ProblemSolutionVersion" ALTER COLUMN "verifiedTestSetGraphHash" SET NOT NULL;
ALTER TABLE "TestcaseMembershipRetirement" ALTER COLUMN "fromGraphHash" SET NOT NULL,ALTER COLUMN "toGraphHash" SET NOT NULL;

ALTER TABLE "ContestProblem" DROP COLUMN "testSetRevisionId";
ALTER TABLE "Problem" DROP COLUMN "latestTestSetRevisionId";
ALTER TABLE "ProblemDataGenerationJob" DROP COLUMN "baseTestSetRevisionId",DROP COLUMN "expectedLatestRevisionId",DROP COLUMN "promotedRevisionId";
ALTER TABLE "ProblemHackAttempt" DROP COLUMN "baseTestSetRevisionId",DROP COLUMN "promotedRevisionId";
ALTER TABLE "TestcaseCandidate" DROP COLUMN "baseTestSetRevisionId",DROP COLUMN "promotedRevisionId";
ALTER TABLE "QualityEvaluationJob" DROP COLUMN "revisionId";
ALTER TABLE "TestSetQualitySnapshot" DROP COLUMN "revisionAgeDays",DROP COLUMN "revisionId";
ALTER TABLE "DataProduct" DROP COLUMN "revisionId";
ALTER TABLE "DataPurchase" DROP COLUMN "purchasedRevisionId";
ALTER TABLE "TestSetQualityIncident" DROP COLUMN "fixedByRevisionId",DROP COLUMN "revisionId";
ALTER TABLE "CanonicalSelectionRun" DROP COLUMN "baseTestSetRevisionId",DROP COLUMN "promotedRevisionId";
ALTER TABLE "SolutionContribution" DROP COLUMN "targetTestSetRevisionId";
ALTER TABLE "SolutionContributionRevision" DROP COLUMN "targetTestSetRevisionId";
ALTER TABLE "SolutionVerification" DROP COLUMN "verifiedTestSetRevisionId";
ALTER TABLE "ProblemSolutionVersion" DROP COLUMN "verifiedTestSetRevisionId";
ALTER TABLE "JudgeRun" DROP COLUMN "testSetRevisionId";
ALTER TABLE "Submission" DROP COLUMN "testSetRevisionId";
ALTER TABLE "TestcaseMembershipRetirement" DROP COLUMN "fromRevisionId",DROP COLUMN "toRevisionId";
ALTER TABLE "TrainingSessionStageProblem" DROP COLUMN "testSetRevisionId";
ALTER TABLE "AssignmentProblem" DROP COLUMN "testSetRevisionId";
ALTER TABLE "BlogReference" DROP COLUMN "problemRevisionId";
ALTER TABLE "BlogReference"
ADD CONSTRAINT "BlogReference_target_shape_check" CHECK (
  ("referenceType" = 'PROBLEM' AND "problemId" IS NOT NULL AND "solutionVersionId" IS NULL AND "contestId" IS NULL AND "standingSnapshotId" IS NULL AND "ratingChangeId" IS NULL AND "submissionSnapshotId" IS NULL)
  OR ("referenceType" = 'SOLUTION_VERSION' AND "problemId" IS NULL AND "solutionVersionId" IS NOT NULL AND "contestId" IS NULL AND "standingSnapshotId" IS NULL AND "ratingChangeId" IS NULL AND "submissionSnapshotId" IS NULL)
  OR ("referenceType" = 'CONTEST_STANDING' AND "problemId" IS NULL AND "solutionVersionId" IS NULL AND "contestId" IS NOT NULL AND "standingSnapshotId" IS NOT NULL AND "ratingChangeId" IS NULL AND "submissionSnapshotId" IS NULL)
  OR ("referenceType" = 'RATING_CHANGE' AND "problemId" IS NULL AND "solutionVersionId" IS NULL AND "contestId" IS NOT NULL AND "standingSnapshotId" IS NULL AND "ratingChangeId" IS NOT NULL AND "submissionSnapshotId" IS NULL)
  OR ("referenceType" = 'SUBMISSION_SNAPSHOT' AND "problemId" IS NULL AND "solutionVersionId" IS NULL AND "contestId" IS NULL AND "standingSnapshotId" IS NULL AND "ratingChangeId" IS NULL AND "submissionSnapshotId" IS NOT NULL)
);
DROP TABLE "DataEntitlementRevision";
DROP TABLE "ProblemTestSetRevisionGroupCase";
DROP TABLE "ProblemTestSetRevisionDependency";
DROP TABLE "ProblemTestSetRevisionGroup";
DROP TABLE "ProblemTestSetRevisionCase";
DROP TABLE "ProblemTestSetRevisionSubtask";
DROP TABLE "ProblemTestSetRevision";

-- CreateIndex
CREATE INDEX "ProblemTestSetSlot_slot_writerGateClosed_idx" ON "ProblemTestSetSlot"("slot", "writerGateClosed");

-- CreateIndex
CREATE INDEX "ProblemTestSetSlotCase_testcaseId_idx" ON "ProblemTestSetSlotCase"("testcaseId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemTestSetSlotCase_problemId_slot_orderIndex_key" ON "ProblemTestSetSlotCase"("problemId", "slot", "orderIndex");

-- CreateIndex
CREATE INDEX "ProblemTestSetSlotSubtask_problemId_slot_orderIndex_idx" ON "ProblemTestSetSlotSubtask"("problemId", "slot", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemTestSetSlotSubtask_problemId_slot_subtaskId_key" ON "ProblemTestSetSlotSubtask"("problemId", "slot", "subtaskId");

-- CreateIndex
CREATE INDEX "ProblemTestSetSlotDependency_dependsOnId_idx" ON "ProblemTestSetSlotDependency"("dependsOnId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemTestSetSlotDependency_subtaskId_dependsOnId_key" ON "ProblemTestSetSlotDependency"("subtaskId", "dependsOnId");

-- CreateIndex
CREATE INDEX "ProblemTestSetSlotGroup_problemId_slot_kind_idx" ON "ProblemTestSetSlotGroup"("problemId", "slot", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemTestSetSlotGroup_subtaskId_key_key" ON "ProblemTestSetSlotGroup"("subtaskId", "key");

-- CreateIndex
CREATE INDEX "ProblemTestSetSlotGroupCase_problemId_slot_groupId_orderInd_idx" ON "ProblemTestSetSlotGroupCase"("problemId", "slot", "groupId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemTestSetSlotGroupCase_groupId_testcaseId_key" ON "ProblemTestSetSlotGroupCase"("groupId", "testcaseId");

-- CreateIndex
CREATE INDEX "ProblemTestSetReader_problemId_slot_status_expiresAt_idx" ON "ProblemTestSetReader"("problemId", "slot", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemTestSetReader_problemId_slot_ownerType_ownerId_key" ON "ProblemTestSetReader"("problemId", "slot", "ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "ProblemTestSetWriter_problemId_slot_status_requestedAt_idx" ON "ProblemTestSetWriter"("problemId", "slot", "status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemTestSetWriter_problemId_slot_requestHash_key" ON "ProblemTestSetWriter"("problemId", "slot", "requestHash");

-- CreateIndex
CREATE INDEX "ProblemTestSetPromotionJob_problemId_status_createdAt_idx" ON "ProblemTestSetPromotionJob"("problemId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblem_testSetReaderId_key" ON "ContestProblem"("testSetReaderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemDataGenerationJob_testSetReaderId_key" ON "ProblemDataGenerationJob"("testSetReaderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemHackAttempt_testSetReaderId_key" ON "ProblemHackAttempt"("testSetReaderId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityEvaluationJob_testSetReaderId_key" ON "QualityEvaluationJob"("testSetReaderId");

-- CreateIndex
CREATE INDEX "QualityEvaluationJob_problemId_slot_qualityRuleVersion_idx" ON "QualityEvaluationJob"("problemId", "slot", "qualityRuleVersion");

-- CreateIndex
CREATE UNIQUE INDEX "TestSetQualitySnapshot_problemId_slot_graphHash_qualityRule_key" ON "TestSetQualitySnapshot"("problemId", "slot", "graphHash", "qualityRuleVersion", "corpusRevisionId", "inputHash");

-- CreateIndex
CREATE INDEX "DataProduct_problemId_slot_status_idx" ON "DataProduct"("problemId", "slot", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DataProduct_problemId_slot_graphHash_qualitySnapshotId_upda_key" ON "DataProduct"("problemId", "slot", "graphHash", "qualitySnapshotId", "updatePolicy");

-- CreateIndex
CREATE INDEX "DataPurchase_purchasedGraphHash_idx" ON "DataPurchase"("purchasedGraphHash");

-- CreateIndex
CREATE INDEX "DataEntitlement_problemId_revokedAt_idx" ON "DataEntitlement"("problemId", "revokedAt");

-- CreateIndex
CREATE INDEX "TestSetQualityIncident_problemId_slot_status_idx" ON "TestSetQualityIncident"("problemId", "slot", "status");

-- CreateIndex
CREATE INDEX "TestSetQualityIncident_fixedByGraphHash_idx" ON "TestSetQualityIncident"("fixedByGraphHash");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateEvaluationRun_testSetReaderId_key" ON "CandidateEvaluationRun"("testSetReaderId");

-- CreateIndex
CREATE INDEX "CanonicalSelectionRun_promotedGraphHash_idx" ON "CanonicalSelectionRun"("promotedGraphHash");

-- CreateIndex
CREATE UNIQUE INDEX "JudgeRun_testSetReaderId_key" ON "JudgeRun"("testSetReaderId");

-- CreateIndex
CREATE INDEX "JudgeRun_testSetSlot_idx" ON "JudgeRun"("testSetSlot");

-- CreateIndex
CREATE INDEX "Submission_testSetSlot_idx" ON "Submission"("testSetSlot");

-- CreateIndex
CREATE INDEX "TestcaseMembershipRetirement_fromGraphHash_toGraphHash_idx" ON "TestcaseMembershipRetirement"("fromGraphHash", "toGraphHash");

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_testSetReaderId_fkey" FOREIGN KEY ("testSetReaderId") REFERENCES "ProblemTestSetReader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemDataGenerationJob" ADD CONSTRAINT "ProblemDataGenerationJob_testSetReaderId_fkey" FOREIGN KEY ("testSetReaderId") REFERENCES "ProblemTestSetReader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemHackAttempt" ADD CONSTRAINT "ProblemHackAttempt_testSetReaderId_fkey" FOREIGN KEY ("testSetReaderId") REFERENCES "ProblemTestSetReader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityEvaluationJob" ADD CONSTRAINT "QualityEvaluationJob_testSetReaderId_fkey" FOREIGN KEY ("testSetReaderId") REFERENCES "ProblemTestSetReader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataEntitlement" ADD CONSTRAINT "DataEntitlement_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateEvaluationRun" ADD CONSTRAINT "CandidateEvaluationRun_testSetReaderId_fkey" FOREIGN KEY ("testSetReaderId") REFERENCES "ProblemTestSetReader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeRun" ADD CONSTRAINT "JudgeRun_testSetReaderId_fkey" FOREIGN KEY ("testSetReaderId") REFERENCES "ProblemTestSetReader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlot" ADD CONSTRAINT "ProblemTestSetSlot_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotCase" ADD CONSTRAINT "ProblemTestSetSlotCase_problemId_slot_fkey" FOREIGN KEY ("problemId", "slot") REFERENCES "ProblemTestSetSlot"("problemId", "slot") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotCase" ADD CONSTRAINT "ProblemTestSetSlotCase_testcaseId_fkey" FOREIGN KEY ("testcaseId") REFERENCES "ProblemTestcase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotCase" ADD CONSTRAINT "ProblemTestSetSlotCase_inputObjectId_fkey" FOREIGN KEY ("inputObjectId") REFERENCES "TestdataObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotCase" ADD CONSTRAINT "ProblemTestSetSlotCase_outputObjectId_fkey" FOREIGN KEY ("outputObjectId") REFERENCES "TestdataObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotSubtask" ADD CONSTRAINT "ProblemTestSetSlotSubtask_problemId_slot_fkey" FOREIGN KEY ("problemId", "slot") REFERENCES "ProblemTestSetSlot"("problemId", "slot") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotDependency" ADD CONSTRAINT "ProblemTestSetSlotDependency_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "ProblemTestSetSlotSubtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotDependency" ADD CONSTRAINT "ProblemTestSetSlotDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "ProblemTestSetSlotSubtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotGroup" ADD CONSTRAINT "ProblemTestSetSlotGroup_problemId_slot_fkey" FOREIGN KEY ("problemId", "slot") REFERENCES "ProblemTestSetSlot"("problemId", "slot") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotGroup" ADD CONSTRAINT "ProblemTestSetSlotGroup_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "ProblemTestSetSlotSubtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotGroupCase" ADD CONSTRAINT "ProblemTestSetSlotGroupCase_problemId_slot_fkey" FOREIGN KEY ("problemId", "slot") REFERENCES "ProblemTestSetSlot"("problemId", "slot") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotGroupCase" ADD CONSTRAINT "ProblemTestSetSlotGroupCase_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProblemTestSetSlotGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotGroupCase" ADD CONSTRAINT "ProblemTestSetSlotGroupCase_testcaseId_fkey" FOREIGN KEY ("testcaseId") REFERENCES "ProblemTestcase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotGroupCase" ADD CONSTRAINT "ProblemTestSetSlotGroupCase_inputObjectId_fkey" FOREIGN KEY ("inputObjectId") REFERENCES "TestdataObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetSlotGroupCase" ADD CONSTRAINT "ProblemTestSetSlotGroupCase_outputObjectId_fkey" FOREIGN KEY ("outputObjectId") REFERENCES "TestdataObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetReader" ADD CONSTRAINT "ProblemTestSetReader_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetReader" ADD CONSTRAINT "ProblemTestSetReader_problemId_slot_fkey" FOREIGN KEY ("problemId", "slot") REFERENCES "ProblemTestSetSlot"("problemId", "slot") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetWriter" ADD CONSTRAINT "ProblemTestSetWriter_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTestSetPromotionJob" ADD CONSTRAINT "ProblemTestSetPromotionJob_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE OR REPLACE FUNCTION "solution_version_content_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '已发布题解版本不可删除';
  END IF;
  IF NEW."solutionId" IS DISTINCT FROM OLD."solutionId"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."contentMarkdown" IS DISTINCT FROM OLD."contentMarkdown"
    OR NEW."algorithmTags" IS DISTINCT FROM OLD."algorithmTags"
    OR NEW."approachKey" IS DISTINCT FROM OLD."approachKey"
    OR NEW."complexityTime" IS DISTINCT FROM OLD."complexityTime"
    OR NEW."complexityMemory" IS DISTINCT FROM OLD."complexityMemory"
    OR NEW."language" IS DISTINCT FROM OLD."language"
    OR NEW."referenceCode" IS DISTINCT FROM OLD."referenceCode"
    OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
    OR NEW."sourceUrl" IS DISTINCT FROM OLD."sourceUrl"
    OR NEW."citation" IS DISTINCT FROM OLD."citation"
    OR NEW."licenseDeclarationVersion" IS DISTINCT FROM OLD."licenseDeclarationVersion"
    OR NEW."statementSnapshot" IS DISTINCT FROM OLD."statementSnapshot"
    OR NEW."statementSnapshotHash" IS DISTINCT FROM OLD."statementSnapshotHash"
    OR NEW."verifiedTestSetSlot" IS DISTINCT FROM OLD."verifiedTestSetSlot"
    OR NEW."verifiedTestSetGraphHash" IS DISTINCT FROM OLD."verifiedTestSetGraphHash"
    OR NEW."sourceContributionRevisionId" IS DISTINCT FROM OLD."sourceContributionRevisionId"
    OR NEW."verificationId" IS DISTINCT FROM OLD."verificationId"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."publishedByUserId" IS DISTINCT FROM OLD."publishedByUserId"
    OR NEW."visibilityPolicy" IS DISTINCT FROM OLD."visibilityPolicy"
    OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION '已发布题解版本内容不可修改，只能创建新版本';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
