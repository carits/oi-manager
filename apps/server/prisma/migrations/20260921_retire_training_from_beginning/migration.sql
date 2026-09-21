-- Retire participant-local FROM_BEGINNING semantics.
-- Existing rows using FROM_BEGINNING are normalized to CURRENT_STAGE before the enum is narrowed.

ALTER TYPE "TrainingEngineJoinMode" RENAME TO "TrainingEngineJoinMode_old";

CREATE TYPE "TrainingEngineJoinMode" AS ENUM ('CURRENT_STAGE', 'TEACHER_ASSIGN');

ALTER TABLE "TrainingSession"
  ALTER COLUMN "joinMode" DROP DEFAULT;

ALTER TABLE "TrainingSession"
  ALTER COLUMN "joinMode" TYPE "TrainingEngineJoinMode"
  USING (
    CASE
      WHEN "joinMode"::text = 'FROM_BEGINNING' THEN 'CURRENT_STAGE'
      ELSE "joinMode"::text
    END
  )::"TrainingEngineJoinMode";

ALTER TABLE "TrainingSession"
  ALTER COLUMN "joinMode" SET DEFAULT 'CURRENT_STAGE';

DROP TYPE "TrainingEngineJoinMode_old";
