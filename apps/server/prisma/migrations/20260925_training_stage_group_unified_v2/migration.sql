-- Collapse the unshipped multi-layer V2 prototype into the final Stage x stable Group model.
-- The prototype tables must still be empty; otherwise an explicit data migration is required.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TrainingSessionStageGroupPlan" LIMIT 1)
     OR EXISTS (SELECT 1 FROM "TrainingSessionGroupRuntimeState" LIMIT 1)
     OR EXISTS (SELECT 1 FROM "TrainingSessionStageGroupRuntimeSnapshot" LIMIT 1)
     OR EXISTS (SELECT 1 FROM "TrainingSessionGroupMembership" LIMIT 1) THEN
    RAISE EXCEPTION 'TRAINING_V2_PROTOTYPE_NOT_EMPTY';
  END IF;
END $$;

ALTER TABLE "TrainingSessionParticipant"
  ADD COLUMN "groupId" TEXT;

ALTER TABLE "TrainingSessionParticipant"
  ADD CONSTRAINT "TrainingSessionParticipant_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TrainingSessionGroup"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "TrainingSessionParticipant_sessionId_groupId_idx"
  ON "TrainingSessionParticipant"("sessionId", "groupId");

ALTER TABLE "TrainingSessionStageParticipantAssignment"
  RENAME CONSTRAINT "TrainingStageParticipantAssignment_groupId_fkey"
  TO "TrainingSessionStageParticipantAssignment_legacyStageGroupId_fkey";

ALTER TABLE "TrainingSessionStageParticipantAssignment"
  RENAME COLUMN "groupId" TO "legacyStageGroupId";

ALTER TABLE "TrainingSessionStageParticipantAssignment"
  ADD COLUMN "groupId" TEXT;

ALTER TABLE "TrainingSessionStageParticipantAssignment"
  ADD CONSTRAINT "TrainingSessionStageParticipantAssignment_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TrainingSessionGroup"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "TrainingSessionStageParticipantAssignment_groupId_idx";
CREATE INDEX "TrainingSessionStageParticipantAssignment_groupId_idx"
  ON "TrainingSessionStageParticipantAssignment"("groupId");
CREATE INDEX "TrainingSessionStageParticipantAssignment_legacyStageGroupId_idx"
  ON "TrainingSessionStageParticipantAssignment"("legacyStageGroupId");

ALTER TABLE "TrainingSessionStageGroup"
  ALTER COLUMN "name" DROP NOT NULL,
  ADD COLUMN "groupId" TEXT,
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'PRACTICE',
  ADD COLUMN "transitionPolicy" TEXT NOT NULL DEFAULT 'WAIT_FOR_TEACHER',
  ADD COLUMN "plannedDurationSeconds" INTEGER,
  ADD COLUMN "completionThreshold" INTEGER,
  ADD COLUMN "minDurationSeconds" INTEGER,
  ADD COLUMN "completionPolicy" JSONB,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "runningSince" TIMESTAMP(3),
  ADD COLUMN "activeElapsedSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "endReason" TEXT;

ALTER TABLE "TrainingSessionStageGroup"
  ADD CONSTRAINT "TrainingSessionStageGroup_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TrainingSessionGroup"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TrainingSessionStageGroup_stageId_groupId_key"
  ON "TrainingSessionStageGroup"("stageId", "groupId");
CREATE INDEX "TrainingSessionStageGroup_stageId_status_idx"
  ON "TrainingSessionStageGroup"("stageId", "status");
CREATE INDEX "TrainingSessionStageGroup_groupId_status_idx"
  ON "TrainingSessionStageGroup"("groupId", "status");

ALTER TABLE "TrainingSessionStageProblemPlan"
  DROP CONSTRAINT IF EXISTS "TrainingSessionStageProblemPlan_stageGroupPlanId_fkey";
DROP INDEX IF EXISTS "TrainingSessionStageProblemPlan_stageGroupPlanId_idx";
ALTER TABLE "TrainingSessionStageProblemPlan"
  DROP COLUMN "stageGroupPlanId";

DROP TABLE "TrainingSessionStageGroupRuntimeSnapshot";
DROP TABLE "TrainingSessionGroupRuntimeState";
DROP TABLE "TrainingSessionStageGroupPlan";
DROP TABLE "TrainingSessionGroupMembership";
