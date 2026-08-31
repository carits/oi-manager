ALTER TABLE "Submission"
  ADD COLUMN "inputFilename" TEXT,
  ADD COLUMN "outputFilename" TEXT,
  ADD COLUMN "ioAdapterVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Submission" ALTER COLUMN "ioAdapterVersion" SET DEFAULT 1;

UPDATE "Submission"
SET "ioAdapterVersion" = 1
WHERE "submitMethod" = 'archive' OR "problemInternalId" IS NULL;

ALTER TABLE "JudgeRun"
  ADD COLUMN "inputFilename" TEXT,
  ADD COLUMN "outputFilename" TEXT,
  ADD COLUMN "ioAdapterVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "JudgeRun" ALTER COLUMN "ioAdapterVersion" SET DEFAULT 1;

ALTER TABLE "ProblemHackAttempt"
  ADD COLUMN "inputFilename" TEXT,
  ADD COLUMN "outputFilename" TEXT;

ALTER TABLE "WrongSolutionSample"
  ADD COLUMN "inputFilename" TEXT,
  ADD COLUMN "outputFilename" TEXT,
  ADD COLUMN "executionFingerprint" TEXT;

UPDATE "WrongSolutionSample"
SET "executionFingerprint" = "sourceSha256" || ':stdin:stdout'
WHERE "executionFingerprint" IS NULL;

ALTER TABLE "WrongSolutionSample" ALTER COLUMN "executionFingerprint" SET NOT NULL;
DROP INDEX IF EXISTS "WrongSolutionSample_problemId_sourceSha256_key";
CREATE UNIQUE INDEX "WrongSolutionSample_problemId_executionFingerprint_key"
  ON "WrongSolutionSample"("problemId", "executionFingerprint");
