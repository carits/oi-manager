-- Destructive cleanup: legacy Training submissions are not compatible with Training Engine V2.
DELETE FROM "Submission" WHERE "submitScope" = 'training';

-- Remote archive submissions were retired and must never be recreated.
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_submitMethod_no_archive_ck" CHECK ("submitMethod" <> 'archive');

-- DropForeignKey
ALTER TABLE "ContestRecord" DROP CONSTRAINT "ContestRecord_trainingId_fkey";

-- DropForeignKey
ALTER TABLE "ContestUserProblemStatus" DROP CONSTRAINT "ContestUserProblemStatus_contest_pair_fkey";

-- DropForeignKey
ALTER TABLE "DataPurchase" DROP CONSTRAINT "DataPurchase_contestId_fkey";

-- DropForeignKey
ALTER TABLE "DataEntitlement" DROP CONSTRAINT "DataEntitlement_contestId_fkey";

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_canonical_contest_pair_fkey";

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_trainingId_fkey";

-- DropForeignKey
ALTER TABLE "Assignment" DROP CONSTRAINT "Assignment_legacyTrainingId_fkey";

-- DropForeignKey
ALTER TABLE "BlogReference" DROP CONSTRAINT "BlogReference_trainingId_fkey";

-- DropForeignKey
ALTER TABLE "Training" DROP CONSTRAINT "Training_finalizedStandingId_fkey";

-- DropForeignKey
ALTER TABLE "Training" DROP CONSTRAINT "Training_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Training" DROP CONSTRAINT "Training_teamId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingAttachment" DROP CONSTRAINT "TrainingAttachment_trainingProblemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingParticipant" DROP CONSTRAINT "TrainingParticipant_trainingId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingProblem" DROP CONSTRAINT "TrainingProblem_problemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingProblem" DROP CONSTRAINT "TrainingProblem_testSetRevisionId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingProblem" DROP CONSTRAINT "TrainingProblem_trainingId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingProblemContentSnapshot" DROP CONSTRAINT "TrainingProblemContentSnapshot_trainingProblemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingProblemStatementSet" DROP CONSTRAINT "TrainingStatementSet_problem_fkey";

-- DropForeignKey
ALTER TABLE "TrainingProblemStatementSnapshot" DROP CONSTRAINT "TrainingStatementSnapshot_set_fkey";

-- DropForeignKey
ALTER TABLE "TrainingSolution" DROP CONSTRAINT "TrainingSolution_trainingProblemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingUserProblemStatus" DROP CONSTRAINT "TrainingUserProblemStatus_trainingId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingUserProblemStatus" DROP CONSTRAINT "TrainingUserProblemStatus_trainingProblemId_fkey";

-- DropForeignKey
ALTER TABLE "TrainingUserProblemStatus" DROP CONSTRAINT "TrainingUserProblemStatus_userId_fkey";

-- DropIndex
DROP INDEX "ContestParticipant_contestId_idx";

-- DropIndex
DROP INDEX "ContestProblem_contestId_id_key";

-- DropIndex
DROP INDEX "ContestRecord_trainingId_userId_userType_key";

-- DropIndex
DROP INDEX "RejudgeBatch_trainingId_createdAt_idx";

-- DropIndex
DROP INDEX "Submission_contestId_idx";

-- DropIndex
DROP INDEX "Submission_submitScope_contestId_idx";

-- DropIndex
DROP INDEX "Submission_submitScope_trainingId_idx";

-- DropIndex
DROP INDEX "Submission_trainingId_idx";

-- DropIndex
DROP INDEX "Submission_trainingProblemId_idx";

-- DropIndex
DROP INDEX "Submission_userId_contestId_idx";

-- DropIndex
DROP INDEX "Submission_userId_trainingId_idx";

-- DropIndex
DROP INDEX "Submission_userId_trainingProblemId_idx";

-- DropIndex
DROP INDEX "TrainingSession_legacyTrainingId_key";

-- DropIndex
DROP INDEX "TrainingSessionStageGroup_stageId_idx";

-- DropIndex
DROP INDEX "Assignment_legacyTrainingId_key";

-- DropIndex
DROP INDEX "BlogReference_trainingId_relationType_idx";

