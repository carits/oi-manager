BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TrainingSessionStageProblemPlan" WHERE "stageGroupId" IS NULL) THEN
    RAISE EXCEPTION 'TRAINING_V2_FINALIZE_PRECONDITION_FAILED: problem plan without stage group';
  END IF;
END $$;

ALTER TABLE "TrainingSessionStageProblemPlan"
  ALTER COLUMN "stageGroupId" SET NOT NULL;

COMMIT;