BEGIN;

-- Training Engine finalization, phase A: fail-closed data audit and identity-preserving rename.
-- Deterministically attach every historical Stage assignment to the participant's stable Group.
UPDATE "TrainingSessionStageParticipantAssignment" assignment
SET "groupId" = participant."groupId"
FROM "TrainingSessionParticipant" participant
WHERE assignment."participantId" = participant.id
  AND assignment."groupId" IS NULL
  AND participant."groupId" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TrainingSession" WHERE "groupingModelVersion" < 2) THEN
    RAISE EXCEPTION 'TRAINING_V2_FINALIZE_PRECONDITION_FAILED: legacy session exists';
  END IF;
  IF EXISTS (SELECT 1 FROM "TrainingSessionParticipant" WHERE "groupId" IS NULL) THEN
    RAISE EXCEPTION 'TRAINING_V2_FINALIZE_PRECONDITION_FAILED: participant without stable group';
  END IF;
  IF EXISTS (SELECT 1 FROM "TrainingSessionStageGroup" WHERE "groupId" IS NULL) THEN
    RAISE EXCEPTION 'TRAINING_V2_FINALIZE_PRECONDITION_FAILED: stage group without stable group';
  END IF;
  IF EXISTS (SELECT 1 FROM "TrainingSessionStageParticipantAssignment" WHERE "groupId" IS NULL OR "legacyStageGroupId" IS NOT NULL) THEN
    RAISE EXCEPTION 'TRAINING_V2_FINALIZE_PRECONDITION_FAILED: ambiguous participant assignment';
  END IF;
  IF EXISTS (SELECT 1 FROM "TrainingSessionStageGroupChange" LIMIT 1) THEN
    RAISE EXCEPTION 'TRAINING_V2_FINALIZE_PRECONDITION_FAILED: legacy stage-scoped group history exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "TrainingSessionStageGroup" sg
    JOIN "TrainingSessionStage" s ON s.id = sg."stageId"
    JOIN "TrainingSessionGroup" g ON g.id = sg."groupId"
    WHERE s."sessionId" <> g."sessionId"
  ) THEN RAISE EXCEPTION 'TRAINING_V2_FINALIZE_PRECONDITION_FAILED: cross-session stage group'; END IF;
  IF EXISTS (
    SELECT "stageId", "groupId" FROM "TrainingSessionStageGroup"
    GROUP BY "stageId", "groupId" HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'TRAINING_V2_FINALIZE_PRECONDITION_FAILED: duplicate stage group'; END IF;
  IF EXISTS (
    SELECT "groupId" FROM "TrainingSessionStageGroup"
    WHERE status IN ('RUNNING', 'PAUSED') GROUP BY "groupId" HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'TRAINING_V2_FINALIZE_PRECONDITION_FAILED: group has multiple active units'; END IF;
  IF EXISTS (
    SELECT 1 FROM "TrainingSessionParticipant" p
    JOIN "TrainingSessionGroup" g ON g.id = p."groupId"
    WHERE p."sessionId" <> g."sessionId"
  ) THEN RAISE EXCEPTION 'TRAINING_V2_FINALIZE_PRECONDITION_FAILED: participant group belongs to another session'; END IF;
  IF EXISTS (
    SELECT 1 FROM "TrainingSessionStageProblemPlan" plan
    JOIN "TrainingSessionStage" s ON s.id = plan."stageId"
    JOIN "TrainingSessionStageProblem" sp ON sp.id = plan."stageProblemId"
    JOIN "TrainingSessionStageGroup" sg ON sg.id = plan."groupId"
    WHERE plan."stageId" <> sp."stageId" OR plan."stageId" <> sg."stageId"
  ) THEN RAISE EXCEPTION 'TRAINING_V2_FINALIZE_PRECONDITION_FAILED: problem plan stage mismatch'; END IF;
END $$;

-- Preserve every plan identity and relation; only correct the misleading column name.
ALTER TABLE "TrainingSessionStageProblemPlan" RENAME COLUMN "groupId" TO "stageGroupId";
ALTER TABLE "TrainingSessionStageProblemPlan" RENAME CONSTRAINT "TrainingSessionStageProblemPlan_groupId_fkey" TO "TrainingSessionStageProblemPlan_stageGroupId_fkey";
DROP INDEX IF EXISTS "TrainingSessionStageProblemPlan_stageId_groupId_orderIndex_idx";
CREATE INDEX "TrainingSessionStageProblemPlan_stageId_stageGroupId_orderI_idx" ON "TrainingSessionStageProblemPlan"("stageId", "stageGroupId", "orderIndex");

COMMIT;
