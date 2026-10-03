-- Development hard cut: V3 replaces the stage-based engine and intentionally has no compatibility path.
-- Existing training data is disposable in this development environment. Remove it before changing
-- enums and replacing the legacy stage model so no conversion or compatibility code survives.
DELETE FROM "Submission"
WHERE "trainingSessionId" IS NOT NULL
   OR "trainingStageProblemId" IS NOT NULL;

DELETE FROM "TrainingSession";

-- CreateEnum
CREATE TYPE "TrainingRoundLifecycle" AS ENUM ('PENDING', 'RUNNING', 'ENDED');

-- CreateEnum
CREATE TYPE "TrainingRoundEndReason" AS ENUM ('TIME_REACHED', 'TEACHER_ADVANCED', 'SESSION_ENDED');

-- AlterEnum
BEGIN;
CREATE TYPE "TrainingEngineSessionStatus_new" AS ENUM ('READY', 'RUNNING', 'PAUSED', 'ENDED', 'ARCHIVED');
ALTER TABLE "TrainingSession" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TrainingSession" ALTER COLUMN "status" TYPE "TrainingEngineSessionStatus_new" USING ("status"::text::"TrainingEngineSessionStatus_new");
ALTER TYPE "TrainingEngineSessionStatus" RENAME TO "TrainingEngineSessionStatus_old";
ALTER TYPE "TrainingEngineSessionStatus_new" RENAME TO "TrainingEngineSessionStatus";
DROP TYPE "TrainingEngineSessionStatus_old";
ALTER TABLE "TrainingSession" ALTER COLUMN "status" SET DEFAULT 'READY';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TrainingEngineTargetType_new" AS ENUM ('ALL', 'GROUP', 'USER');
ALTER TABLE "TrainingSessionCommand" ALTER COLUMN "targetType" DROP DEFAULT;
ALTER TABLE "TrainingSessionOverlay" ALTER COLUMN "targetType" DROP DEFAULT;
ALTER TABLE "TrainingSessionEvent" ALTER COLUMN "targetType" DROP DEFAULT;
ALTER TABLE "TrainingSessionCommand" ALTER COLUMN "targetType" TYPE "TrainingEngineTargetType_new" USING ("targetType"::text::"TrainingEngineTargetType_new");
ALTER TABLE "TrainingSessionOverlay" ALTER COLUMN "targetType" TYPE "TrainingEngineTargetType_new" USING ("targetType"::text::"TrainingEngineTargetType_new");
ALTER TABLE "TrainingSessionEvent" ALTER COLUMN "targetType" TYPE "TrainingEngineTargetType_new" USING ("targetType"::text::"TrainingEngineTargetType_new");
ALTER TYPE "TrainingEngineTargetType" RENAME TO "TrainingEngineTargetType_old";
ALTER TYPE "TrainingEngineTargetType_new" RENAME TO "TrainingEngineTargetType";
DROP TYPE "TrainingEngineTargetType_old";
ALTER TABLE "TrainingSessionCommand" ALTER COLUMN "targetType" SET DEFAULT 'ALL';
ALTER TABLE "TrainingSessionOverlay" ALTER COLUMN "targetType" SET DEFAULT 'ALL';
ALTER TABLE "TrainingSessionEvent" ALTER COLUMN "targetType" SET DEFAULT 'ALL';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TrainingEngineProgressStatus_new" AS ENUM ('NOT_STARTED', 'WORKING', 'COMPLETED');
ALTER TABLE "TrainingSessionProblemProgress" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TrainingSessionProblemProgress" ALTER COLUMN "status" TYPE "TrainingEngineProgressStatus_new" USING ("status"::text::"TrainingEngineProgressStatus_new");
ALTER TYPE "TrainingEngineProgressStatus" RENAME TO "TrainingEngineProgressStatus_old";
ALTER TYPE "TrainingEngineProgressStatus_new" RENAME TO "TrainingEngineProgressStatus";
DROP TYPE "TrainingEngineProgressStatus_old";
ALTER TABLE "TrainingSessionProblemProgress" ALTER COLUMN "status" SET DEFAULT 'NOT_STARTED';
COMMIT;

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_trainingStageProblemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSession" DROP CONSTRAINT "TrainingSession_currentStageId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStage" DROP CONSTRAINT "TrainingSessionStage_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStageProblem" DROP CONSTRAINT "TrainingSessionStageProblem_stageId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStageProblem" DROP CONSTRAINT "TrainingSessionStageProblem_problemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionGroupChange" DROP CONSTRAINT "TrainingSessionGroupChange_targetStageId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStageGroup" DROP CONSTRAINT "TrainingSessionStageGroup_stageId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStageGroup" DROP CONSTRAINT "TrainingSessionStageGroup_groupId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStageProblemPlan" DROP CONSTRAINT "TrainingSessionStageProblemPlan_stageId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStageProblemPlan" DROP CONSTRAINT "TrainingSessionStageProblemPlan_stageProblemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStageProblemPlan" DROP CONSTRAINT "TrainingSessionStageProblemPlan_stageGroupId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStageRuntimeSnapshot" DROP CONSTRAINT "TrainingSessionStageRuntimeSnapshot_stageId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStageTimeAdjustment" DROP CONSTRAINT "TrainingSessionStageTimeAdjustment_stageId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionProblemProgress" DROP CONSTRAINT "TrainingSessionProblemProgress_stageProblemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionUserOverride" DROP CONSTRAINT "TrainingSessionUserOverride_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionProblemDraft" DROP CONSTRAINT "TrainingSessionProblemDraft_stageProblemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionHint" DROP CONSTRAINT "TrainingSessionHint_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionHint" DROP CONSTRAINT "TrainingSessionHint_stageProblemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionHintAccess" DROP CONSTRAINT "TrainingSessionHintAccess_hintId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionHintAccess" DROP CONSTRAINT "TrainingSessionHintAccess_participantId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionScoreEvent" DROP CONSTRAINT "TrainingSessionScoreEvent_stageProblemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStrategyDecision" DROP CONSTRAINT "TrainingSessionStrategyDecision_participantId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionStrategyDecision" DROP CONSTRAINT "TrainingSessionStrategyDecision_stageProblemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSessionTemplateStage" DROP CONSTRAINT "TrainingSessionTemplateStage_templateId_fkey";

