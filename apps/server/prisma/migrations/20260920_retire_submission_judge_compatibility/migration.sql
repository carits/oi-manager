DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Submission" submission
    LEFT JOIN "JudgeRun" run ON run.id = submission."currentJudgeRunId"
    WHERE submission."currentJudgeRunId" IS NULL
       OR run.id IS NULL
       OR run."submissionId" <> submission.id
  ) THEN
    RAISE EXCEPTION 'Cannot retire Submission judge compatibility columns: incomplete or invalid current JudgeRun coverage';
  END IF;
END $$;

DROP INDEX IF EXISTS "Submission_createdAt_result_idx";
DROP INDEX IF EXISTS "Submission_result_idx";
DROP INDEX IF EXISTS "Submission_result_judgeId_idx";

ALTER TABLE "Submission"
  DROP COLUMN "result",
  DROP COLUMN "timeUsed",
  DROP COLUMN "wallTimeUsed",
  DROP COLUMN "memoryUsed",
  DROP COLUMN "timeoutReason",
  DROP COLUMN "metricSource",
  DROP COLUMN "errorMessage",
  DROP COLUMN "cases",
  DROP COLUMN "score",
  DROP COLUMN "subtasks",
  DROP COLUMN "judgeId",
  DROP COLUMN "judgeStarted";
