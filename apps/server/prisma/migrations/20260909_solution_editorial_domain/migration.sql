BEGIN;

CREATE TYPE "SolutionType" AS ENUM ('OFFICIAL_EDITORIAL', 'COMMUNITY_EDITORIAL', 'ALTERNATIVE_SOLUTION', 'EXPLANATION', 'CORRECTION', 'TRANSLATION');
CREATE TYPE "SolutionContributionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'AUTO_CHECKING', 'TECHNICALLY_VALID', 'UNDER_REVIEW', 'NEEDS_REVISION', 'REJECTED', 'ACCEPTED', 'PUBLISHED');
CREATE TYPE "SolutionVerificationStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'INFRA_ERROR', 'SKIPPED');
CREATE TYPE "SolutionReviewType" AS ENUM ('TECHNICAL', 'CONTENT', 'COPYRIGHT');
CREATE TYPE "SolutionReviewDecision" AS ENUM ('APPROVE', 'REQUEST_CHANGES', 'REJECT');
CREATE TYPE "ProblemSolutionStatus" AS ENUM ('PUBLISHED', 'SUPERSEDED', 'RETRACTED', 'DISPUTED');
CREATE TYPE "ProblemSolutionVersionStatus" AS ENUM ('PUBLISHED', 'SUPERSEDED', 'RETRACTED');
CREATE TYPE "SolutionSourceType" AS ENUM ('ORIGINAL', 'DERIVED', 'TRANSLATED', 'AUTHORIZED');
CREATE TYPE "SolutionVisibilityPolicy" AS ENUM ('PUBLIC', 'AFTER_AC', 'MANAGER_ONLY');

CREATE TABLE "SolutionContribution" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "organizationId" TEXT,
  "type" "SolutionType" NOT NULL,
  "baseSolutionId" TEXT,
  "baseVersionId" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "contentMarkdown" TEXT NOT NULL,
  "algorithmTags" JSONB,
  "approachKey" TEXT,
  "complexityTime" TEXT,
  "complexityMemory" TEXT,
  "language" TEXT,
  "referenceCode" TEXT,
  "sourceType" "SolutionSourceType" NOT NULL,
  "sourceUrl" TEXT,
  "citation" TEXT,
  "licenseDeclarationVersion" INTEGER NOT NULL,
  "licenseAcceptedAt" TIMESTAMP(3) NOT NULL,
  "targetTestSetRevisionId" TEXT NOT NULL,
  "statementSnapshotHash" TEXT NOT NULL,
  "status" "SolutionContributionStatus" NOT NULL DEFAULT 'DRAFT',
  "currentRevision" INTEGER NOT NULL DEFAULT 0,
  "submittedAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SolutionContribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SolutionContribution_revision_check" CHECK ("currentRevision" >= 0),
  CONSTRAINT "SolutionContribution_license_check" CHECK ("licenseDeclarationVersion" > 0)
);

CREATE TABLE "SolutionContributionRevision" (
  "id" TEXT NOT NULL,
  "contributionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "contentMarkdown" TEXT NOT NULL,
  "algorithmTags" JSONB,
  "approachKey" TEXT,
  "complexityTime" TEXT,
  "complexityMemory" TEXT,
  "language" TEXT,
  "referenceCode" TEXT,
  "sourceType" "SolutionSourceType" NOT NULL,
  "sourceUrl" TEXT,
  "citation" TEXT,
  "licenseDeclarationVersion" INTEGER NOT NULL,
  "licenseAcceptedAt" TIMESTAMP(3) NOT NULL,
  "statementSnapshot" JSONB NOT NULL,
  "statementSnapshotHash" TEXT NOT NULL,
  "targetTestSetRevisionId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SolutionContributionRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SolutionContributionRevision_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "SolutionContributionRevision_license_check" CHECK ("licenseDeclarationVersion" > 0)
);

CREATE TABLE "SolutionVerification" (
  "id" TEXT NOT NULL,
  "contributionRevisionId" TEXT NOT NULL,
  "submissionId" INTEGER,
  "verifiedTestSetRevisionId" TEXT NOT NULL,
  "status" "SolutionVerificationStatus" NOT NULL DEFAULT 'QUEUED',
  "compilePassed" BOOLEAN,
  "officialVerdict" TEXT,
  "officialScore" INTEGER,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SolutionVerification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SolutionVerification_score_check" CHECK ("officialScore" IS NULL OR "officialScore" BETWEEN 0 AND 100)
);

