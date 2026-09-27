BEGIN;

-- Training Engine: one global Stage timeline per session.
-- Refuse to infer or merge active per-group runtimes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "TrainingSessionStageGroup"
    WHERE "status" <> 'PENDING'
  ) OR EXISTS (
    SELECT 1
    FROM "TrainingSession"
    WHERE "status" IN ('RUNNING', 'PAUSED')
  ) THEN
    RAISE EXCEPTION 'TRAINING_GLOBAL_STAGE_MIGRATION_ACTIVE_RUNTIME_FOUND';
  END IF;
END $$;

ALTER TABLE "TrainingSession"
  ADD COLUMN "currentStageId" TEXT;

ALTER TABLE "TrainingSessionStage"
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'PRACTICE',
  ADD COLUMN "accessPolicy" "TrainingEngineStageAccessPolicy" NOT NULL DEFAULT 'ALL_AT_ONCE',
  ADD COLUMN "submissionMode" "TrainingEngineSubmissionMode" NOT NULL DEFAULT 'ENABLED',
  ADD COLUMN "endPolicy" "TrainingEngineStageEndPolicy" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "plannedDurationSeconds" INTEGER,
  ADD COLUMN "minDurationSeconds" INTEGER,
  ADD COLUMN "completionThreshold" INTEGER,
  ADD COLUMN "completionPolicy" JSONB,
  ADD COLUMN "rules" JSONB,
  ADD COLUMN "lifecycle" "TrainingEngineStageLifecycle" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "runningSince" TIMESTAMP(3),
  ADD COLUMN "activeElapsedSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "endReason" "TrainingEngineStageEndReason",
  ADD COLUMN "endedBy" TEXT,
  ADD COLUMN "definitionRevision" INTEGER NOT NULL DEFAULT 0;

-- Preserve the first plan's definition as the Stage-wide definition.
WITH first_plan AS (
  SELECT DISTINCT ON (sg."stageId")
    sg."stageId",
    sg."mode",
    sg."accessPolicy",
    sg."submissionMode",
    sg."plannedDurationSeconds",
    sg."minDurationSeconds",
    sg."completionThreshold",
    sg."completionPolicy",
    sg."rules"
  FROM "TrainingSessionStageGroup" sg
  JOIN "TrainingSessionGroup" g ON g."id" = sg."groupId"
  ORDER BY sg."stageId", g."orderIndex", sg."createdAt"
)
UPDATE "TrainingSessionStage" stage
SET
  "mode" = first_plan."mode",
  "accessPolicy" = first_plan."accessPolicy",
  "submissionMode" = first_plan."submissionMode",
  "plannedDurationSeconds" = first_plan."plannedDurationSeconds",
  "minDurationSeconds" = first_plan."minDurationSeconds",
  "completionThreshold" = first_plan."completionThreshold",
  "completionPolicy" = first_plan."completionPolicy",
  "rules" = first_plan."rules"
FROM first_plan
WHERE first_plan."stageId" = stage."id";

ALTER TABLE "TrainingSession"
  ADD CONSTRAINT "TrainingSession_currentStageId_fkey"
  FOREIGN KEY ("currentStageId") REFERENCES "TrainingSessionStage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "TrainingSession_currentStageId_key"
  ON "TrainingSession"("currentStageId");
CREATE INDEX "TrainingSessionStage_sessionId_lifecycle_orderIndex_idx"
  ON "TrainingSessionStage"("sessionId", "lifecycle", "orderIndex");

ALTER TABLE "TrainingSessionStageGroup"
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "inheritsDefault" BOOLEAN NOT NULL DEFAULT true,
  ALTER COLUMN "groupId" DROP NOT NULL;

-- The first group plan becomes the default plan. Remaining rows are explicit group overrides.
WITH defaults AS (
  SELECT DISTINCT ON (sg."stageId") sg."id"
  FROM "TrainingSessionStageGroup" sg
  JOIN "TrainingSessionGroup" g ON g."id" = sg."groupId"
  ORDER BY sg."stageId", g."orderIndex", sg."createdAt"
)
UPDATE "TrainingSessionStageGroup" plan
SET "groupId" = NULL, "isDefault" = true, "inheritsDefault" = false
FROM defaults
WHERE plan."id" = defaults."id";