-- AlterTable
ALTER TABLE "ContestRecord" DROP COLUMN "trainingId";

-- AlterTable
ALTER TABLE "RatingRebuildJob" DROP COLUMN "fromTrainingId",
ADD COLUMN     "fromContestId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "DataPurchase" ALTER COLUMN "contestId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "DataEntitlement" ALTER COLUMN "contestId" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "RejudgeBatch" DROP COLUMN "trainingId",
ADD COLUMN     "contestId" TEXT;

-- AlterTable
ALTER TABLE "Submission" DROP COLUMN "contestId",
DROP COLUMN "contestProblemId",
DROP COLUMN "trainingId",
DROP COLUMN "trainingProblemId";

-- AlterTable
ALTER TABLE "TrainingSession" DROP COLUMN "legacyTrainingId";

-- AlterTable
ALTER TABLE "TrainingSessionStageGroup" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TrainingSessionStageProblemPlan" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Assignment" DROP COLUMN "legacyTrainingId";

-- AlterTable
ALTER TABLE "BlogReference" DROP COLUMN "trainingId",
ADD COLUMN     "contestId" TEXT;

-- DropTable
DROP TABLE "Training";

-- DropTable
DROP TABLE "TrainingAttachment";

-- DropTable
DROP TABLE "TrainingParticipant";

-- DropTable
DROP TABLE "TrainingProblem";

-- DropTable
DROP TABLE "TrainingProblemContentSnapshot";

-- DropTable
DROP TABLE "TrainingProblemStatementSet";

-- DropTable
DROP TABLE "TrainingProblemStatementSnapshot";

-- DropTable
DROP TABLE "TrainingSolution";

-- DropTable
DROP TABLE "TrainingUserProblemStatus";

-- CreateIndex
CREATE INDEX "RejudgeBatch_contestId_createdAt_idx" ON "RejudgeBatch"("contestId", "createdAt");

-- CreateIndex
CREATE INDEX "TrainingSessionParticipant_sessionId_currentStageId_idx" ON "TrainingSessionParticipant"("sessionId", "currentStageId");

-- CreateIndex
CREATE INDEX "BlogReference_contestId_relationType_idx" ON "BlogReference"("contestId", "relationType");

-- RenameForeignKey
ALTER TABLE "TrainingSessionStageParticipantAssignment" RENAME CONSTRAINT "TrainingSessionStageParticipantAssignment_legacyStageGroupId_fk" TO "TrainingSessionStageParticipantAssignment_legacyStageGroup_fkey";

-- RenameForeignKey
ALTER TABLE "TrainingSessionStageParticipantAssignment" RENAME CONSTRAINT "TrainingStageParticipantAssignment_participantId_fkey" TO "TrainingSessionStageParticipantAssignment_participantId_fkey";

-- RenameForeignKey
ALTER TABLE "TrainingSessionStageParticipantAssignment" RENAME CONSTRAINT "TrainingStageParticipantAssignment_stageId_fkey" TO "TrainingSessionStageParticipantAssignment_stageId_fkey";

-- RenameForeignKey
ALTER TABLE "TrainingSessionStageProblemPlan" RENAME CONSTRAINT "TrainingStageProblemPlan_groupId_fkey" TO "TrainingSessionStageProblemPlan_groupId_fkey";

-- RenameForeignKey
ALTER TABLE "TrainingSessionStageProblemPlan" RENAME CONSTRAINT "TrainingStageProblemPlan_stageId_fkey" TO "TrainingSessionStageProblemPlan_stageId_fkey";

-- RenameForeignKey
ALTER TABLE "TrainingSessionStageProblemPlan" RENAME CONSTRAINT "TrainingStageProblemPlan_stageProblemId_fkey" TO "TrainingSessionStageProblemPlan_stageProblemId_fkey";

-- RenameForeignKey
ALTER TABLE "TrainingSessionStageGroupChange" RENAME CONSTRAINT "TrainingStageGroupChange_fromGroupId_fkey" TO "TrainingSessionStageGroupChange_fromGroupId_fkey";

-- RenameForeignKey
ALTER TABLE "TrainingSessionStageGroupChange" RENAME CONSTRAINT "TrainingStageGroupChange_participantId_fkey" TO "TrainingSessionStageGroupChange_participantId_fkey";

