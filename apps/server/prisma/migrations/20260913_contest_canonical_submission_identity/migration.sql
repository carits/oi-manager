-- Give contest-owned submission/runtime facts a canonical Contest identity.
-- Numeric Training/TrainingProblem identifiers remain compatibility columns
-- until public routes have moved away from the historical runtime host.

ALTER TABLE "Submission"
  ADD COLUMN "canonicalContestId" TEXT,
  ADD COLUMN "canonicalContestProblemId" TEXT;

ALTER TABLE "ContestUserProblemStatus"
  ADD COLUMN "canonicalContestId" TEXT,
  ADD COLUMN "canonicalContestProblemId" TEXT;

ALTER TABLE "ContestRecord"
  ADD COLUMN "canonicalContestId" TEXT;

UPDATE "Submission" AS submission
SET
  "canonicalContestId" = contest."id",
  "canonicalContestProblemId" = problem."id"
FROM "Contest" AS contest,
     "ContestProblem" AS problem
WHERE submission."submitScope" = 'contest'
  AND contest."runtimeTrainingId" = COALESCE(submission."contestId", submission."trainingId")
  AND problem."contestId" = contest."id"
  AND problem."runtimeTrainingProblemId" = COALESCE(submission."contestProblemId", submission."trainingProblemId");

UPDATE "ContestUserProblemStatus" AS status
SET
  "canonicalContestId" = contest."id",
  "canonicalContestProblemId" = problem."id"
FROM "Contest" AS contest,
     "ContestProblem" AS problem
WHERE contest."runtimeTrainingId" = status."contestId"
  AND problem."contestId" = contest."id"
  AND problem."runtimeTrainingProblemId" = status."contestProblemId";

UPDATE "ContestRecord" AS record
SET "canonicalContestId" = contest."id"
FROM "Contest" AS contest
WHERE contest."runtimeTrainingId" = record."trainingId";

-- The aggregate migration must have mapped every contest child before this
-- cutover. Abort the whole migration instead of inventing an identity.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Submission"
    WHERE "submitScope" = 'contest'
      AND ("canonicalContestId" IS NULL OR "canonicalContestProblemId" IS NULL)
  ) THEN
    RAISE EXCEPTION 'canonical contest backfill incomplete for submissions';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ContestUserProblemStatus"
    WHERE "canonicalContestId" IS NULL OR "canonicalContestProblemId" IS NULL
  ) THEN
    RAISE EXCEPTION 'canonical contest backfill incomplete for contest problem status';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ContestRecord" record
    JOIN "Training" training ON training."id" = record."trainingId"
    WHERE training."type" = 'contest' AND record."canonicalContestId" IS NULL
  ) THEN
    RAISE EXCEPTION 'canonical contest backfill incomplete for contest records';
  END IF;
END $$;

CREATE UNIQUE INDEX "ContestRecord_canonicalContestId_userId_userType_key"
  ON "ContestRecord"("canonicalContestId", "userId", "userType");
CREATE INDEX "ContestRecord_canonicalContestId_idx"
  ON "ContestRecord"("canonicalContestId");

CREATE UNIQUE INDEX "ContestUserProblemStatus_canonical_identity_key"
  ON "ContestUserProblemStatus"("canonicalContestId", "userId", "canonicalContestProblemId");
CREATE INDEX "ContestUserProblemStatus_canonicalContestId_userId_idx"
  ON "ContestUserProblemStatus"("canonicalContestId", "userId");

CREATE INDEX "Submission_canonicalContestId_idx"
  ON "Submission"("canonicalContestId");
CREATE INDEX "Submission_canonicalContestProblemId_idx"
  ON "Submission"("canonicalContestProblemId");

ALTER TABLE "ContestRecord"
  ADD CONSTRAINT "ContestRecord_canonicalContestId_fkey"
  FOREIGN KEY ("canonicalContestId") REFERENCES "Contest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContestUserProblemStatus"
  ADD CONSTRAINT "ContestUserProblemStatus_canonicalContestId_fkey"
  FOREIGN KEY ("canonicalContestId") REFERENCES "Contest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContestUserProblemStatus_canonicalContestProblemId_fkey"
  FOREIGN KEY ("canonicalContestProblemId") REFERENCES "ContestProblem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_canonicalContestId_fkey"
  FOREIGN KEY ("canonicalContestId") REFERENCES "Contest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Submission_canonicalContestProblemId_fkey"
  FOREIGN KEY ("canonicalContestProblemId") REFERENCES "ContestProblem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Compatibility triggers protect a blue/green overlap where the old binary
-- still writes only numeric runtime keys. They also reject split identities
-- supplied by a newer caller.
CREATE OR REPLACE FUNCTION "set_submission_canonical_contest_identity"()
RETURNS trigger AS $$
DECLARE
  expected_contest_id TEXT;
  expected_problem_id TEXT;
