CREATE TABLE "SolutionSimilarityJob" (
  "id" TEXT NOT NULL,
  "contributionRevisionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SolutionSimilarityJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SolutionSimilarityJob_contributionRevisionId_key" ON "SolutionSimilarityJob"("contributionRevisionId");
CREATE INDEX "SolutionSimilarityJob_status_nextAttemptAt_idx" ON "SolutionSimilarityJob"("status", "nextAttemptAt");
CREATE INDEX "SolutionSimilarityJob_leaseExpiresAt_idx" ON "SolutionSimilarityJob"("leaseExpiresAt");
ALTER TABLE "SolutionSimilarityJob" ADD CONSTRAINT "SolutionSimilarityJob_contributionRevisionId_fkey"
  FOREIGN KEY ("contributionRevisionId") REFERENCES "SolutionContributionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SolutionContentFingerprint" (
  "id" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "algorithmVersion" INTEGER NOT NULL DEFAULT 2,
  "textSignature" JSONB NOT NULL,
  "codeSignature" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SolutionContentFingerprint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SolutionContentFingerprint_targetType_targetId_algorithmVersion_key"
  ON "SolutionContentFingerprint"("targetType", "targetId", "algorithmVersion");
CREATE INDEX "SolutionContentFingerprint_contentHash_algorithmVersion_idx"
  ON "SolutionContentFingerprint"("contentHash", "algorithmVersion");

-- Existing contributions predate the durable job queue. Seed one job for the
-- current revision only: completed legacy checks are immediately reviewable,
-- while revisions without evidence are evaluated by the background worker.
INSERT INTO "SolutionSimilarityJob" (
  "id", "contributionRevisionId", "status", "attempts", "nextAttemptAt",
  "completedAt", "createdAt", "updatedAt"
)
SELECT
  'similarity-job-' || md5(revision."id"),
  revision."id",
  CASE WHEN similarity."id" IS NULL THEN 'QUEUED' ELSE 'READY' END,
  0,
  CURRENT_TIMESTAMP,
  CASE WHEN similarity."id" IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "SolutionContribution" contribution
JOIN "SolutionContributionRevision" revision
  ON revision."contributionId" = contribution."id"
 AND revision."revision" = contribution."currentRevision"
LEFT JOIN "SolutionSimilarityCheck" similarity
  ON similarity."contributionRevisionId" = revision."id"
ON CONFLICT ("contributionRevisionId") DO NOTHING;
