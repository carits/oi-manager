ALTER TABLE "School"
  ADD COLUMN "shortName" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "schoolNature" TEXT,
  ADD COLUMN "educationSystemDetail" JSONB,
  ADD COLUMN "informaticsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "informaticsStages" JSONB,
  ADD COLUMN "informaticsContests" JSONB,
  ADD COLUMN "informaticsTracks" JSONB;
