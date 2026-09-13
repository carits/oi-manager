-- Expand the contest aggregate boundary to Rating configuration, immutable
-- standing snapshots and Rating batches.  The numeric Training key remains a
-- compatibility projection during the cutover; Contest.id is the canonical
-- identity for every mapped contest record.

ALTER TABLE "TrainingRatingConfig" ADD COLUMN "contestId" TEXT;
ALTER TABLE "ContestStandingSnapshot" ADD COLUMN "contestId" TEXT;
ALTER TABLE "RatingBatch" ADD COLUMN "contestId" TEXT;

UPDATE "TrainingRatingConfig" AS config
SET "contestId" = contest."id"
FROM "Contest" AS contest
WHERE contest."runtimeTrainingId" = config."trainingId";

UPDATE "ContestStandingSnapshot" AS snapshot
SET "contestId" = contest."id"
FROM "Contest" AS contest
WHERE contest."runtimeTrainingId" = snapshot."trainingId";

UPDATE "RatingBatch" AS batch
SET "contestId" = contest."id"
FROM "Contest" AS contest
WHERE contest."runtimeTrainingId" = batch."trainingId";

-- Fail closed if a Rating fact still points at an unmapped contest runtime.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "TrainingRatingConfig" WHERE "contestId" IS NULL
    UNION ALL
    SELECT 1 FROM "ContestStandingSnapshot" WHERE "contestId" IS NULL
    UNION ALL
    SELECT 1 FROM "RatingBatch" WHERE "contestId" IS NULL
  ) THEN
    RAISE EXCEPTION 'canonical contest backfill incomplete for rating data';
  END IF;
END $$;

-- Keep the old blue/green instance safe during the deployment overlap. An
-- older binary only writes trainingId and creates the aggregate afterwards in
-- the same transaction. The child trigger fills immediately when possible;
-- the Contest trigger repairs that older creation order.
CREATE OR REPLACE FUNCTION "set_canonical_contest_id_from_runtime"()
RETURNS trigger AS $$
DECLARE
  expected_contest_id TEXT;
BEGIN
  SELECT "id" INTO expected_contest_id
  FROM "Contest"
  WHERE "runtimeTrainingId" = NEW."trainingId";

  IF expected_contest_id IS NULL THEN
    IF NEW."contestId" IS NOT NULL THEN
      RAISE EXCEPTION 'rating row references an unmapped contest runtime: %', NEW."trainingId";
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."contestId" IS NOT NULL AND NEW."contestId" <> expected_contest_id THEN
    RAISE EXCEPTION 'rating row contest identity does not match runtime: %', NEW."trainingId";
  END IF;
  NEW."contestId" := expected_contest_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TrainingRatingConfig_canonical_contest_identity"
  BEFORE INSERT OR UPDATE OF "trainingId", "contestId" ON "TrainingRatingConfig"
  FOR EACH ROW EXECUTE FUNCTION "set_canonical_contest_id_from_runtime"();

CREATE TRIGGER "ContestStandingSnapshot_canonical_contest_identity"
  BEFORE INSERT OR UPDATE OF "trainingId", "contestId" ON "ContestStandingSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "set_canonical_contest_id_from_runtime"();

CREATE TRIGGER "RatingBatch_canonical_contest_identity"
  BEFORE INSERT OR UPDATE OF "trainingId", "contestId" ON "RatingBatch"
  FOR EACH ROW EXECUTE FUNCTION "set_canonical_contest_id_from_runtime"();

CREATE OR REPLACE FUNCTION "backfill_contest_rating_identity_from_aggregate"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."runtimeTrainingId" IS DISTINCT FROM NEW."runtimeTrainingId"
     AND (
       EXISTS (SELECT 1 FROM "TrainingRatingConfig" WHERE "contestId" = NEW."id")
       OR EXISTS (SELECT 1 FROM "ContestStandingSnapshot" WHERE "contestId" = NEW."id")
       OR EXISTS (SELECT 1 FROM "RatingBatch" WHERE "contestId" = NEW."id")
     ) THEN
    RAISE EXCEPTION 'cannot remap canonical contest with rating history: %', NEW."id";
  END IF;
  IF NEW."runtimeTrainingId" IS NOT NULL THEN
    UPDATE "TrainingRatingConfig" SET "contestId" = NEW."id"
      WHERE "trainingId" = NEW."runtimeTrainingId" AND "contestId" IS NULL;
    UPDATE "ContestStandingSnapshot" SET "contestId" = NEW."id"
      WHERE "trainingId" = NEW."runtimeTrainingId" AND "contestId" IS NULL;
    UPDATE "RatingBatch" SET "contestId" = NEW."id"
      WHERE "trainingId" = NEW."runtimeTrainingId" AND "contestId" IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Contest_backfill_rating_identity"
  AFTER INSERT OR UPDATE OF "runtimeTrainingId" ON "Contest"
  FOR EACH ROW EXECUTE FUNCTION "backfill_contest_rating_identity_from_aggregate"();

CREATE UNIQUE INDEX "TrainingRatingConfig_contestId_key"
  ON "TrainingRatingConfig"("contestId");
CREATE UNIQUE INDEX "ContestStandingSnapshot_contestId_revision_key"
  ON "ContestStandingSnapshot"("contestId", "revision");
CREATE INDEX "ContestStandingSnapshot_contestId_status_idx"
  ON "ContestStandingSnapshot"("contestId", "status");
CREATE INDEX "RatingBatch_contestId_status_idx"
  ON "RatingBatch"("contestId", "status");

ALTER TABLE "TrainingRatingConfig"
  ADD CONSTRAINT "TrainingRatingConfig_contestId_fkey"
  FOREIGN KEY ("contestId") REFERENCES "Contest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContestStandingSnapshot"
  ADD CONSTRAINT "ContestStandingSnapshot_contestId_fkey"
  FOREIGN KEY ("contestId") REFERENCES "Contest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RatingBatch"
  ADD CONSTRAINT "RatingBatch_contestId_fkey"
  FOREIGN KEY ("contestId") REFERENCES "Contest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
