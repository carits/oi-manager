-- Normalize Training Stage terminal lifecycle and preserve legacy free-form end reasons.
-- Existing COMPLETED/ENDED_EARLY rows are both terminal and become ENDED.
-- Existing endReason text is preserved verbatim in endNote.

ALTER TABLE "TrainingSessionStage"
  RENAME COLUMN "endReason" TO "endNote";

CREATE TYPE "TrainingEngineStageEndReason" AS ENUM (
  'TIME_REACHED',
  'COMPLETION_REACHED',
  'HYBRID_REACHED',
  'TEACHER_ENDED',
  'TEACHER_ENDED_EARLY',
  'SESSION_ENDED',
  'SYSTEM_ENDED'
);

ALTER TABLE "TrainingSessionStage"
  ADD COLUMN "endReason" "TrainingEngineStageEndReason";

-- Preserve the old lifecycle meaning before collapsing terminal states.
UPDATE "TrainingSessionStage"
SET "endReason" = CASE
  WHEN "lifecycle"::text = 'ENDED_EARLY' THEN 'TEACHER_ENDED_EARLY'::"TrainingEngineStageEndReason"
  WHEN "lifecycle"::text = 'COMPLETED' THEN 'SYSTEM_ENDED'::"TrainingEngineStageEndReason"
  ELSE NULL
END
WHERE "lifecycle"::text IN ('COMPLETED', 'ENDED_EARLY');

CREATE TYPE "TrainingEngineStageLifecycle_new" AS ENUM (
  'PENDING',
  'RUNNING',
  'ENDED',
  'SKIPPED'
);

ALTER TABLE "TrainingSessionStage"
  ALTER COLUMN "lifecycle" DROP DEFAULT;

ALTER TABLE "TrainingSessionStage"
  ALTER COLUMN "lifecycle" TYPE "TrainingEngineStageLifecycle_new"
  USING (
    CASE
      WHEN "lifecycle"::text IN ('COMPLETED', 'ENDED_EARLY') THEN 'ENDED'
      ELSE "lifecycle"::text
    END
  )::"TrainingEngineStageLifecycle_new";

DROP TYPE "TrainingEngineStageLifecycle";

ALTER TYPE "TrainingEngineStageLifecycle_new"
  RENAME TO "TrainingEngineStageLifecycle";

ALTER TABLE "TrainingSessionStage"
  ALTER COLUMN "lifecycle" SET DEFAULT 'PENDING';

-- Historical free-form text remains verbatim in endNote; canonical reason was
-- inferred above while the old lifecycle value was still available.


-- Focus is runtime state, not persisted problem progress. Normalize the retired
-- FOCUS_OVERRIDE value before rebuilding the enum without it.
CREATE TYPE "TrainingEngineProgressStatus_new" AS ENUM (
  'NOT_STARTED',
  'WORKING',
  'STUCK',
  'COMPLETED',
  'SKIPPED',
  'PAUSED'
);

ALTER TABLE "TrainingSessionProblemProgress"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "TrainingSessionProblemProgress"
  ALTER COLUMN "status" TYPE "TrainingEngineProgressStatus_new"
  USING (
    CASE
      WHEN "status"::text = 'FOCUS_OVERRIDE' THEN 'WORKING'
      ELSE "status"::text
    END
  )::"TrainingEngineProgressStatus_new";

DROP TYPE "TrainingEngineProgressStatus";

ALTER TYPE "TrainingEngineProgressStatus_new"
  RENAME TO "TrainingEngineProgressStatus";

ALTER TABLE "TrainingSessionProblemProgress"
  ALTER COLUMN "status" SET DEFAULT 'NOT_STARTED';