CREATE TABLE "SolutionReview" (
  "id" TEXT NOT NULL,
  "contributionId" TEXT NOT NULL,
  "contributionRevisionId" TEXT NOT NULL,
  "reviewerUserId" TEXT NOT NULL,
  "reviewType" "SolutionReviewType" NOT NULL,
  "decision" "SolutionReviewDecision" NOT NULL,
  "checklist" JSONB,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SolutionReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProblemSolution" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "type" "SolutionType" NOT NULL,
  "authorUserId" TEXT,
  "organizationId" TEXT,
  "approachKey" TEXT,
  "title" TEXT NOT NULL,
  "status" "ProblemSolutionStatus" NOT NULL DEFAULT 'PUBLISHED',
  "primary" BOOLEAN NOT NULL DEFAULT false,
  "recommended" BOOLEAN NOT NULL DEFAULT false,
  "visibilityPolicy" "SolutionVisibilityPolicy" NOT NULL DEFAULT 'PUBLIC',
  "currentVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProblemSolution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProblemSolutionVersion" (
  "id" TEXT NOT NULL,
  "solutionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "contentMarkdown" TEXT NOT NULL,
  "algorithmTags" JSONB,
  "approachKey" TEXT,
  "complexityTime" TEXT,
  "complexityMemory" TEXT,
  "language" TEXT,
  "referenceCode" TEXT,
  "sourceType" "SolutionSourceType" NOT NULL,
  "sourceUrl" TEXT,
  "citation" TEXT,
  "licenseDeclarationVersion" INTEGER NOT NULL,
  "statementSnapshot" JSONB NOT NULL,
  "statementSnapshotHash" TEXT NOT NULL,
  "verifiedTestSetRevisionId" TEXT NOT NULL,
  "sourceContributionRevisionId" TEXT NOT NULL,
  "verificationId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "status" "ProblemSolutionVersionStatus" NOT NULL DEFAULT 'PUBLISHED',
  "publishedByUserId" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProblemSolutionVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProblemSolutionVersion_version_check" CHECK ("version" > 0),
  CONSTRAINT "ProblemSolutionVersion_license_check" CHECK ("licenseDeclarationVersion" > 0)
);

CREATE INDEX "SolutionContribution_problemId_status_createdAt_idx" ON "SolutionContribution"("problemId", "status", "createdAt");
CREATE INDEX "SolutionContribution_authorUserId_status_updatedAt_idx" ON "SolutionContribution"("authorUserId", "status", "updatedAt");
CREATE INDEX "SolutionContribution_organizationId_status_idx" ON "SolutionContribution"("organizationId", "status");
CREATE INDEX "SolutionContribution_baseSolutionId_idx" ON "SolutionContribution"("baseSolutionId");
CREATE INDEX "SolutionContribution_targetTestSetRevisionId_idx" ON "SolutionContribution"("targetTestSetRevisionId");
CREATE UNIQUE INDEX "SolutionContributionRevision_contributionId_revision_key" ON "SolutionContributionRevision"("contributionId", "revision");
CREATE INDEX "SolutionContributionRevision_targetTestSetRevisionId_idx" ON "SolutionContributionRevision"("targetTestSetRevisionId");
CREATE INDEX "SolutionContributionRevision_contentHash_idx" ON "SolutionContributionRevision"("contentHash");
CREATE UNIQUE INDEX "SolutionVerification_contributionRevisionId_key" ON "SolutionVerification"("contributionRevisionId");
CREATE UNIQUE INDEX "SolutionVerification_submissionId_key" ON "SolutionVerification"("submissionId");
CREATE INDEX "SolutionVerification_status_createdAt_idx" ON "SolutionVerification"("status", "createdAt");
CREATE INDEX "SolutionVerification_verifiedTestSetRevisionId_idx" ON "SolutionVerification"("verifiedTestSetRevisionId");
CREATE INDEX "SolutionReview_contributionId_createdAt_idx" ON "SolutionReview"("contributionId", "createdAt");
CREATE INDEX "SolutionReview_contributionRevisionId_decision_idx" ON "SolutionReview"("contributionRevisionId", "decision");
CREATE INDEX "SolutionReview_reviewerUserId_createdAt_idx" ON "SolutionReview"("reviewerUserId", "createdAt");
CREATE UNIQUE INDEX "ProblemSolution_currentVersionId_key" ON "ProblemSolution"("currentVersionId");
CREATE INDEX "ProblemSolution_problemId_status_recommended_idx" ON "ProblemSolution"("problemId", "status", "recommended");
CREATE INDEX "ProblemSolution_organizationId_status_idx" ON "ProblemSolution"("organizationId", "status");
CREATE INDEX "ProblemSolution_authorUserId_idx" ON "ProblemSolution"("authorUserId");
CREATE UNIQUE INDEX "ProblemSolutionVersion_sourceContributionRevisionId_key" ON "ProblemSolutionVersion"("sourceContributionRevisionId");
CREATE UNIQUE INDEX "ProblemSolutionVersion_verificationId_key" ON "ProblemSolutionVersion"("verificationId");
CREATE UNIQUE INDEX "ProblemSolutionVersion_solutionId_version_key" ON "ProblemSolutionVersion"("solutionId", "version");
CREATE INDEX "ProblemSolutionVersion_verifiedTestSetRevisionId_idx" ON "ProblemSolutionVersion"("verifiedTestSetRevisionId");
CREATE INDEX "ProblemSolutionVersion_status_publishedAt_idx" ON "ProblemSolutionVersion"("status", "publishedAt");

ALTER TABLE "SolutionContribution" ADD CONSTRAINT "SolutionContribution_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionContribution" ADD CONSTRAINT "SolutionContribution_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionContribution" ADD CONSTRAINT "SolutionContribution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SolutionContribution" ADD CONSTRAINT "SolutionContribution_targetTestSetRevisionId_fkey" FOREIGN KEY ("targetTestSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionContributionRevision" ADD CONSTRAINT "SolutionContributionRevision_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "SolutionContribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionContributionRevision" ADD CONSTRAINT "SolutionContributionRevision_targetTestSetRevisionId_fkey" FOREIGN KEY ("targetTestSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionVerification" ADD CONSTRAINT "SolutionVerification_contributionRevisionId_fkey" FOREIGN KEY ("contributionRevisionId") REFERENCES "SolutionContributionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionVerification" ADD CONSTRAINT "SolutionVerification_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionVerification" ADD CONSTRAINT "SolutionVerification_verifiedTestSetRevisionId_fkey" FOREIGN KEY ("verifiedTestSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionReview" ADD CONSTRAINT "SolutionReview_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "SolutionContribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionReview" ADD CONSTRAINT "SolutionReview_contributionRevisionId_fkey" FOREIGN KEY ("contributionRevisionId") REFERENCES "SolutionContributionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionReview" ADD CONSTRAINT "SolutionReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemSolution" ADD CONSTRAINT "ProblemSolution_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemSolution" ADD CONSTRAINT "ProblemSolution_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProblemSolution" ADD CONSTRAINT "ProblemSolution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProblemSolutionVersion" ADD CONSTRAINT "ProblemSolutionVersion_solutionId_fkey" FOREIGN KEY ("solutionId") REFERENCES "ProblemSolution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemSolutionVersion" ADD CONSTRAINT "ProblemSolutionVersion_verifiedTestSetRevisionId_fkey" FOREIGN KEY ("verifiedTestSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemSolutionVersion" ADD CONSTRAINT "ProblemSolutionVersion_sourceContributionRevisionId_fkey" FOREIGN KEY ("sourceContributionRevisionId") REFERENCES "SolutionContributionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemSolutionVersion" ADD CONSTRAINT "ProblemSolutionVersion_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "SolutionVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemSolutionVersion" ADD CONSTRAINT "ProblemSolutionVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionContribution" ADD CONSTRAINT "SolutionContribution_baseSolutionId_fkey" FOREIGN KEY ("baseSolutionId") REFERENCES "ProblemSolution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SolutionContribution" ADD CONSTRAINT "SolutionContribution_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "ProblemSolutionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemSolution" ADD CONSTRAINT "ProblemSolution_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ProblemSolutionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "solution_snapshot_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '题解投稿快照与审核记录不可修改或删除';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SolutionContributionRevision_prevent_mutation"
BEFORE UPDATE OR DELETE ON "SolutionContributionRevision"
FOR EACH ROW EXECUTE FUNCTION "solution_snapshot_immutable"();

CREATE TRIGGER "SolutionReview_prevent_mutation"
BEFORE UPDATE OR DELETE ON "SolutionReview"
FOR EACH ROW EXECUTE FUNCTION "solution_snapshot_immutable"();

CREATE OR REPLACE FUNCTION "solution_version_content_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '已发布题解版本不可删除';
  END IF;
  IF NEW."solutionId" IS DISTINCT FROM OLD."solutionId"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."contentMarkdown" IS DISTINCT FROM OLD."contentMarkdown"
    OR NEW."algorithmTags" IS DISTINCT FROM OLD."algorithmTags"
    OR NEW."approachKey" IS DISTINCT FROM OLD."approachKey"
    OR NEW."complexityTime" IS DISTINCT FROM OLD."complexityTime"
    OR NEW."complexityMemory" IS DISTINCT FROM OLD."complexityMemory"
    OR NEW."language" IS DISTINCT FROM OLD."language"
    OR NEW."referenceCode" IS DISTINCT FROM OLD."referenceCode"
    OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
    OR NEW."sourceUrl" IS DISTINCT FROM OLD."sourceUrl"
    OR NEW."citation" IS DISTINCT FROM OLD."citation"
    OR NEW."licenseDeclarationVersion" IS DISTINCT FROM OLD."licenseDeclarationVersion"
    OR NEW."statementSnapshot" IS DISTINCT FROM OLD."statementSnapshot"
    OR NEW."statementSnapshotHash" IS DISTINCT FROM OLD."statementSnapshotHash"
    OR NEW."verifiedTestSetRevisionId" IS DISTINCT FROM OLD."verifiedTestSetRevisionId"
    OR NEW."sourceContributionRevisionId" IS DISTINCT FROM OLD."sourceContributionRevisionId"
    OR NEW."verificationId" IS DISTINCT FROM OLD."verificationId"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."publishedByUserId" IS DISTINCT FROM OLD."publishedByUserId"
    OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION '已发布题解版本内容不可修改，只能创建新版本';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProblemSolutionVersion_prevent_content_mutation"
BEFORE UPDATE OR DELETE ON "ProblemSolutionVersion"
FOR EACH ROW EXECUTE FUNCTION "solution_version_content_immutable"();

COMMIT;
