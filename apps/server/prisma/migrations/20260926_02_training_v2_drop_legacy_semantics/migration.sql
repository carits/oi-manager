BEGIN;

-- Training Engine finalization, phase B: destructive removal of legacy semantic duplicates.
-- Phase A has already established unambiguous stable Group and StageGroup identities.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TrainingSessionParticipant" WHERE "groupId" IS NULL)
     OR EXISTS (SELECT 1 FROM "TrainingSessionStageGroup" WHERE "groupId" IS NULL)
     OR EXISTS (SELECT 1 FROM "TrainingSessionStageParticipantAssignment" WHERE "groupId" IS NULL) THEN
    RAISE EXCEPTION 'TRAINING_V2_FINALIZE_DROP_REFUSED: required group mapping is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM "TrainingSessionStageGroupChange" LIMIT 1) THEN
    RAISE EXCEPTION 'TRAINING_V2_FINALIZE_DROP_REFUSED: legacy group-change history remains';
  END IF;
END $$;

ALTER TABLE "TrainingSessionStageGroupChange" DROP CONSTRAINT IF EXISTS "TrainingSessionStageGroupChange_fromGroupId_fkey";
ALTER TABLE "TrainingSessionStageGroupChange" DROP CONSTRAINT IF EXISTS "TrainingSessionStageGroupChange_participantId_fkey";
ALTER TABLE "TrainingSessionStageGroupChange" DROP CONSTRAINT IF EXISTS "TrainingSessionStageGroupChange_stageId_fkey";
ALTER TABLE "TrainingSessionStageGroupChange" DROP CONSTRAINT IF EXISTS "TrainingSessionStageGroupChange_toGroupId_fkey";
ALTER TABLE "TrainingSessionStageParticipantAssignment" DROP CONSTRAINT IF EXISTS "TrainingSessionStageParticipantAssignment_legacyStageGroup_fkey";
DROP INDEX IF EXISTS "TrainingSessionParticipant_sessionId_currentStageId_idx";
DROP INDEX IF EXISTS "TrainingSessionStage_sessionId_lifecycle_idx";
DROP INDEX IF EXISTS "TrainingSessionStageGroup_stageId_name_key";
DROP INDEX IF EXISTS "TrainingSessionStageGroup_stageId_orderIndex_key";
DROP INDEX IF EXISTS "TrainingSessionStageParticipantAssignment_legacyStageGroupId_id";
DROP INDEX IF EXISTS "TrainingStageParticipantAssignment_groupId_idx";

ALTER TABLE "TrainingSession" DROP COLUMN "currentStageId", DROP COLUMN "groupingModelVersion";
ALTER TABLE "TrainingSessionParticipant" DROP COLUMN "currentStageId", DROP COLUMN "returnStageId", ALTER COLUMN "groupId" SET NOT NULL;
ALTER TABLE "TrainingSessionStage"
  DROP COLUMN "accessPolicy", DROP COLUMN "activeElapsedSeconds", DROP COLUMN "audienceMode", DROP COLUMN "completionThreshold",
  DROP COLUMN "defaultTargetScore", DROP COLUMN "definitionRevision", DROP COLUMN "endNote", DROP COLUMN "endPolicy",
  DROP COLUMN "endReason", DROP COLUMN "endedAt", DROP COLUMN "endedBy", DROP COLUMN "lifecycle", DROP COLUMN "minDurationSeconds",
  DROP COLUMN "plannedDurationSeconds", DROP COLUMN "rules", DROP COLUMN "runningSince", DROP COLUMN "startedAt", DROP COLUMN "submissionMode";
ALTER TABLE "TrainingSessionStageGroup" DROP COLUMN "name", DROP COLUMN "orderIndex", ALTER COLUMN "groupId" SET NOT NULL;
ALTER TABLE "TrainingSessionStageParticipantAssignment" DROP COLUMN "legacyStageGroupId", ALTER COLUMN "groupId" SET NOT NULL;
ALTER TABLE "TrainingSessionTemplateStage" DROP COLUMN "audienceMode";
DROP TABLE "TrainingSessionStageGroupChange";

-- A stable Group can have at most one active runtime unit.
CREATE UNIQUE INDEX "TrainingSessionStageGroup_one_active_unit_per_group_key"
  ON "TrainingSessionStageGroup"("groupId") WHERE status IN ('RUNNING', 'PAUSED');

COMMIT;