-- DropIndex
DROP INDEX "Submission_trainingStageProblemId_idx";

-- DropIndex
DROP INDEX "TrainingSession_currentStageId_key";

-- DropIndex
DROP INDEX "TrainingSessionGroupChange_sessionId_status_targetStageId_idx";

-- DropIndex
DROP INDEX "TrainingSessionProblemProgress_stageProblemId_status_idx";

-- DropIndex
DROP INDEX "TrainingSessionProblemProgress_participantId_stageProblemId_key";

-- DropIndex
DROP INDEX "TrainingSessionOverlay_expiresAt_status_idx";

-- DropIndex
DROP INDEX "TrainingSessionProblemDraft_stageProblemId_idx";

-- DropIndex
DROP INDEX "TrainingSessionProblemDraft_sessionId_userId_stageProblemId_key";

-- DropIndex
DROP INDEX "TrainingSessionScoreEvent_stageProblemId_createdAt_idx";

-- AlterTable
ALTER TABLE "Submission" DROP COLUMN "trainingStageProblemId",
ADD COLUMN     "trainingRoundId" TEXT,
ADD COLUMN     "trainingSessionProblemId" TEXT;

-- AlterTable
ALTER TABLE "TrainingSession" DROP COLUMN "allowHints",
DROP COLUMN "currentStageId",
DROP COLUMN "defaultAccessPolicy",
DROP COLUMN "defaultSubmissionMode",
DROP COLUMN "joinMode",
DROP COLUMN "pauseMode",
DROP COLUMN "peerVisibility",
DROP COLUMN "rankingMode",
DROP COLUMN "settings",
ADD COLUMN     "currentRoundId" TEXT,
ADD COLUMN     "totalDurationSeconds" INTEGER NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'READY';

-- AlterTable
ALTER TABLE "TrainingSessionParticipant" DROP COLUMN "currentProblemId",
DROP COLUMN "returnProblemId",
ADD COLUMN     "currentSessionProblemId" TEXT,
ADD COLUMN     "returnSessionProblemId" TEXT;

