-- Fail closed before any destructive rewrite. Runtime-active sessions must be
-- ended/archived or handled explicitly before changing join semantics.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "TrainingSession"
    WHERE "status" IN ('SCHEDULED', 'RUNNING', 'PAUSED')
  ) THEN
    RAISE EXCEPTION
      '20260921_training_usability_hardening blocked: active TrainingSession rows exist';
  END IF;
END $$;

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

-- Draft identity is StageProblem, not Problem. Before adding the new identity,
-- require every legacy draft to have exactly one possible StageProblem target.
-- A zero-match draft is orphaned; a multi-match draft is ambiguous because the
-- old schema did not store which Stage owned it. Both cases require explicit
-- operator reconciliation instead of guessing or deleting data.
DO $
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "TrainingSessionProblemDraft" AS d
    LEFT JOIN "TrainingSessionStage" AS st
      ON st."sessionId" = d."sessionId"
    LEFT JOIN "TrainingSessionStageProblem" AS sp
      ON sp."stageId" = st."id"
     AND sp."problemId" = d."problemId"
    GROUP BY d."id"
    HAVING COUNT(sp."id") <> 1
  ) THEN
    RAISE EXCEPTION
      '20260921_training_usability_hardening blocked: legacy draft has zero or multiple StageProblem matches';
  END IF;
END $;

ALTER TABLE "TrainingSessionProblemDraft"
  ADD COLUMN "stageProblemId" TEXT;

UPDATE "TrainingSessionProblemDraft" AS d
SET "stageProblemId" = (
  SELECT sp."id"
  FROM "TrainingSessionStageProblem" AS sp
  JOIN "TrainingSessionStage" AS st ON st."id" = sp."stageId"
  WHERE st."sessionId" = d."sessionId"
    AND sp."problemId" = d."problemId"
);

-- No row is deleted by this migration. The preflight above guarantees a unique
-- target; NOT NULL below is an additional fail-closed invariant.
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
