-- Expand the legacy single-row Submission lifecycle into immutable user intent
-- plus logical JudgeRun and physical JudgeAttempt records. Legacy columns stay
-- in place during the dual-write/switch period.

CREATE TYPE "JudgeRunType" AS ENUM ('NORMAL', 'REJUDGE', 'HACK_REJUDGE', 'MANUAL', 'MIGRATION_VERIFY');
CREATE TYPE "JudgeRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'FINALIZED', 'CANCELLED');
CREATE TYPE "JudgeAttemptState" AS ENUM ('QUEUED', 'CLAIMED', 'COMPILING', 'RUNNING', 'FINALIZING', 'SUCCEEDED', 'USER_ERROR', 'INFRA_ERROR', 'CANCELLED');
CREATE TYPE "RejudgeBatchStatus" AS ENUM ('CREATED', 'QUEUING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "RejudgeBatch" (
  "id" TEXT NOT NULL,
  "trainingId" INTEGER,
  "scopeType" TEXT NOT NULL,
  "scopePayload" JSONB,
  "status" "RejudgeBatchStatus" NOT NULL DEFAULT 'CREATED',
  "requestedBy" TEXT NOT NULL,
  "matchedCount" INTEGER NOT NULL DEFAULT 0,
  "queuedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "RejudgeBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JudgeRun" (
  "id" TEXT NOT NULL,
  "submissionId" INTEGER NOT NULL,
  "runNumber" INTEGER NOT NULL,
  "runType" "JudgeRunType" NOT NULL,
  "status" "JudgeRunStatus" NOT NULL DEFAULT 'QUEUED',
  "testSetRevisionId" TEXT,
  "judgeConfigHash" TEXT,
  "rejudgeBatchId" TEXT,
  "requestedBy" TEXT,
  "result" TEXT,
  "score" INTEGER,
  "cases" TEXT,
  "subtasks" TEXT,
  "errorMessage" TEXT,
  "timeUsed" INTEGER,
  "wallTimeUsed" INTEGER,
  "memoryUsed" INTEGER,
  "timeoutReason" TEXT,
  "metricSource" TEXT,
  "currentAttemptId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JudgeRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JudgeAttempt" (
  "id" TEXT NOT NULL,
  "judgeRunId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "state" "JudgeAttemptState" NOT NULL DEFAULT 'QUEUED',
  "judgeId" TEXT,
  "fencingToken" TEXT NOT NULL,
  "retryOfAttemptId" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "result" TEXT,
  "score" INTEGER,
  "cases" TEXT,
  "subtasks" TEXT,
  "errorMessage" TEXT,
  "timeUsed" INTEGER,
  "wallTimeUsed" INTEGER,
  "memoryUsed" INTEGER,
  "timeoutReason" TEXT,
  "metricSource" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JudgeAttempt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Submission" ADD COLUMN "currentJudgeRunId" TEXT;

CREATE UNIQUE INDEX "Submission_currentJudgeRunId_key" ON "Submission"("currentJudgeRunId");
CREATE INDEX "RejudgeBatch_trainingId_createdAt_idx" ON "RejudgeBatch"("trainingId", "createdAt");
CREATE INDEX "RejudgeBatch_status_createdAt_idx" ON "RejudgeBatch"("status", "createdAt");
CREATE INDEX "RejudgeBatch_requestedBy_createdAt_idx" ON "RejudgeBatch"("requestedBy", "createdAt");
CREATE UNIQUE INDEX "JudgeRun_currentAttemptId_key" ON "JudgeRun"("currentAttemptId");
CREATE UNIQUE INDEX "JudgeRun_submissionId_runNumber_key" ON "JudgeRun"("submissionId", "runNumber");
CREATE INDEX "JudgeRun_status_createdAt_idx" ON "JudgeRun"("status", "createdAt");
CREATE INDEX "JudgeRun_testSetRevisionId_idx" ON "JudgeRun"("testSetRevisionId");
CREATE INDEX "JudgeRun_rejudgeBatchId_idx" ON "JudgeRun"("rejudgeBatchId");
CREATE UNIQUE INDEX "JudgeAttempt_fencingToken_key" ON "JudgeAttempt"("fencingToken");
CREATE UNIQUE INDEX "JudgeAttempt_judgeRunId_attemptNumber_key" ON "JudgeAttempt"("judgeRunId", "attemptNumber");
CREATE INDEX "JudgeAttempt_state_createdAt_idx" ON "JudgeAttempt"("state", "createdAt");
CREATE INDEX "JudgeAttempt_judgeId_state_idx" ON "JudgeAttempt"("judgeId", "state");
CREATE INDEX "JudgeAttempt_retryOfAttemptId_idx" ON "JudgeAttempt"("retryOfAttemptId");

ALTER TABLE "JudgeRun" ADD CONSTRAINT "JudgeRun_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JudgeRun" ADD CONSTRAINT "JudgeRun_testSetRevisionId_fkey"
  FOREIGN KEY ("testSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JudgeRun" ADD CONSTRAINT "JudgeRun_rejudgeBatchId_fkey"
  FOREIGN KEY ("rejudgeBatchId") REFERENCES "RejudgeBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JudgeAttempt" ADD CONSTRAINT "JudgeAttempt_judgeRunId_fkey"
  FOREIGN KEY ("judgeRunId") REFERENCES "JudgeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JudgeAttempt" ADD CONSTRAINT "JudgeAttempt_retryOfAttemptId_fkey"
  FOREIGN KEY ("retryOfAttemptId") REFERENCES "JudgeAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One compatibility run/attempt preserves the currently visible legacy state.
-- Archive-only records intentionally have no local Judge lifecycle.
INSERT INTO "JudgeRun" (
  "id", "submissionId", "runNumber", "runType", "status",
  "testSetRevisionId", "judgeConfigHash", "result", "score", "cases", "subtasks",
  "errorMessage", "timeUsed", "wallTimeUsed", "memoryUsed", "timeoutReason", "metricSource",
  "createdAt", "startedAt", "finalizedAt", "updatedAt"
)
SELECT
  'legacy-run-' || submission."id", submission."id", 1, 'NORMAL'::"JudgeRunType",
  CASE
    WHEN submission."result" = 'queuing' THEN 'QUEUED'::"JudgeRunStatus"
    WHEN submission."result" = 'judging' THEN 'RUNNING'::"JudgeRunStatus"
    ELSE 'FINALIZED'::"JudgeRunStatus"
  END,
  submission."testSetRevisionId", submission."judgeConfigHash", submission."result",
  submission."score", submission."cases", submission."subtasks", submission."errorMessage",
  submission."timeUsed", submission."wallTimeUsed", submission."memoryUsed",
  submission."timeoutReason", submission."metricSource", submission."createdAt",
  CASE WHEN submission."result" = 'judging' THEN COALESCE(submission."judgeStarted", submission."updatedAt") ELSE NULL END,
  CASE WHEN submission."result" NOT IN ('queuing', 'judging') THEN submission."updatedAt" ELSE NULL END,
  submission."updatedAt"
FROM "Submission" submission
WHERE submission."problemInternalId" IS NOT NULL
  AND submission."submitMethod" <> 'archive'
ON CONFLICT ("submissionId", "runNumber") DO NOTHING;

INSERT INTO "JudgeAttempt" (
  "id", "judgeRunId", "attemptNumber", "state", "judgeId", "fencingToken",
  "result", "score", "cases", "subtasks", "errorMessage", "timeUsed", "wallTimeUsed",
  "memoryUsed", "timeoutReason", "metricSource", "createdAt", "claimedAt", "startedAt",
  "finalizedAt", "updatedAt"
)
SELECT
  'legacy-attempt-' || submission."id", 'legacy-run-' || submission."id", 1,
  CASE
    WHEN submission."result" = 'queuing' THEN 'QUEUED'::"JudgeAttemptState"
    WHEN submission."result" = 'judging' THEN 'RUNNING'::"JudgeAttemptState"
    WHEN submission."result" = 'accepted' THEN 'SUCCEEDED'::"JudgeAttemptState"
    WHEN submission."result" IN ('judge_failed', 'unknown_error', 'remote_unavailable', 'submit_failed') THEN 'INFRA_ERROR'::"JudgeAttemptState"
    ELSE 'USER_ERROR'::"JudgeAttemptState"
  END,
  submission."judgeId", 'legacy-fence-' || submission."id", submission."result",
  submission."score", submission."cases", submission."subtasks", submission."errorMessage",
  submission."timeUsed", submission."wallTimeUsed", submission."memoryUsed",
  submission."timeoutReason", submission."metricSource", submission."createdAt",
  submission."judgeStarted", submission."judgeStarted",
  CASE WHEN submission."result" NOT IN ('queuing', 'judging') THEN submission."updatedAt" ELSE NULL END,
  submission."updatedAt"
FROM "Submission" submission
WHERE submission."problemInternalId" IS NOT NULL
  AND submission."submitMethod" <> 'archive'
ON CONFLICT ("judgeRunId", "attemptNumber") DO NOTHING;

UPDATE "JudgeRun" run
SET "currentAttemptId" = attempt."id"
FROM "JudgeAttempt" attempt
WHERE attempt."judgeRunId" = run."id" AND attempt."attemptNumber" = 1;

UPDATE "Submission" submission
SET "currentJudgeRunId" = run."id"
FROM "JudgeRun" run
WHERE run."submissionId" = submission."id" AND run."runNumber" = 1;

ALTER TABLE "JudgeRun" ADD CONSTRAINT "JudgeRun_currentAttemptId_fkey"
  FOREIGN KEY ("currentAttemptId") REFERENCES "JudgeAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_currentJudgeRunId_fkey"
  FOREIGN KEY ("currentJudgeRunId") REFERENCES "JudgeRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
