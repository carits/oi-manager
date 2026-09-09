BEGIN;

CREATE TYPE "BlogPostType" AS ENUM ('ARTICLE', 'SOLUTION_NOTE', 'CONTEST_REVIEW', 'TRAINING_LOG', 'LEARNING_LOG', 'TUTORIAL', 'COLLECTION', 'ANNOUNCEMENT');
CREATE TYPE "BlogPostStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'HIDDEN', 'MODERATION_HOLD', 'REMOVED');
CREATE TYPE "BlogVisibility" AS ENUM ('PRIVATE', 'ORGANIZATION', 'UNLISTED', 'PUBLIC');
CREATE TYPE "BlogPostVersionStatus" AS ENUM ('CURRENT', 'SUPERSEDED');
CREATE TYPE "BlogReferenceType" AS ENUM ('PROBLEM', 'PROBLEM_REVISION', 'SOLUTION_VERSION', 'CONTEST_STANDING', 'RATING_CHANGE');
CREATE TYPE "BlogReferenceRelationType" AS ENUM ('PRIMARY_SUBJECT', 'MENTION', 'SOURCE', 'RESULT', 'SOLUTION', 'FOLLOW_UP');
CREATE TYPE "BlogReferenceDisplayMode" AS ENUM ('INLINE', 'CARD', 'COMPACT', 'EMBED', 'HIDDEN_METADATA');
CREATE TYPE "BlogReferenceStatus" AS ENUM ('CURRENT', 'STALE', 'SUPERSEDED', 'BROKEN', 'ACCESS_REVOKED');
CREATE TYPE "BlogTagKind" AS ENUM ('SYSTEM', 'USER');

CREATE TABLE "BlogPost" (
  "id" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "organizationId" TEXT,
  "type" "BlogPostType" NOT NULL DEFAULT 'ARTICLE',
  "slug" TEXT NOT NULL,
  "status" "BlogPostStatus" NOT NULL DEFAULT 'DRAFT',
  "visibility" "BlogVisibility" NOT NULL DEFAULT 'PRIVATE',
  "currentVersionId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BlogPostDraft" (
  "postId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "contentMarkdown" TEXT NOT NULL,
  "references" JSONB NOT NULL,
  "classification" JSONB NOT NULL DEFAULT '{}',
  "baseVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BlogPostDraft_pkey" PRIMARY KEY ("postId"),
  CONSTRAINT "BlogPostDraft_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "BlogPostDraft_references_array_check" CHECK (jsonb_typeof("references") = 'array'),
  CONSTRAINT "BlogPostDraft_classification_object_check" CHECK (jsonb_typeof("classification") = 'object')
);

CREATE TABLE "BlogPostVersion" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "contentMarkdown" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "sourceVersionId" TEXT,
  "status" "BlogPostVersionStatus" NOT NULL DEFAULT 'CURRENT',
  "visibility" "BlogVisibility" NOT NULL,
  "organizationIdSnapshot" TEXT,
  "classificationSnapshot" JSONB NOT NULL DEFAULT '{}',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlogPostVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BlogPostVersion_version_check" CHECK ("version" > 0)
);

CREATE TABLE "BlogReference" (
  "id" TEXT NOT NULL,
  "postVersionId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "referenceType" "BlogReferenceType" NOT NULL,
  "referenceId" TEXT NOT NULL,
  "referenceVersionId" TEXT,
  "relationType" "BlogReferenceRelationType" NOT NULL DEFAULT 'MENTION',
  "displayMode" "BlogReferenceDisplayMode" NOT NULL DEFAULT 'CARD',
  "positionKey" TEXT,
  "snapshotData" JSONB NOT NULL,
  "accessMode" "BlogVisibility" NOT NULL,
  "status" "BlogReferenceStatus" NOT NULL DEFAULT 'CURRENT',
  "problemId" TEXT,
  "problemRevisionId" TEXT,
  "solutionVersionId" TEXT,
  "trainingId" INTEGER,
  "standingSnapshotId" TEXT,
  "ratingChangeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlogReference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BlogReference_ordinal_check" CHECK ("ordinal" >= 0),
  CONSTRAINT "BlogReference_target_shape_check" CHECK (
    ("referenceType" = 'PROBLEM' AND "problemId" IS NOT NULL AND "problemRevisionId" IS NULL AND "solutionVersionId" IS NULL AND "standingSnapshotId" IS NULL AND "ratingChangeId" IS NULL)
    OR ("referenceType" = 'PROBLEM_REVISION' AND "problemId" IS NOT NULL AND "problemRevisionId" IS NOT NULL AND "solutionVersionId" IS NULL AND "standingSnapshotId" IS NULL AND "ratingChangeId" IS NULL)
    OR ("referenceType" = 'SOLUTION_VERSION' AND "problemId" IS NULL AND "problemRevisionId" IS NULL AND "solutionVersionId" IS NOT NULL AND "standingSnapshotId" IS NULL AND "ratingChangeId" IS NULL)
    OR ("referenceType" = 'CONTEST_STANDING' AND "problemId" IS NULL AND "problemRevisionId" IS NULL AND "solutionVersionId" IS NULL AND "trainingId" IS NOT NULL AND "standingSnapshotId" IS NOT NULL AND "ratingChangeId" IS NULL)
    OR ("referenceType" = 'RATING_CHANGE' AND "problemId" IS NULL AND "problemRevisionId" IS NULL AND "solutionVersionId" IS NULL AND "trainingId" IS NOT NULL AND "standingSnapshotId" IS NULL AND "ratingChangeId" IS NOT NULL)
  )
);