-- AlterTable
ALTER TABLE "TrainingSessionGroupChange" DROP COLUMN "effectiveAt",
DROP COLUMN "effectiveMode",
DROP COLUMN "status",
DROP COLUMN "targetStageId",
ADD COLUMN     "targetRoundId" TEXT,
ALTER COLUMN "appliedAt" SET NOT NULL,
ALTER COLUMN "appliedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "TrainingSessionProblemProgress" DROP COLUMN "continuousActiveSeconds",
DROP COLUMN "highestHintLevel",
DROP COLUMN "hintCount",
DROP COLUMN "lastScoreImprovedAt",
DROP COLUMN "stageProblemId",
DROP COLUMN "stuckDetectedAt",
ADD COLUMN     "sessionProblemId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "TrainingSessionOverlay" DROP COLUMN "expiresAt",
DROP COLUMN "stageProblemId",
ADD COLUMN     "sessionProblemId" TEXT;

-- AlterTable
ALTER TABLE "TrainingSessionProblemDraft" DROP COLUMN "stageProblemId",
ADD COLUMN     "sessionProblemId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "TrainingSessionScoreEvent" DROP COLUMN "stageProblemId",
ADD COLUMN     "sessionProblemId" TEXT NOT NULL;

-- DropTable
DROP TABLE "TrainingSessionStage";

-- DropTable
DROP TABLE "TrainingSessionStageProblem";

-- DropTable
DROP TABLE "TrainingSessionStageGroup";

-- DropTable
DROP TABLE "TrainingSessionStageProblemPlan";

-- DropTable
DROP TABLE "TrainingSessionStageRuntimeSnapshot";

-- DropTable
DROP TABLE "TrainingSessionStageTimeAdjustment";

-- DropTable
DROP TABLE "TrainingSessionUserOverride";

-- DropTable
DROP TABLE "TrainingSessionHint";

-- DropTable
DROP TABLE "TrainingSessionHintAccess";

-- DropTable
DROP TABLE "TrainingSessionStrategyDecision";

-- DropTable
DROP TABLE "TrainingSessionTemplate";

-- DropTable
DROP TABLE "TrainingSessionTemplateStage";

-- DropEnum
DROP TYPE "TrainingEngineStageKind";

-- DropEnum
DROP TYPE "TrainingEngineStageAudienceMode";

-- DropEnum
DROP TYPE "TrainingEngineStageLifecycle";

-- DropEnum
DROP TYPE "TrainingEngineStageEndReason";

-- DropEnum
DROP TYPE "TrainingEngineStageEndPolicy";

-- DropEnum
DROP TYPE "TrainingEngineStageAccessPolicy";

-- DropEnum
DROP TYPE "TrainingEngineGroupChangeEffectiveMode";

-- DropEnum
DROP TYPE "TrainingEngineSubmissionMode";

-- DropEnum
DROP TYPE "TrainingEnginePauseMode";

-- DropEnum
DROP TYPE "TrainingEngineRankingMode";

-- DropEnum
DROP TYPE "TrainingEnginePeerVisibility";

-- DropEnum
DROP TYPE "TrainingEngineJoinMode";

-- DropEnum
DROP TYPE "TrainingEngineHintOpenMode";

-- CreateTable
CREATE TABLE "TrainingSessionProblem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "alias" TEXT,
    "titleSnapshot" TEXT NOT NULL,
    "statementsSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSessionProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSessionRound" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "lifecycle" "TrainingRoundLifecycle" NOT NULL DEFAULT 'PENDING',
    "timeLimitSeconds" INTEGER,
    "startedAt" TIMESTAMP(3),
    "runningSince" TIMESTAMP(3),
    "activeElapsedSeconds" INTEGER NOT NULL DEFAULT 0,
    "endedAt" TIMESTAMP(3),
    "endReason" "TrainingRoundEndReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSessionRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingRoundProblemAssignment" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sessionProblemId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingRoundProblemAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingSessionProblem_problemId_idx" ON "TrainingSessionProblem"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSessionProblem_sessionId_problemId_key" ON "TrainingSessionProblem"("sessionId", "problemId");

