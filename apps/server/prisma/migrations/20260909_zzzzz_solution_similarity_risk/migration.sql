CREATE TYPE "SolutionSimilarityRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "SolutionSimilarityCheck" (
  "id" TEXT NOT NULL,
  "contributionRevisionId" TEXT NOT NULL,
  "textSimilarityBasisPoints" INTEGER NOT NULL,
  "codeSimilarityBasisPoints" INTEGER NOT NULL,
  "maximumSimilarityBasisPoints" INTEGER NOT NULL,
  "riskLevel" "SolutionSimilarityRisk" NOT NULL,
  "matchedSolutionVersionId" TEXT,
  "matchedContributionRevisionId" TEXT,
  "sourceDeclared" BOOLEAN NOT NULL,
  "comparisonCount" INTEGER NOT NULL,
  "algorithmVersion" INTEGER NOT NULL DEFAULT 1,
  "details" JSONB,
  "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SolutionSimilarityCheck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SolutionSimilarityCheck_contributionRevisionId_key"
  ON "SolutionSimilarityCheck"("contributionRevisionId");
CREATE INDEX "SolutionSimilarityCheck_riskLevel_checkedAt_idx"
  ON "SolutionSimilarityCheck"("riskLevel", "checkedAt");
CREATE INDEX "SolutionSimilarityCheck_matchedSolutionVersionId_idx"
  ON "SolutionSimilarityCheck"("matchedSolutionVersionId");
CREATE INDEX "SolutionSimilarityCheck_matchedContributionRevisionId_idx"
  ON "SolutionSimilarityCheck"("matchedContributionRevisionId");

ALTER TABLE "SolutionSimilarityCheck"
  ADD CONSTRAINT "SolutionSimilarityCheck_contributionRevisionId_fkey"
  FOREIGN KEY ("contributionRevisionId") REFERENCES "SolutionContributionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionSimilarityCheck"
  ADD CONSTRAINT "SolutionSimilarityCheck_matchedSolutionVersionId_fkey"
  FOREIGN KEY ("matchedSolutionVersionId") REFERENCES "ProblemSolutionVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SolutionSimilarityCheck"
  ADD CONSTRAINT "SolutionSimilarityCheck_matchedContributionRevisionId_fkey"
  FOREIGN KEY ("matchedContributionRevisionId") REFERENCES "SolutionContributionRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SolutionSimilarityCheck" ADD CONSTRAINT "SolutionSimilarityCheck_score_range_check"
  CHECK (
    "textSimilarityBasisPoints" BETWEEN 0 AND 10000 AND
    "codeSimilarityBasisPoints" BETWEEN 0 AND 10000 AND
    "maximumSimilarityBasisPoints" BETWEEN 0 AND 10000 AND
    "comparisonCount" >= 0
  );