-- A malformed draft may have a Stage without any plan; create its default deterministically.
INSERT INTO "TrainingSessionStageGroup" (
  "id", "stageId", "groupId", "mode", "accessPolicy", "submissionMode",
  "rules", "completionPolicy", "transitionPolicy", "status",
  "activeElapsedSeconds", "isDefault", "inheritsDefault", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  stage."id",
  NULL,
  stage."mode",
  stage."accessPolicy",
  stage."submissionMode",
  stage."rules",
  stage."completionPolicy",
  'WAIT_FOR_TEACHER',
  'PENDING',
  0,
  true,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "TrainingSessionStage" stage
WHERE NOT EXISTS (
  SELECT 1 FROM "TrainingSessionStageGroup" plan
  WHERE plan."stageId" = stage."id" AND plan."isDefault" = true
);

ALTER TABLE "TrainingSessionStageProblemPlan"
  ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT true;

-- Ensure every canonical StageProblem appears in the default plan before removing duplicate policy columns.
INSERT INTO "TrainingSessionStageProblemPlan" (
  "id", "stageId", "stageProblemId", "stageGroupId", "required", "orderIndex",
  "unlockPolicy", "targetScore", "scoreGoals", "timePolicy", "stuckPolicy",
  "hintPolicy", "allowedSubtaskIds", "judgeConfigProjection",
  "strategyIntervalSeconds", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  problem."stageId",
  problem."id",
  plan."id",
  true,
  problem."orderIndex",
  problem."unlockPolicy",
  problem."targetScore",
  problem."scoreGoals",
  problem."timePolicy",
  problem."stuckPolicy",
  problem."hintPolicy",
  problem."allowedSubtaskIds",
  problem."judgeConfigProjection",
  problem."strategyIntervalSeconds",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "TrainingSessionStageProblem" problem
JOIN "TrainingSessionStageGroup" plan
  ON plan."stageId" = problem."stageId" AND plan."isDefault" = true
WHERE NOT EXISTS (
  SELECT 1
  FROM "TrainingSessionStageProblemPlan" existing
  WHERE existing."stageGroupId" = plan."id"
    AND existing."stageProblemId" = problem."id"
);

ALTER TABLE "TrainingSessionStageProblem"
  DROP COLUMN "unlockPolicy",
  DROP COLUMN "targetScore",
  DROP COLUMN "scoreGoals",
  DROP COLUMN "timePolicy",
  DROP COLUMN "stuckPolicy",
  DROP COLUMN "hintPolicy",
  DROP COLUMN "allowedSubtaskIds",
  DROP COLUMN "judgeConfigProjection",
  DROP COLUMN "strategyIntervalSeconds";

ALTER TABLE "TrainingSessionGroupChange"
  ADD COLUMN "effectiveMode" "TrainingEngineGroupChangeEffectiveMode" NOT NULL DEFAULT 'IMMEDIATE',
  ADD COLUMN "targetStageId" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'applied',
  ADD COLUMN "appliedAt" TIMESTAMP(3);

UPDATE "TrainingSessionGroupChange"
SET "appliedAt" = COALESCE("effectiveAt", "createdAt");

ALTER TABLE "TrainingSessionGroupChange"
  ADD CONSTRAINT "TrainingSessionGroupChange_targetStageId_fkey"
  FOREIGN KEY ("targetStageId") REFERENCES "TrainingSessionStage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "TrainingSessionGroupChange_sessionId_status_targetStageId_idx"
  ON "TrainingSessionGroupChange"("sessionId", "status", "targetStageId");

CREATE TABLE "TrainingSessionStageRuntimeSnapshot" (
  "id" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "definitionRevision" INTEGER NOT NULL,
  "config" JSONB NOT NULL,
  "configHash" TEXT NOT NULL,
  "startedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingSessionStageRuntimeSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingSessionStageRuntimeSnapshot_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "TrainingSessionStage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrainingSessionStageRuntimeSnapshot_stageId_key"
  ON "TrainingSessionStageRuntimeSnapshot"("stageId");
CREATE INDEX "TrainingSessionStageRuntimeSnapshot_sessionId_createdAt_idx"
  ON "TrainingSessionStageRuntimeSnapshot"("sessionId", "createdAt");

DROP INDEX IF EXISTS "TrainingSessionStageGroup_one_active_unit_per_group_key";
DROP INDEX IF EXISTS "TrainingSessionStageGroup_stageId_status_idx";
DROP INDEX IF EXISTS "TrainingSessionStageGroup_groupId_status_idx";

ALTER TABLE "TrainingSessionStageGroup"
  DROP COLUMN "mode",
  DROP COLUMN "plannedDurationSeconds",
  DROP COLUMN "completionThreshold",
  DROP COLUMN "minDurationSeconds",
  DROP COLUMN "transitionPolicy",
  DROP COLUMN "status",
  DROP COLUMN "startedAt",
  DROP COLUMN "runningSince",
  DROP COLUMN "activeElapsedSeconds",
  DROP COLUMN "endedAt",
  DROP COLUMN "endReason";

ALTER TABLE "TrainingSessionStageGroup"
  DROP CONSTRAINT IF EXISTS "TrainingSessionStageGroup_groupId_fkey";
ALTER TABLE "TrainingSessionStageGroup"
  ADD CONSTRAINT "TrainingSessionStageGroup_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TrainingSessionGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionStageGroup"
  ADD CONSTRAINT "TrainingSessionStageGroup_default_shape_check"
  CHECK (
    ("isDefault" = true AND "groupId" IS NULL AND "inheritsDefault" = false)
    OR
    ("isDefault" = false AND "groupId" IS NOT NULL)
  );
CREATE UNIQUE INDEX "TrainingSessionStageGroup_one_default_per_stage_key"
  ON "TrainingSessionStageGroup"("stageId") WHERE "isDefault" = true;
CREATE INDEX "TrainingSessionStageGroup_groupId_idx"
  ON "TrainingSessionStageGroup"("groupId");

DROP TABLE "TrainingSessionStageParticipantAssignment";

COMMIT;
