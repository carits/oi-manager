-- Rating configuration, standing snapshots and batches are Contest-owned facts.
-- Remove the temporary Training identity after filling the canonical key once.

UPDATE "TrainingRatingConfig" AS config
SET "contestId" = contest."id"
FROM "Contest" AS contest
WHERE config."contestId" IS NULL
  AND contest."runtimeTrainingId" = config."trainingId";

UPDATE "ContestStandingSnapshot" AS snapshot
SET "contestId" = contest."id"
FROM "Contest" AS contest
WHERE snapshot."contestId" IS NULL
  AND contest."runtimeTrainingId" = snapshot."trainingId";

UPDATE "RatingBatch" AS batch
SET "contestId" = contest."id"
FROM "Contest" AS contest
WHERE batch."contestId" IS NULL
  AND contest."runtimeTrainingId" = batch."trainingId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "TrainingRatingConfig" WHERE "contestId" IS NULL
    UNION ALL
    SELECT 1 FROM "ContestStandingSnapshot" WHERE "contestId" IS NULL
    UNION ALL
    SELECT 1 FROM "RatingBatch" WHERE "contestId" IS NULL
  ) THEN
    RAISE EXCEPTION 'contest rating identity cutover blocked by unmapped rows';
  END IF;
END $$;

DROP TRIGGER IF EXISTS "TrainingRatingConfig_canonical_contest_identity" ON "TrainingRatingConfig";
DROP TRIGGER IF EXISTS "ContestStandingSnapshot_canonical_contest_identity" ON "ContestStandingSnapshot";
DROP TRIGGER IF EXISTS "RatingBatch_canonical_contest_identity" ON "RatingBatch";
DROP TRIGGER IF EXISTS "Contest_backfill_rating_identity" ON "Contest";
DROP FUNCTION IF EXISTS "set_canonical_contest_id_from_runtime"();
DROP FUNCTION IF EXISTS "backfill_contest_rating_identity_from_aggregate"();

ALTER TABLE "TrainingRatingConfig"
  ALTER COLUMN "contestId" SET NOT NULL,
  DROP COLUMN "trainingId";

ALTER TABLE "ContestStandingSnapshot"
  ALTER COLUMN "contestId" SET NOT NULL,
  DROP COLUMN "trainingId";

ALTER TABLE "RatingBatch"
  ALTER COLUMN "contestId" SET NOT NULL,
  DROP COLUMN "trainingId";