-- RenameForeignKey
ALTER TABLE "TrainingSessionStageGroupChange" RENAME CONSTRAINT "TrainingStageGroupChange_stageId_fkey" TO "TrainingSessionStageGroupChange_stageId_fkey";

-- RenameForeignKey
ALTER TABLE "TrainingSessionStageGroupChange" RENAME CONSTRAINT "TrainingStageGroupChange_toGroupId_fkey" TO "TrainingSessionStageGroupChange_toGroupId_fkey";

-- RenameForeignKey
ALTER TABLE "TrainingSessionStageTimeAdjustment" RENAME CONSTRAINT "TrainingStageTimeAdjustment_stageId_fkey" TO "TrainingSessionStageTimeAdjustment_stageId_fkey";

-- AddForeignKey
ALTER TABLE "DataPurchase" ADD CONSTRAINT "DataPurchase_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataEntitlement" ADD CONSTRAINT "DataEntitlement_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RejudgeBatch" ADD CONSTRAINT "RejudgeBatch_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogReference" ADD CONSTRAINT "BlogReference_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "RatingBatch_pool_snapshot_algorithm_revision_key" RENAME TO "RatingBatch_poolId_standingSnapshotId_algorithmCode_algorit_key";

-- RenameIndex
ALTER INDEX "ProblemJudgeProgramVersion_problemId_lifecycleStatus_createdAt_" RENAME TO "ProblemJudgeProgramVersion_problemId_lifecycleStatus_create_idx";

-- RenameIndex
ALTER INDEX "TestSetQualitySnapshot_revisionId_qualityRuleVersion_corpusRevi" RENAME TO "TestSetQualitySnapshot_revisionId_qualityRuleVersion_corpus_key";

-- RenameIndex
ALTER INDEX "ProblemQualityAssessment_problemId_ruleVersion_subjectVersionHa" RENAME TO "ProblemQualityAssessment_problemId_ruleVersion_subjectVersi_key";

-- RenameIndex
ALTER INDEX "UserProblemContent_owner_name_idx" RENAME TO "UserProblemContent_problemId_userId_kind_nameKey_idx";

-- RenameIndex
ALTER INDEX "UserProblemContent_problem_kind_visibility_idx" RENAME TO "UserProblemContent_problemId_kind_visibility_deletedAt_idx";

-- RenameIndex
ALTER INDEX "SolutionContentFingerprint_targetType_targetId_algorithmVersion" RENAME TO "SolutionContentFingerprint_targetType_targetId_algorithmVer_key";

-- RenameIndex
ALTER INDEX "OrganizationCreationApplication_applicantUserId_status_createdA" RENAME TO "OrganizationCreationApplication_applicantUserId_status_crea_idx";

-- RenameIndex
ALTER INDEX "TrainingStageParticipantAssignment_participant_stage_idx" RENAME TO "TrainingSessionStageParticipantAssignment_participantId_sta_idx";

-- RenameIndex
ALTER INDEX "TrainingStageParticipantAssignment_stage_participant_key" RENAME TO "TrainingSessionStageParticipantAssignment_stageId_participa_key";

-- RenameIndex
ALTER INDEX "TrainingStageProblemPlan_stageProblemId_idx" RENAME TO "TrainingSessionStageProblemPlan_stageProblemId_idx";

-- RenameIndex
ALTER INDEX "TrainingStageProblemPlan_stage_group_order_idx" RENAME TO "TrainingSessionStageProblemPlan_stageId_groupId_orderIndex_idx";

-- RenameIndex
ALTER INDEX "TrainingStageGroupChange_participant_requested_idx" RENAME TO "TrainingSessionStageGroupChange_participantId_requestedAt_idx";

-- RenameIndex
ALTER INDEX "TrainingStageGroupChange_session_stage_requested_idx" RENAME TO "TrainingSessionStageGroupChange_sessionId_stageId_requested_idx";

-- RenameIndex
ALTER INDEX "TrainingStageTimeAdjustment_stage_created_idx" RENAME TO "TrainingSessionStageTimeAdjustment_stageId_createdAt_idx";

-- RenameIndex
ALTER INDEX "TrainingSessionStrategyDecision_sessionId_participantId_created" RENAME TO "TrainingSessionStrategyDecision_sessionId_participantId_cre_idx";