CREATE TABLE "BlogSeries" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "organizationId" TEXT,
  "scopeKey" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "visibility" "BlogVisibility" NOT NULL DEFAULT 'PRIVATE',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BlogSeries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BlogSeries_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "BlogSeries_scope_check" CHECK (
    ("organizationId" IS NULL AND "scopeKey" = 'user:' || "ownerUserId")
    OR ("organizationId" IS NOT NULL AND "scopeKey" = 'organization:' || "organizationId")
  )
);

CREATE TABLE "BlogSeriesEntry" (
  "seriesId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlogSeriesEntry_pkey" PRIMARY KEY ("seriesId", "postId"),
  CONSTRAINT "BlogSeriesEntry_order_check" CHECK ("orderIndex" >= 0)
);

CREATE TABLE "BlogTag" (
  "id" TEXT NOT NULL,
  "kind" "BlogTagKind" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "ownerUserId" TEXT,
  "name" TEXT NOT NULL,
  "normalizedKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BlogTag_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BlogTag_owner_shape_check" CHECK (
    ("kind" = 'SYSTEM' AND "ownerUserId" IS NULL AND "scopeKey" = 'system')
    OR ("kind" = 'USER' AND "ownerUserId" IS NOT NULL AND "scopeKey" = 'user:' || "ownerUserId")
  )
);

CREATE TABLE "BlogPostTag" (
  "postId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "addedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlogPostTag_pkey" PRIMARY KEY ("postId", "tagId")
);