-- CreateIndex
CREATE INDEX "TrainingSessionRound_sessionId_lifecycle_orderIndex_idx" ON "TrainingSessionRound"("sessionId", "lifecycle", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSessionRound_sessionId_orderIndex_key" ON "TrainingSessionRound"("sessionId", "orderIndex");

-- CreateIndex
CREATE INDEX "TrainingRoundProblemAssignment_groupId_active_idx" ON "TrainingRoundProblemAssignment"("groupId", "active");

-- CreateIndex
CREATE INDEX "TrainingRoundProblemAssignment_sessionProblemId_idx" ON "TrainingRoundProblemAssignment"("sessionProblemId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingRoundProblemAssignment_roundId_groupId_sessionProbl_key" ON "TrainingRoundProblemAssignment"("roundId", "groupId", "sessionProblemId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingRoundProblemAssignment_roundId_groupId_orderIndex_key" ON "TrainingRoundProblemAssignment"("roundId", "groupId", "orderIndex");

-- CreateIndex
CREATE INDEX "Submission_trainingSessionProblemId_idx" ON "Submission"("trainingSessionProblemId");

-- CreateIndex
CREATE INDEX "Submission_trainingRoundId_idx" ON "Submission"("trainingRoundId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSession_currentRoundId_key" ON "TrainingSession"("currentRoundId");

-- CreateIndex
CREATE INDEX "TrainingSessionParticipant_currentSessionProblemId_idx" ON "TrainingSessionParticipant"("currentSessionProblemId");

-- CreateIndex
CREATE INDEX "TrainingSessionGroupChange_targetRoundId_idx" ON "TrainingSessionGroupChange"("targetRoundId");

-- CreateIndex
CREATE INDEX "TrainingSessionProblemProgress_sessionProblemId_status_idx" ON "TrainingSessionProblemProgress"("sessionProblemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSessionProblemProgress_participantId_sessionProblem_key" ON "TrainingSessionProblemProgress"("participantId", "sessionProblemId");

-- CreateIndex
CREATE INDEX "TrainingSessionOverlay_sessionProblemId_idx" ON "TrainingSessionOverlay"("sessionProblemId");

-- CreateIndex
CREATE INDEX "TrainingSessionProblemDraft_sessionProblemId_idx" ON "TrainingSessionProblemDraft"("sessionProblemId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSessionProblemDraft_sessionId_userId_sessionProblem_key" ON "TrainingSessionProblemDraft"("sessionId", "userId", "sessionProblemId");

-- CreateIndex
CREATE INDEX "TrainingSessionScoreEvent_sessionProblemId_createdAt_idx" ON "TrainingSessionScoreEvent"("sessionProblemId", "createdAt");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_trainingSessionProblemId_fkey" FOREIGN KEY ("trainingSessionProblemId") REFERENCES "TrainingSessionProblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_trainingRoundId_fkey" FOREIGN KEY ("trainingRoundId") REFERENCES "TrainingSessionRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_currentRoundId_fkey" FOREIGN KEY ("currentRoundId") REFERENCES "TrainingSessionRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSessionProblem" ADD CONSTRAINT "TrainingSessionProblem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSessionProblem" ADD CONSTRAINT "TrainingSessionProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSessionRound" ADD CONSTRAINT "TrainingSessionRound_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRoundProblemAssignment" ADD CONSTRAINT "TrainingRoundProblemAssignment_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "TrainingSessionRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRoundProblemAssignment" ADD CONSTRAINT "TrainingRoundProblemAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingSessionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRoundProblemAssignment" ADD CONSTRAINT "TrainingRoundProblemAssignment_sessionProblemId_fkey" FOREIGN KEY ("sessionProblemId") REFERENCES "TrainingSessionProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSessionParticipant" ADD CONSTRAINT "TrainingSessionParticipant_currentSessionProblemId_fkey" FOREIGN KEY ("currentSessionProblemId") REFERENCES "TrainingSessionProblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSessionParticipant" ADD CONSTRAINT "TrainingSessionParticipant_returnSessionProblemId_fkey" FOREIGN KEY ("returnSessionProblemId") REFERENCES "TrainingSessionProblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSessionGroupChange" ADD CONSTRAINT "TrainingSessionGroupChange_targetRoundId_fkey" FOREIGN KEY ("targetRoundId") REFERENCES "TrainingSessionRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSessionProblemProgress" ADD CONSTRAINT "TrainingSessionProblemProgress_sessionProblemId_fkey" FOREIGN KEY ("sessionProblemId") REFERENCES "TrainingSessionProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSessionOverlay" ADD CONSTRAINT "TrainingSessionOverlay_sessionProblemId_fkey" FOREIGN KEY ("sessionProblemId") REFERENCES "TrainingSessionProblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSessionProblemDraft" ADD CONSTRAINT "TrainingSessionProblemDraft_sessionProblemId_fkey" FOREIGN KEY ("sessionProblemId") REFERENCES "TrainingSessionProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSessionScoreEvent" ADD CONSTRAINT "TrainingSessionScoreEvent_sessionProblemId_fkey" FOREIGN KEY ("sessionProblemId") REFERENCES "TrainingSessionProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
