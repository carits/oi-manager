-- Move contest lifecycle and finalization state onto the canonical Contest
-- aggregate. Training remains a same-transaction compatibility projection
-- while the remaining contest-owned runtime tables are migrated.
ALTER TABLE "Contest"
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "problemIdVisible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "solutionVisible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "includeAdminInRanking" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "finalizationStatus" "ContestFinalizationStatus" NOT NULL DEFAULT 'LIVE',
  ADD COLUMN "finalizedStandingId" TEXT;

UPDATE "Contest" AS contest
SET
  "createdBy" = training."createdBy",
  "problemIdVisible" = training."problemIdVisible",
  "solutionVisible" = training."solutionVisible",
  "includeAdminInRanking" = training."includeAdminInRanking",
  "finalizationStatus" = training."finalizationStatus",
  "finalizedStandingId" = training."finalizedStandingId"
FROM "Training" AS training
WHERE contest."runtimeTrainingId" = training."id"
  AND training."type" = 'contest';

CREATE UNIQUE INDEX "Contest_finalizedStandingId_key" ON "Contest"("finalizedStandingId");
CREATE INDEX "Contest_createdBy_idx" ON "Contest"("createdBy");
CREATE INDEX "Contest_finalizationStatus_idx" ON "Contest"("finalizationStatus");

ALTER TABLE "Contest"
  ADD CONSTRAINT "Contest_finalizedStandingId_fkey"
  FOREIGN KEY ("finalizedStandingId") REFERENCES "ContestStandingSnapshot"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
