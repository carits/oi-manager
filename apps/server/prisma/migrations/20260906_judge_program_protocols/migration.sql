ALTER TABLE "ProblemJudgeProgramVersion"
  ADD COLUMN "protocol" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "protocolVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "templateId" TEXT,
  ADD COLUMN "templateVersion" INTEGER,
  ADD COLUMN "lifecycleStatus" TEXT NOT NULL DEFAULT 'compiled',
  ADD COLUMN "runtimeMetadata" JSONB,
  ADD COLUMN "preflightReport" JSONB,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "activatedAt" TIMESTAMP(3);

UPDATE "ProblemJudgeProgramVersion" version
SET "lifecycleStatus" = 'active',
    "activatedAt" = COALESCE(version."createdAt", CURRENT_TIMESTAMP),
    "protocol" = CASE program."kind"
      WHEN 'standard' THEN 'oj.standard/v1'
      WHEN 'validator' THEN 'oj.validator/v1'
      WHEN 'classifier' THEN 'oj.classifier/v1'
      WHEN 'generator' THEN 'legacy-args-v1'
      ELSE 'legacy'
    END
FROM "ProblemJudgeProgram" program
WHERE program."currentVersionId" = version."id";

UPDATE "ProblemJudgeProgramVersion" version
SET "protocol" = CASE program."kind"
  WHEN 'standard' THEN 'oj.standard/v1'
  WHEN 'validator' THEN 'oj.validator/v1'
  WHEN 'classifier' THEN 'oj.classifier/v1'
  WHEN 'generator' THEN 'legacy-args-v1'
  ELSE 'legacy'
END
FROM "ProblemJudgeProgram" program
WHERE version."programId" = program."id" AND version."protocol" = 'legacy';

CREATE INDEX "ProblemJudgeProgramVersion_problemId_lifecycleStatus_createdAt_idx"
  ON "ProblemJudgeProgramVersion"("problemId", "lifecycleStatus", "createdAt");

ALTER TABLE "ProblemHackAttempt" ADD COLUMN "generatorProtocol" TEXT;