CREATE UNIQUE INDEX "BlogPost_currentVersionId_key" ON "BlogPost"("currentVersionId");
CREATE UNIQUE INDEX "BlogPost_authorUserId_slug_key" ON "BlogPost"("authorUserId", "slug");
CREATE INDEX "BlogPost_status_visibility_publishedAt_idx" ON "BlogPost"("status", "visibility", "publishedAt");
CREATE INDEX "BlogPost_organizationId_status_publishedAt_idx" ON "BlogPost"("organizationId", "status", "publishedAt");
CREATE INDEX "BlogPost_authorUserId_status_updatedAt_idx" ON "BlogPost"("authorUserId", "status", "updatedAt");
CREATE INDEX "BlogPostDraft_updatedAt_idx" ON "BlogPostDraft"("updatedAt");
CREATE UNIQUE INDEX "BlogPostVersion_postId_version_key" ON "BlogPostVersion"("postId", "version");
CREATE INDEX "BlogPostVersion_postId_publishedAt_idx" ON "BlogPostVersion"("postId", "publishedAt");
CREATE INDEX "BlogPostVersion_contentHash_idx" ON "BlogPostVersion"("contentHash");
CREATE INDEX "BlogPostVersion_sourceVersionId_idx" ON "BlogPostVersion"("sourceVersionId");
CREATE INDEX "BlogPostVersion_visibility_publishedAt_idx" ON "BlogPostVersion"("visibility", "publishedAt");
CREATE UNIQUE INDEX "BlogReference_postVersionId_ordinal_key" ON "BlogReference"("postVersionId", "ordinal");
CREATE INDEX "BlogReference_referenceType_referenceId_idx" ON "BlogReference"("referenceType", "referenceId");
CREATE INDEX "BlogReference_problemId_relationType_idx" ON "BlogReference"("problemId", "relationType");
CREATE INDEX "BlogReference_solutionVersionId_idx" ON "BlogReference"("solutionVersionId");
CREATE INDEX "BlogReference_trainingId_relationType_idx" ON "BlogReference"("trainingId", "relationType");
CREATE INDEX "BlogReference_standingSnapshotId_idx" ON "BlogReference"("standingSnapshotId");
CREATE INDEX "BlogReference_ratingChangeId_idx" ON "BlogReference"("ratingChangeId");
CREATE INDEX "BlogReference_problemRevisionId_idx" ON "BlogReference"("problemRevisionId");
CREATE UNIQUE INDEX "BlogSeries_scopeKey_normalizedKey_key" ON "BlogSeries"("scopeKey", "normalizedKey");
CREATE INDEX "BlogSeries_ownerUserId_archivedAt_updatedAt_idx" ON "BlogSeries"("ownerUserId", "archivedAt", "updatedAt");
CREATE INDEX "BlogSeries_organizationId_visibility_archivedAt_idx" ON "BlogSeries"("organizationId", "visibility", "archivedAt");
CREATE UNIQUE INDEX "BlogSeriesEntry_seriesId_orderIndex_key" ON "BlogSeriesEntry"("seriesId", "orderIndex");
CREATE INDEX "BlogSeriesEntry_postId_idx" ON "BlogSeriesEntry"("postId");
CREATE UNIQUE INDEX "BlogTag_scopeKey_normalizedKey_key" ON "BlogTag"("scopeKey", "normalizedKey");
CREATE INDEX "BlogTag_kind_normalizedKey_idx" ON "BlogTag"("kind", "normalizedKey");
CREATE INDEX "BlogTag_ownerUserId_updatedAt_idx" ON "BlogTag"("ownerUserId", "updatedAt");
CREATE INDEX "BlogPostTag_tagId_postId_idx" ON "BlogPostTag"("tagId", "postId");
CREATE INDEX "BlogPostTag_addedByUserId_idx" ON "BlogPostTag"("addedByUserId");

ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogPostDraft" ADD CONSTRAINT "BlogPostDraft_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogPostVersion" ADD CONSTRAINT "BlogPostVersion_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogPostVersion" ADD CONSTRAINT "BlogPostVersion_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "BlogPostVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogPostVersion" ADD CONSTRAINT "BlogPostVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogReference" ADD CONSTRAINT "BlogReference_postVersionId_fkey" FOREIGN KEY ("postVersionId") REFERENCES "BlogPostVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogReference" ADD CONSTRAINT "BlogReference_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogReference" ADD CONSTRAINT "BlogReference_problemRevisionId_fkey" FOREIGN KEY ("problemRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogReference" ADD CONSTRAINT "BlogReference_solutionVersionId_fkey" FOREIGN KEY ("solutionVersionId") REFERENCES "ProblemSolutionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogReference" ADD CONSTRAINT "BlogReference_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogReference" ADD CONSTRAINT "BlogReference_standingSnapshotId_fkey" FOREIGN KEY ("standingSnapshotId") REFERENCES "ContestStandingSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogReference" ADD CONSTRAINT "BlogReference_ratingChangeId_fkey" FOREIGN KEY ("ratingChangeId") REFERENCES "RatingChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "BlogPostVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogSeries" ADD CONSTRAINT "BlogSeries_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogSeries" ADD CONSTRAINT "BlogSeries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogSeriesEntry" ADD CONSTRAINT "BlogSeriesEntry_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "BlogSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogSeriesEntry" ADD CONSTRAINT "BlogSeriesEntry_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogTag" ADD CONSTRAINT "BlogTag_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogPostTag" ADD CONSTRAINT "BlogPostTag_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogPostTag" ADD CONSTRAINT "BlogPostTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "BlogTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogPostTag" ADD CONSTRAINT "BlogPostTag_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "blog_version_content_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '已发布博客版本不可删除';
  END IF;
  IF NEW."postId" IS DISTINCT FROM OLD."postId"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."summary" IS DISTINCT FROM OLD."summary"
    OR NEW."contentMarkdown" IS DISTINCT FROM OLD."contentMarkdown"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."sourceVersionId" IS DISTINCT FROM OLD."sourceVersionId"
    OR NEW."visibility" IS DISTINCT FROM OLD."visibility"
    OR NEW."organizationIdSnapshot" IS DISTINCT FROM OLD."organizationIdSnapshot"
    OR NEW."classificationSnapshot" IS DISTINCT FROM OLD."classificationSnapshot"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt" THEN
    RAISE EXCEPTION '已发布博客版本内容不可修改，只能创建新版本';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status"
    AND NOT (OLD."status" = 'CURRENT' AND NEW."status" = 'SUPERSEDED') THEN
    RAISE EXCEPTION '博客版本状态只能从 CURRENT 单向变为 SUPERSEDED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BlogPostVersion_prevent_content_mutation"
BEFORE UPDATE OR DELETE ON "BlogPostVersion"
FOR EACH ROW EXECUTE FUNCTION "blog_version_content_immutable"();

CREATE OR REPLACE FUNCTION "blog_reference_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '已发布博客引用不可修改或删除';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BlogReference_prevent_mutation"
BEFORE UPDATE OR DELETE ON "BlogReference"
FOR EACH ROW EXECUTE FUNCTION "blog_reference_immutable"();

COMMIT;
