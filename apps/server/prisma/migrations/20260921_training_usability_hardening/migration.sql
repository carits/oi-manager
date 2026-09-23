-- Retire the per-participant FROM_BEGINNING timeline. Existing sessions join the
-- global classroom Stage after this migration.
UPDATE "TrainingSession"
SET "joinMode" = 'CURRENT_STAGE'
WHERE "joinMode" = 'FROM_BEGINNING';

ALTER TABLE "TrainingSession" ALTER COLUMN "joinMode" DROP DEFAULT;
ALTER TYPE "TrainingEngineJoinMode" RENAME TO "TrainingEngineJoinMode_old";
CREATE TYPE "TrainingEngineJoinMode" AS ENUM ('CURRENT_STAGE', 'TEACHER_ASSIGN');
ALTER TABLE "TrainingSession"
  ALTER COLUMN "joinMode" TYPE "TrainingEngineJoinMode"
  USING ("joinMode"::text::"TrainingEngineJoinMode");
ALTER TABLE "TrainingSession" ALTER COLUMN "joinMode" SET DEFAULT 'CURRENT_STAGE';
DROP TYPE "TrainingEngineJoinMode_old";

-- Freeze the student-facing statement together with the pinned TestSet Revision.
ALTER TABLE "TrainingSessionStageProblem"
  ADD COLUMN "titleSnapshot" TEXT,
  ADD COLUMN "statementsSnapshot" JSONB;

UPDATE "TrainingSessionStageProblem" AS sp
SET
  "titleSnapshot" = p."title",
  "statementsSnapshot" = (
    SELECT jsonb_agg(
      jsonb_build_object(
        'type', ps."type",
        'format', ps."format",
        'language', ps."language",
        'content', ps."content",
        'fileUrl', ps."fileUrl"
      )
      ORDER BY ps."type", ps."format", COALESCE(ps."language", '')
    )
    FROM "ProblemStatement" AS ps
    WHERE ps."problemId" = sp."problemId"
      AND ps."isVisible" = TRUE
  )
FROM "Problem" AS p
WHERE p."id" = sp."problemId";

ALTER TABLE "TrainingSessionStageProblem"
  ALTER COLUMN "titleSnapshot" SET NOT NULL;

-- Draft identity is StageProblem, not Problem. This prevents a repeated problem
-- in two classroom stages from silently sharing and overwriting one draft.
ALTER TABLE "TrainingSessionProblemDraft"
  ADD COLUMN "stageProblemId" TEXT;

UPDATE "TrainingSessionProblemDraft" AS d
SET "stageProblemId" = (
  SELECT sp."id"
  FROM "TrainingSessionStageProblem" AS sp
  JOIN "TrainingSessionStage" AS st ON st."id" = sp."stageId"
  WHERE st."sessionId" = d."sessionId"
    AND sp."problemId" = d."problemId"
  ORDER BY st."orderIndex" ASC, sp."orderIndex" ASC
  LIMIT 1
);

-- A draft without a matching StageProblem could never be used by the
-- stage-driven workspace. Do not preserve an orphan under a false identity.
DELETE FROM "TrainingSessionProblemDraft"
WHERE "stageProblemId" IS NULL;

DROP INDEX IF EXISTS "TrainingSessionProblemDraft_sessionId_userId_problemId_key";
ALTER TABLE "TrainingSessionProblemDraft"
  DROP COLUMN "problemId",
  ALTER COLUMN "stageProblemId" SET NOT NULL;

CREATE UNIQUE INDEX "TrainingSessionProblemDraft_sessionId_userId_stageProblemId_key"
  ON "TrainingSessionProblemDraft"("sessionId", "userId", "stageProblemId");
CREATE INDEX "TrainingSessionProblemDraft_stageProblemId_idx"
  ON "TrainingSessionProblemDraft"("stageProblemId");

ALTER TABLE "TrainingSessionProblemDraft"
  ADD CONSTRAINT "TrainingSessionProblemDraft_stageProblemId_fkey"
  FOREIGN KEY ("stageProblemId") REFERENCES "TrainingSessionStageProblem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
