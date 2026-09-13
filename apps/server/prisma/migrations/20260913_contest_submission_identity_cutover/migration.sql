-- Development cutover: canonical Contest/ContestProblem ids are the only
-- writable identity for contest-owned submissions and problem status rows.
-- Numeric runtime columns remain nullable, read-only history only.

DROP TRIGGER IF EXISTS "Submission_canonical_contest_identity" ON "Submission";
DROP FUNCTION IF EXISTS "set_submission_canonical_contest_identity"();
DROP TRIGGER IF EXISTS "ContestUserProblemStatus_canonical_identity" ON "ContestUserProblemStatus";
DROP FUNCTION IF EXISTS "set_contest_status_canonical_identity"();
DROP TRIGGER IF EXISTS "ContestRecord_canonical_identity" ON "ContestRecord";
DROP FUNCTION IF EXISTS "set_contest_record_canonical_identity"();

-- The preceding migration backfilled every row and failed closed if any
-- status was unmapped. Make that canonical identity mandatory from now on.
ALTER TABLE "ContestUserProblemStatus"
  ALTER COLUMN "contestId" DROP NOT NULL,
  ALTER COLUMN "contestProblemId" DROP NOT NULL,
  ALTER COLUMN "canonicalContestId" SET NOT NULL,
  ALTER COLUMN "canonicalContestProblemId" SET NOT NULL;

-- A ContestProblem must belong to the same Contest stored on its owner row.
-- Composite foreign keys enforce that invariant without a write-mutating
-- compatibility trigger.
CREATE UNIQUE INDEX IF NOT EXISTS "ContestProblem_contestId_id_key"
  ON "ContestProblem"("contestId", "id");

ALTER TABLE "ContestUserProblemStatus"
  ADD CONSTRAINT "ContestUserProblemStatus_canonical_pair_fkey"
  FOREIGN KEY ("canonicalContestId", "canonicalContestProblemId")
  REFERENCES "ContestProblem"("contestId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_contest_requires_canonical_identity_check"
  CHECK (
    ("submitScope" = 'contest'
      AND "canonicalContestId" IS NOT NULL
      AND "canonicalContestProblemId" IS NOT NULL)
    OR
    ("submitScope" <> 'contest'
      AND "canonicalContestId" IS NULL
      AND "canonicalContestProblemId" IS NULL)
  ),
  ADD CONSTRAINT "Submission_canonical_contest_pair_fkey"
  FOREIGN KEY ("canonicalContestId", "canonicalContestProblemId")
  REFERENCES "ContestProblem"("contestId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

