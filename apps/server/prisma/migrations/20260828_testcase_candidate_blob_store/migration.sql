CREATE TYPE "TestcaseCandidateStatus" AS ENUM (
  'VALIDATED', 'PROMOTING', 'PROMOTED', 'REDUNDANT', 'REJECTED', 'FAILED', 'STALE'
);

CREATE TABLE "TestcaseCandidate" (
  id TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "hackAttemptId" TEXT,
  source TEXT NOT NULL DEFAULT 'hack',
  status "TestcaseCandidateStatus" NOT NULL DEFAULT 'VALIDATED',
  "baseTestSetRevisionId" TEXT,
  "inputObjectId" TEXT,
  "outputObjectId" TEXT,
  "inputSha256" TEXT NOT NULL,
  "outputSha256" TEXT NOT NULL,
  "inputSize" INTEGER NOT NULL,
  "outputSize" INTEGER NOT NULL,
  "inputFileName" TEXT NOT NULL,
  "outputFileName" TEXT NOT NULL,
  "affectedSubtaskIds" TEXT,
  "createdBy" TEXT NOT NULL,
  "promotedTestcaseId" TEXT,
  "promotedRevisionId" TEXT,
  message TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "promotedAt" TIMESTAMP(3),
  CONSTRAINT "TestcaseCandidate_pkey" PRIMARY KEY (id)
);

CREATE UNIQUE INDEX "TestcaseCandidate_hackAttemptId_key" ON "TestcaseCandidate"("hackAttemptId");
CREATE INDEX "TestcaseCandidate_problemId_status_createdAt_idx" ON "TestcaseCandidate"("problemId", status, "createdAt");
CREATE INDEX "TestcaseCandidate_baseTestSetRevisionId_idx" ON "TestcaseCandidate"("baseTestSetRevisionId");
CREATE INDEX "TestcaseCandidate_inputObjectId_idx" ON "TestcaseCandidate"("inputObjectId");
CREATE INDEX "TestcaseCandidate_outputObjectId_idx" ON "TestcaseCandidate"("outputObjectId");
CREATE INDEX "TestcaseCandidate_promotedRevisionId_idx" ON "TestcaseCandidate"("promotedRevisionId");

ALTER TABLE "TestcaseCandidate" ADD CONSTRAINT "TestcaseCandidate_problemId_fkey"
  FOREIGN KEY ("problemId") REFERENCES "Problem"(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestcaseCandidate" ADD CONSTRAINT "TestcaseCandidate_hackAttemptId_fkey"
  FOREIGN KEY ("hackAttemptId") REFERENCES "ProblemHackAttempt"(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TestcaseCandidate" ADD CONSTRAINT "TestcaseCandidate_baseTestSetRevisionId_fkey"
  FOREIGN KEY ("baseTestSetRevisionId") REFERENCES "ProblemTestSetRevision"(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TestcaseCandidate" ADD CONSTRAINT "TestcaseCandidate_inputObjectId_fkey"
  FOREIGN KEY ("inputObjectId") REFERENCES "TestdataObject"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestcaseCandidate" ADD CONSTRAINT "TestcaseCandidate_outputObjectId_fkey"
  FOREIGN KEY ("outputObjectId") REFERENCES "TestdataObject"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestcaseCandidate" ADD CONSTRAINT "TestcaseCandidate_promotedRevisionId_fkey"
  FOREIGN KEY ("promotedRevisionId") REFERENCES "ProblemTestSetRevision"(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve the promotion history of existing Hack attempts. Object references
-- are recovered where the promoted revision still has the accepted testcase;
-- nullable object FKs intentionally keep genuinely legacy rows auditable.
INSERT INTO "TestcaseCandidate" (
  id, "problemId", "hackAttemptId", source, status,
  "baseTestSetRevisionId", "inputObjectId", "outputObjectId",
  "inputSha256", "outputSha256", "inputSize", "outputSize",
  "inputFileName", "outputFileName", "affectedSubtaskIds", "createdBy",
  "promotedTestcaseId", "promotedRevisionId", message,
  "createdAt", "updatedAt", "promotedAt"
)
SELECT
  'legacy-candidate-' || hack.id,
  hack."problemId",
  hack.id,
  'hack',
  CASE
    WHEN hack."canonicalStatus" = 'promoted' THEN 'PROMOTED'::"TestcaseCandidateStatus"
    WHEN hack."canonicalStatus" = 'redundant' THEN 'REDUNDANT'::"TestcaseCandidateStatus"
    WHEN hack.status = 'stale' THEN 'STALE'::"TestcaseCandidateStatus"
    WHEN hack."canonicalStatus" = 'failed' OR hack.status = 'system_error' THEN 'FAILED'::"TestcaseCandidateStatus"
    ELSE 'REJECTED'::"TestcaseCandidateStatus"
  END,
  hack."baseTestSetRevisionId",
  COALESCE(acm."inputObjectId", grouped."inputObjectId"),
  COALESCE(acm."outputObjectId", grouped."outputObjectId"),
  COALESCE(hack."inputSha256", ''),
  COALESCE(hack."outputSha256", ''),
  COALESCE(input_file.size, 0),
  COALESCE(output_file.size, 0),
  COALESCE(hack."acceptedInputFile", 'hack_' || hack.id || '.in'),
  COALESCE(hack."acceptedOutputFile", 'hack_' || hack.id || '.out'),
  hack."affectedSubtaskIds",
  hack."userId",
  hack."acceptedTestcaseId",
  hack."promotedRevisionId",
  'Backfilled from ProblemHackAttempt',
  hack."createdAt",
  hack."updatedAt",
  CASE WHEN hack."canonicalStatus" = 'promoted' THEN hack."finishedAt" ELSE NULL END
FROM "ProblemHackAttempt" hack
LEFT JOIN "ProblemTestcase" testcase ON testcase.id = hack."acceptedTestcaseId"
LEFT JOIN "TestdataFile" input_file ON input_file.id = testcase."inputFileId"
LEFT JOIN "TestdataFile" output_file ON output_file.id = testcase."outputFileId"
LEFT JOIN LATERAL (
  SELECT item."inputObjectId", item."outputObjectId"
  FROM "ProblemTestSetRevisionCase" item
  WHERE item."revisionId" = hack."promotedRevisionId"
    AND item."testcaseId" = hack."acceptedTestcaseId"
  LIMIT 1
) acm ON TRUE
LEFT JOIN LATERAL (
  SELECT item."inputObjectId", item."outputObjectId"
  FROM "ProblemTestSetRevisionGroupCase" item
  WHERE item."revisionId" = hack."promotedRevisionId"
    AND item."testcaseId" = hack."acceptedTestcaseId"
  LIMIT 1
) grouped ON TRUE
WHERE hack."canonicalStatus" IS NOT NULL
   OR hack."acceptedTestcaseId" IS NOT NULL
   OR hack."promotedRevisionId" IS NOT NULL;
