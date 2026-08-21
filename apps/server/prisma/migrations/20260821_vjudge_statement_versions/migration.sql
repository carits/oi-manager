ALTER TABLE "UserProblemContent"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "nameKey" TEXT,
  ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'blank',
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "sourceNameSnapshot" TEXT,
  ADD COLUMN "sourceAuthorSnapshot" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

UPDATE "UserProblemContent"
SET "name" = COALESCE(NULLIF(trim("title"), ''), '个人题面'),
    "nameKey" = lower(COALESCE(NULLIF(trim("title"), ''), '个人题面')),
    "visibility" = CASE WHEN EXISTS (
      SELECT 1 FROM "UserProblemContentShare" s
      WHERE s."contentId" = "UserProblemContent"."id" AND s."shareKey" = 'platform'
    ) THEN 'public' ELSE 'private' END
WHERE "kind" = 'statement';

DROP INDEX IF EXISTS "UserProblemContent_problemId_userId_kind_key";
DROP INDEX IF EXISTS "UserProblemContent_problemId_kind_idx";
CREATE INDEX "UserProblemContent_problem_kind_visibility_idx"
  ON "UserProblemContent"("problemId", "kind", "visibility", "deletedAt");
CREATE INDEX "UserProblemContent_owner_name_idx"
  ON "UserProblemContent"("problemId", "userId", "kind", "nameKey");
CREATE UNIQUE INDEX "UserProblemContent_active_statement_name_key"
  ON "UserProblemContent"("problemId", "userId", "kind", "nameKey")
  WHERE "kind" = 'statement' AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "UserProblemContent_active_solution_owner_key"
  ON "UserProblemContent"("problemId", "userId", "kind")
  WHERE "kind" = 'solution' AND "deletedAt" IS NULL;

DROP TABLE "UserProblemContentShare";

CREATE TABLE "TrainingProblemStatementSet" (
  "id" TEXT NOT NULL,
  "trainingProblemId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "selectedBy" TEXT NOT NULL,
  "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingProblemStatementSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingProblemStatementSnapshot" (
  "id" TEXT NOT NULL,
  "statementSetId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceContentId" TEXT,
  "name" TEXT NOT NULL,
  "title" TEXT,
  "language" TEXT,
  "format" TEXT NOT NULL,
  "content" TEXT,
  "snapshotFileId" TEXT,
  "fileName" TEXT,
  "authorUserId" TEXT,
  "authorUsernameSnapshot" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "orderIndex" INTEGER NOT NULL,
  CONSTRAINT "TrainingProblemStatementSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrainingStatementSet_problem_revision_key"
  ON "TrainingProblemStatementSet"("trainingProblemId", "revision");
CREATE INDEX "TrainingStatementSet_problem_revision_idx"
  ON "TrainingProblemStatementSet"("trainingProblemId", "revision");
CREATE UNIQUE INDEX "TrainingStatementSnapshot_set_order_key"
  ON "TrainingProblemStatementSnapshot"("statementSetId", "orderIndex");
CREATE INDEX "TrainingStatementSnapshot_set_default_idx"
  ON "TrainingProblemStatementSnapshot"("statementSetId", "isDefault");
CREATE INDEX "TrainingStatementSnapshot_source_idx"
  ON "TrainingProblemStatementSnapshot"("sourceContentId");

ALTER TABLE "TrainingProblemStatementSet"
  ADD CONSTRAINT "TrainingStatementSet_problem_fkey"
  FOREIGN KEY ("trainingProblemId") REFERENCES "TrainingProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingProblemStatementSnapshot"
  ADD CONSTRAINT "TrainingStatementSnapshot_set_fkey"
  FOREIGN KEY ("statementSetId") REFERENCES "TrainingProblemStatementSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "TrainingProblemStatementSet" (
  "id", "trainingProblemId", "revision", "selectedBy", "selectedAt"
)
SELECT md5(tp."id" || ':statement-set:1'), tp."id", 1, t."createdBy",
       COALESCE(latest."selectedAt", tp."snapshotCreatedAt", tp."createdAt")
FROM "TrainingProblem" tp
JOIN "Training" t ON t."id" = tp."trainingId"
LEFT JOIN LATERAL (
  SELECT s."selectedAt" FROM "TrainingProblemContentSnapshot" s
  WHERE s."trainingProblemId" = tp."id" AND s."kind" = 'statement'
  ORDER BY s."revision" DESC, s."selectedAt" DESC LIMIT 1
) latest ON true;

INSERT INTO "TrainingProblemStatementSnapshot" (
  "id", "statementSetId", "sourceType", "sourceContentId", "name", "title",
  "language", "format", "content", "snapshotFileId", "fileName", "authorUserId",
  "authorUsernameSnapshot", "isDefault", "orderIndex"
)
SELECT md5(tp."id" || ':statement-snapshot:1'), md5(tp."id" || ':statement-set:1'),
       COALESCE(s."sourceType", 'canonical'), s."sourceContentId",
       COALESCE(s."title", tp."titleSnapshot", p."title", '官方题面'),
       COALESCE(s."title", tp."titleSnapshot", p."title"), COALESCE(s."language", 'zh'),
       COALESCE(s."format", 'markdown'), COALESCE(s."content", tp."statementSnapshot", p."description"),
       s."snapshotFileId", s."fileName", s."authorUserId", s."authorUsernameSnapshot", true, 0
FROM "TrainingProblem" tp
JOIN "Problem" p ON p."id" = tp."problemId"
LEFT JOIN LATERAL (
  SELECT s.* FROM "TrainingProblemContentSnapshot" s
  WHERE s."trainingProblemId" = tp."id" AND s."kind" = 'statement'
  ORDER BY s."revision" DESC, s."selectedAt" DESC LIMIT 1
) s ON true;
