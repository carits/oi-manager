CREATE TABLE "UserProblemContent" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT,
  "format" TEXT NOT NULL,
  "language" TEXT,
  "content" TEXT,
  "fileId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserProblemContent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserProblemContentShare" (
  "contentId" TEXT NOT NULL,
  "shareKey" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "organizationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserProblemContentShare_pkey" PRIMARY KEY ("contentId", "shareKey")
);

CREATE TABLE "TrainingProblemContentSnapshot" (
  "id" TEXT NOT NULL,
  "trainingProblemId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceContentId" TEXT,
  "sourceRevision" INTEGER,
  "format" TEXT NOT NULL,
  "language" TEXT,
  "title" TEXT,
  "content" TEXT,
  "snapshotFileId" TEXT,
  "fileName" TEXT,
  "authorUserId" TEXT,
  "authorUsernameSnapshot" TEXT,
  "selectedBy" TEXT NOT NULL,
  "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingProblemContentSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserProblemContent_problemId_userId_kind_key"
  ON "UserProblemContent"("problemId", "userId", "kind");
CREATE INDEX "UserProblemContent_problemId_kind_idx" ON "UserProblemContent"("problemId", "kind");
CREATE INDEX "UserProblemContent_userId_updatedAt_idx" ON "UserProblemContent"("userId", "updatedAt");
CREATE INDEX "UserProblemContentShare_shareKey_idx" ON "UserProblemContentShare"("shareKey");
CREATE INDEX "UserProblemContentShare_organizationId_idx" ON "UserProblemContentShare"("organizationId");
CREATE UNIQUE INDEX "TrainingProblemContentSnapshot_trainingProblemId_kind_revision_key"
  ON "TrainingProblemContentSnapshot"("trainingProblemId", "kind", "revision");
CREATE INDEX "TrainingContentSnapshot_lookup_idx"
  ON "TrainingProblemContentSnapshot"("trainingProblemId", "kind", "revision");
CREATE INDEX "TrainingProblemContentSnapshot_sourceContentId_idx"
  ON "TrainingProblemContentSnapshot"("sourceContentId");

ALTER TABLE "UserProblemContent"
  ADD CONSTRAINT "UserProblemContent_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserProblemContent"
  ADD CONSTRAINT "UserProblemContent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserProblemContentShare"
  ADD CONSTRAINT "UserProblemContentShare_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "UserProblemContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingProblemContentSnapshot"
  ADD CONSTRAINT "TrainingProblemContentSnapshot_trainingProblemId_fkey" FOREIGN KEY ("trainingProblemId") REFERENCES "TrainingProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Freeze the best available legacy statement as revision 1.
INSERT INTO "TrainingProblemContentSnapshot" (
  "id", "trainingProblemId", "kind", "revision", "sourceType", "sourceContentId",
  "format", "language", "title", "content", "snapshotFileId", "fileName",
  "selectedBy", "selectedAt"
)
SELECT
  md5(tp."id" || ':statement:1'), tp."id", 'statement', 1, 'canonical', ps."id",
  CASE WHEN COALESCE(tp."statementSnapshot", p."description", ps."content") IS NOT NULL THEN 'markdown'
       ELSE COALESCE(ps."format", 'markdown') END,
  COALESCE(ps."language", 'zh'), COALESCE(tp."titleSnapshot", p."title"),
  COALESCE(tp."statementSnapshot", p."description", ps."content"),
  substring(COALESCE(ps."fileUrl", p."statementPdfUrl") from '/api/files/([^/]+)/'),
  f."originalName", t."createdBy", COALESCE(tp."snapshotCreatedAt", tp."createdAt")
FROM "TrainingProblem" tp
JOIN "Problem" p ON p."id" = tp."problemId"
JOIN "Training" t ON t."id" = tp."trainingId"
LEFT JOIN LATERAL (
  SELECT s.* FROM "ProblemStatement" s
  WHERE s."problemId" = p."id" AND s."type" = 'statement' AND s."isVisible" = true
  ORDER BY CASE
    WHEN s."format" = 'markdown' AND s."language" = 'zh' THEN 0
    WHEN s."format" = 'markdown' THEN 1
    WHEN s."format" = 'pdf' THEN 2 ELSE 3 END, s."createdAt"
  LIMIT 1
) ps ON true
LEFT JOIN "File" f ON f."id" = substring(COALESCE(ps."fileUrl", p."statementPdfUrl") from '/api/files/([^/]+)/');

-- Freeze the best available legacy solution, or an explicit none revision.
INSERT INTO "TrainingProblemContentSnapshot" (
  "id", "trainingProblemId", "kind", "revision", "sourceType", "sourceContentId",
  "format", "language", "title", "content", "snapshotFileId", "fileName",
  "selectedBy", "selectedAt"
)
SELECT
  md5(tp."id" || ':solution:1'), tp."id", 'solution', 1,
  CASE WHEN ts."id" IS NOT NULL THEN 'training'
       WHEN COALESCE(p."solutionMarkdown", sol."content", sol."fileUrl", p."solutionPdfUrl") IS NOT NULL THEN 'canonical'
       ELSE 'none' END,
  sol."id",
  CASE WHEN COALESCE(ts."content", p."solutionMarkdown", sol."content") IS NOT NULL THEN 'markdown'
       ELSE COALESCE(sol."format", CASE WHEN p."solutionPdfUrl" IS NOT NULL THEN 'pdf' ELSE 'none' END) END,
  sol."language", NULL, COALESCE(ts."content", p."solutionMarkdown", sol."content"),
  substring(COALESCE(sol."fileUrl", p."solutionPdfUrl") from '/api/files/([^/]+)/'),
  f."originalName", t."createdBy", COALESCE(tp."snapshotCreatedAt", tp."createdAt")
FROM "TrainingProblem" tp
JOIN "Problem" p ON p."id" = tp."problemId"
JOIN "Training" t ON t."id" = tp."trainingId"
LEFT JOIN "TrainingSolution" ts ON ts."trainingProblemId" = tp."id"
LEFT JOIN LATERAL (
  SELECT s.* FROM "ProblemStatement" s
  WHERE s."problemId" = p."id" AND s."type" = 'solution'
  ORDER BY CASE
    WHEN s."format" = 'markdown' AND s."language" = 'zh' THEN 0
    WHEN s."format" = 'markdown' THEN 1
    WHEN s."format" = 'pdf' THEN 2 ELSE 3 END, s."createdAt"
  LIMIT 1
) sol ON true
LEFT JOIN "File" f ON f."id" = substring(COALESCE(sol."fileUrl", p."solutionPdfUrl") from '/api/files/([^/]+)/');