BEGIN
  IF NEW."submitScope" <> 'contest' THEN
    IF NEW."canonicalContestId" IS NOT NULL OR NEW."canonicalContestProblemId" IS NOT NULL THEN
      RAISE EXCEPTION 'non-contest submission cannot reference a canonical contest';
    END IF;
    RETURN NEW;
  END IF;

  SELECT "id" INTO expected_contest_id FROM "Contest"
    WHERE "runtimeTrainingId" = COALESCE(NEW."contestId", NEW."trainingId");
  IF expected_contest_id IS NULL THEN
    RAISE EXCEPTION 'contest submission references an unmapped runtime';
  END IF;

  SELECT "id" INTO expected_problem_id FROM "ContestProblem"
    WHERE "contestId" = expected_contest_id
      AND "runtimeTrainingProblemId" = COALESCE(NEW."contestProblemId", NEW."trainingProblemId");
  IF expected_problem_id IS NULL THEN
    RAISE EXCEPTION 'contest submission references an unmapped runtime problem';
  END IF;

  IF NEW."canonicalContestId" IS NOT NULL AND NEW."canonicalContestId" <> expected_contest_id THEN
    RAISE EXCEPTION 'submission canonical contest identity mismatch';
  END IF;
  IF NEW."canonicalContestProblemId" IS NOT NULL AND NEW."canonicalContestProblemId" <> expected_problem_id THEN
    RAISE EXCEPTION 'submission canonical contest problem identity mismatch';
  END IF;
  NEW."canonicalContestId" := expected_contest_id;
  NEW."canonicalContestProblemId" := expected_problem_id;
  NEW."contestId" := COALESCE(NEW."contestId", NEW."trainingId");
  NEW."contestProblemId" := COALESCE(NEW."contestProblemId", NEW."trainingProblemId");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Submission_canonical_contest_identity"
  BEFORE INSERT OR UPDATE OF "submitScope", "trainingId", "contestId", "contestProblemId", "canonicalContestId", "canonicalContestProblemId"
  ON "Submission" FOR EACH ROW
  EXECUTE FUNCTION "set_submission_canonical_contest_identity"();

CREATE OR REPLACE FUNCTION "set_contest_status_canonical_identity"()
RETURNS trigger AS $$
DECLARE
  expected_contest_id TEXT;
  expected_problem_id TEXT;
BEGIN
  SELECT "id" INTO expected_contest_id FROM "Contest"
    WHERE "runtimeTrainingId" = NEW."contestId";
  SELECT "id" INTO expected_problem_id FROM "ContestProblem"
    WHERE "contestId" = expected_contest_id
      AND "runtimeTrainingProblemId" = NEW."contestProblemId";
  IF expected_contest_id IS NULL OR expected_problem_id IS NULL THEN
    RAISE EXCEPTION 'contest status references an unmapped runtime identity';
  END IF;
  IF NEW."canonicalContestId" IS NOT NULL AND NEW."canonicalContestId" <> expected_contest_id THEN
    RAISE EXCEPTION 'contest status canonical contest identity mismatch';
  END IF;
  IF NEW."canonicalContestProblemId" IS NOT NULL AND NEW."canonicalContestProblemId" <> expected_problem_id THEN
    RAISE EXCEPTION 'contest status canonical problem identity mismatch';
  END IF;
  NEW."canonicalContestId" := expected_contest_id;
  NEW."canonicalContestProblemId" := expected_problem_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ContestUserProblemStatus_canonical_identity"
  BEFORE INSERT OR UPDATE OF "contestId", "contestProblemId", "canonicalContestId", "canonicalContestProblemId"
  ON "ContestUserProblemStatus" FOR EACH ROW
  EXECUTE FUNCTION "set_contest_status_canonical_identity"();

CREATE OR REPLACE FUNCTION "set_contest_record_canonical_identity"()
RETURNS trigger AS $$
DECLARE
  expected_contest_id TEXT;
  runtime_type TEXT;
BEGIN
  SELECT "type" INTO runtime_type FROM "Training" WHERE "id" = NEW."trainingId";
  IF runtime_type IS DISTINCT FROM 'contest' THEN
    IF NEW."canonicalContestId" IS NOT NULL THEN
      RAISE EXCEPTION 'non-contest record cannot reference a canonical contest';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "id" INTO expected_contest_id FROM "Contest"
    WHERE "runtimeTrainingId" = NEW."trainingId";
  IF expected_contest_id IS NULL THEN
    RAISE EXCEPTION 'contest record references an unmapped runtime';
  END IF;
  IF NEW."canonicalContestId" IS NOT NULL AND NEW."canonicalContestId" <> expected_contest_id THEN
    RAISE EXCEPTION 'contest record canonical identity mismatch';
  END IF;
  NEW."canonicalContestId" := expected_contest_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ContestRecord_canonical_identity"
  BEFORE INSERT OR UPDATE OF "trainingId", "canonicalContestId"
  ON "ContestRecord" FOR EACH ROW
  EXECUTE FUNCTION "set_contest_record_canonical_identity"();
