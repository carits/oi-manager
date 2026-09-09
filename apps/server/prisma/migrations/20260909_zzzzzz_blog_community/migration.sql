CREATE TABLE "BlogComment" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "parentId" TEXT,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'visible',
  "editedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlogComment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BlogReaction" (
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlogReaction_pkey" PRIMARY KEY ("postId", "userId", "type")
);
CREATE TABLE "BlogBookmark" (
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlogBookmark_pkey" PRIMARY KEY ("postId", "userId")
);
CREATE TABLE "BlogReport" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "commentId" TEXT,
  "reporterUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "evidenceSnapshot" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlogReport_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BlogFeature" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "BlogFeature_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BlogComment_postId_status_createdAt_idx" ON "BlogComment"("postId", "status", "createdAt");
CREATE INDEX "BlogComment_parentId_createdAt_idx" ON "BlogComment"("parentId", "createdAt");
CREATE INDEX "BlogComment_authorUserId_createdAt_idx" ON "BlogComment"("authorUserId", "createdAt");
CREATE INDEX "BlogReaction_postId_type_idx" ON "BlogReaction"("postId", "type");
CREATE INDEX "BlogReaction_userId_createdAt_idx" ON "BlogReaction"("userId", "createdAt");
CREATE INDEX "BlogBookmark_userId_createdAt_idx" ON "BlogBookmark"("userId", "createdAt");
CREATE INDEX "BlogReport_status_createdAt_idx" ON "BlogReport"("status", "createdAt");
CREATE INDEX "BlogReport_postId_status_idx" ON "BlogReport"("postId", "status");
CREATE INDEX "BlogReport_reporterUserId_createdAt_idx" ON "BlogReport"("reporterUserId", "createdAt");
CREATE INDEX "BlogReport_commentId_idx" ON "BlogReport"("commentId");
CREATE INDEX "BlogFeature_status_createdAt_idx" ON "BlogFeature"("status", "createdAt");
CREATE INDEX "BlogFeature_postId_status_idx" ON "BlogFeature"("postId", "status");

ALTER TABLE "BlogComment" ADD CONSTRAINT "BlogComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogComment" ADD CONSTRAINT "BlogComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogComment" ADD CONSTRAINT "BlogComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "BlogComment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogReaction" ADD CONSTRAINT "BlogReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogReaction" ADD CONSTRAINT "BlogReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogBookmark" ADD CONSTRAINT "BlogBookmark_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogBookmark" ADD CONSTRAINT "BlogBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlogReport" ADD CONSTRAINT "BlogReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogReport" ADD CONSTRAINT "BlogReport_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "BlogComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BlogReport" ADD CONSTRAINT "BlogReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogReport" ADD CONSTRAINT "BlogReport_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BlogFeature" ADD CONSTRAINT "BlogFeature_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogFeature" ADD CONSTRAINT "BlogFeature_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
