-- Contest becomes the only mutable source for competitions.
ALTER TABLE "Contest" ADD COLUMN "publicId" INTEGER;

UPDATE "Contest"
SET "publicId" = "runtimeTrainingId"
WHERE "runtimeTrainingId" IS NOT NULL;

WITH base AS (
  SELECT GREATEST(
    1000000000,
    COALESCE((SELECT MAX("id") FROM "Training"), 0),
    COALESCE((SELECT MAX("publicId") FROM "Contest"), 0)
  ) AS value
), missing AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS ordinal
  FROM "Contest"
  WHERE "publicId" IS NULL
)
UPDATE "Contest" contest
SET "publicId" = base.value + missing.ordinal
FROM base, missing
WHERE contest."id" = missing."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Contest" WHERE "publicId" IS NULL) THEN
    RAISE EXCEPTION 'Contest publicId backfill failed';
  END IF;
  IF EXISTS (
    SELECT "publicId" FROM "Contest"
    GROUP BY "publicId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Contest publicId collision detected';
  END IF;
END $$;

CREATE SEQUENCE "Contest_publicId_seq";
SELECT setval(
  '"Contest_publicId_seq"',
  GREATEST(1000000001, COALESCE((SELECT MAX("publicId") + 1 FROM "Contest"), 1000000001)),
  false
);
ALTER SEQUENCE "Contest_publicId_seq" OWNED BY "Contest"."publicId";
ALTER TABLE "Contest" ALTER COLUMN "publicId" SET DEFAULT nextval('"Contest_publicId_seq"');
ALTER TABLE "Contest" ALTER COLUMN "publicId" SET NOT NULL;
CREATE UNIQUE INDEX "Contest_publicId_key" ON "Contest"("publicId");

ALTER TABLE "ContestProblem" ADD COLUMN "alias" TEXT;
UPDATE "ContestProblem" canonical
SET "alias" = runtime."alias"
FROM "TrainingProblem" runtime
WHERE canonical."runtimeTrainingProblemId" = runtime."id";

CREATE TABLE "ContestParticipant" (
  "id" TEXT NOT NULL,
  "contestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userType" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationIdSnapshot" TEXT,
  "ratingStatus" "RatingParticipantStatus" NOT NULL DEFAULT 'REGISTERED',
  "ratingDisposition" "RatingParticipantDisposition" NOT NULL DEFAULT 'NORMAL',
  "ratingDispositionReason" TEXT,
  "ratingDispositionBy" TEXT,
  "ratingDispositionAt" TIMESTAMP(3),
  "firstSubmissionAt" TIMESTAMP(3),
  "ratingLockedAt" TIMESTAMP(3),
  CONSTRAINT "ContestParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContestParticipant_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ContestParticipant_contestId_userId_userType_key" ON "ContestParticipant"("contestId", "userId", "userType");
CREATE INDEX "ContestParticipant_contestId_idx" ON "ContestParticipant"("contestId");
CREATE INDEX "ContestParticipant_userId_idx" ON "ContestParticipant"("userId");

INSERT INTO "ContestParticipant" (
  "id", "contestId", "userId", "userType", "joinedAt", "organizationIdSnapshot",
  "ratingStatus", "ratingDisposition", "ratingDispositionReason", "ratingDispositionBy",
  "ratingDispositionAt", "firstSubmissionAt", "ratingLockedAt"
)
SELECT participant."id", contest."id", participant."userId", participant."userType",
       participant."joinedAt", participant."organizationIdSnapshot", participant."ratingStatus",
       participant."ratingDisposition", participant."ratingDispositionReason",
       participant."ratingDispositionBy", participant."ratingDispositionAt",
       participant."firstSubmissionAt", participant."ratingLockedAt"
FROM "TrainingParticipant" participant
JOIN "Contest" contest ON contest."runtimeTrainingId" = participant."trainingId"
ON CONFLICT ("contestId", "userId", "userType") DO NOTHING;

ALTER TABLE "Contest" DROP CONSTRAINT IF EXISTS "Contest_runtimeTrainingId_fkey";
ALTER TABLE "ContestProblem" DROP CONSTRAINT IF EXISTS "ContestProblem_runtimeTrainingProblemId_fkey";
DROP INDEX IF EXISTS "Contest_runtimeTrainingId_key";
DROP INDEX IF EXISTS "ContestProblem_runtimeTrainingProblemId_key";
ALTER TABLE "Contest" DROP COLUMN "runtimeTrainingId";
ALTER TABLE "ContestProblem" DROP COLUMN "runtimeTrainingProblemId";

ALTER TABLE "ContestRecord" ALTER COLUMN "trainingId" DROP NOT NULL;

-- Contest problem status now owns exactly one Contest/ContestProblem identity.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ContestUserProblemStatus" status
    LEFT JOIN "ContestProblem" problem
      ON problem."id" = status."canonicalContestProblemId"
     AND problem."contestId" = status."canonicalContestId"
    WHERE status."canonicalContestId" IS NULL
       OR status."canonicalContestProblemId" IS NULL
       OR problem."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'ContestUserProblemStatus canonical identity is incomplete';
  END IF;
END $$;

ALTER TABLE "ContestUserProblemStatus"
  DROP CONSTRAINT IF EXISTS "ContestUserProblemStatus_contestId_fkey",
  DROP CONSTRAINT IF EXISTS "ContestUserProblemStatus_contestProblemId_fkey",
  DROP CONSTRAINT IF EXISTS "ContestUserProblemStatus_canonicalContestId_fkey",
  DROP CONSTRAINT IF EXISTS "ContestUserProblemStatus_canonicalContestProblemId_fkey",
  DROP CONSTRAINT IF EXISTS "ContestUserProblemStatus_canonical_pair_fkey";

DROP INDEX IF EXISTS "ContestUserProblemStatus_contestId_userId_contestProblemId_key";
DROP INDEX IF EXISTS "ContestUserProblemStatus_contestId_userId_idx";
DROP INDEX IF EXISTS "ContestUserProblemStatus_canonical_identity_key";
DROP INDEX IF EXISTS "ContestUserProblemStatus_canonicalContestId_userId_idx";
DROP INDEX IF EXISTS "ContestUserProblemStatus_canonicalContestId_userId_canonicalContestProblemId_key";

ALTER TABLE "ContestUserProblemStatus"
  DROP COLUMN "contestId",
  DROP COLUMN "contestProblemId";
ALTER TABLE "ContestUserProblemStatus"
  RENAME COLUMN "canonicalContestId" TO "contestId";
ALTER TABLE "ContestUserProblemStatus"
  RENAME COLUMN "canonicalContestProblemId" TO "contestProblemId";

CREATE UNIQUE INDEX "ContestUserProblemStatus_contestId_userId_contestProblemId_key"
  ON "ContestUserProblemStatus"("contestId", "userId", "contestProblemId");
CREATE INDEX "ContestUserProblemStatus_contestId_userId_idx"
  ON "ContestUserProblemStatus"("contestId", "userId");

ALTER TABLE "ContestUserProblemStatus"
  ADD CONSTRAINT "ContestUserProblemStatus_contestId_fkey"
    FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContestUserProblemStatus_contestProblemId_fkey"
    FOREIGN KEY ("contestProblemId") REFERENCES "ContestProblem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContestUserProblemStatus_contest_pair_fkey"
    FOREIGN KEY ("contestId", "contestProblemId")
    REFERENCES "ContestProblem"("contestId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Activity records remain shared by ordinary Training and Contest, but a row
-- may belong to only one owner after the compatibility bridge is retired.
UPDATE "ContestRecord"
SET "trainingId" = NULL
WHERE "canonicalContestId" IS NOT NULL;

ALTER TABLE "ContestRecord"
  ADD CONSTRAINT "ContestRecord_exactly_one_activity_owner_check"
  CHECK (
    ("trainingId" IS NOT NULL AND "canonicalContestId" IS NULL)
    OR ("trainingId" IS NULL AND "canonicalContestId" IS NOT NULL)
  );
