BEGIN;

ALTER TABLE "ProblemSolutionVersion"
  ADD COLUMN "visibilityPolicy" "SolutionVisibilityPolicy" NOT NULL DEFAULT 'PUBLIC';

UPDATE "ProblemSolutionVersion" version
SET "visibilityPolicy" = solution."visibilityPolicy"
FROM "ProblemSolution" solution
WHERE solution.id = version."solutionId";

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
    OR NEW."visibilityPolicy" IS DISTINCT FROM OLD."visibilityPolicy"
    OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION '已发布题解版本内容不可修改，只能创建新版本';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
