-- Reconcile submissions created/finalized during the expand-only deployment
-- window before the Consumer switched to JudgeRun/JudgeAttempt ownership.

UPDATE "JudgeRun" run
SET
  status = CASE
    WHEN submission.result = 'queuing' THEN 'QUEUED'::"JudgeRunStatus"
    WHEN submission.result = 'judging' THEN 'RUNNING'::"JudgeRunStatus"
    ELSE 'FINALIZED'::"JudgeRunStatus"
  END,
  result = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission.result END,
  score = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission.score END,
  cases = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission.cases END,
  subtasks = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission.subtasks END,
  "errorMessage" = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission."errorMessage" END,
  "timeUsed" = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission."timeUsed" END,
  "wallTimeUsed" = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission."wallTimeUsed" END,
  "memoryUsed" = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission."memoryUsed" END,
  "timeoutReason" = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission."timeoutReason" END,
  "metricSource" = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission."metricSource" END,
  "startedAt" = CASE WHEN submission.result = 'judging' THEN COALESCE(submission."judgeStarted", submission."updatedAt") ELSE run."startedAt" END,
  "finalizedAt" = CASE WHEN submission.result NOT IN ('queuing', 'judging') THEN submission."updatedAt" ELSE NULL END,
  "updatedAt" = submission."updatedAt"
FROM "Submission" submission
WHERE submission."currentJudgeRunId" = run.id
  AND run."currentAttemptId" IS NOT NULL;

UPDATE "JudgeAttempt" attempt
SET
  state = CASE
    WHEN submission.result = 'queuing' THEN 'QUEUED'::"JudgeAttemptState"
    WHEN submission.result = 'judging' THEN 'RUNNING'::"JudgeAttemptState"
    WHEN submission.result = 'accepted' THEN 'SUCCEEDED'::"JudgeAttemptState"
    WHEN submission.result IN ('system_error', 'judge_failed', 'unknown_error', 'remote_unavailable', 'submit_failed') THEN 'INFRA_ERROR'::"JudgeAttemptState"
    ELSE 'USER_ERROR'::"JudgeAttemptState"
  END,
  "judgeId" = CASE WHEN submission.result = 'judging' THEN submission."judgeId" ELSE attempt."judgeId" END,
  "leaseUntil" = CASE WHEN submission.result = 'judging' THEN CURRENT_TIMESTAMP + INTERVAL '5 minutes' ELSE NULL END,
  result = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission.result END,
  score = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission.score END,
  cases = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission.cases END,
  subtasks = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission.subtasks END,
  "errorMessage" = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission."errorMessage" END,
  "timeUsed" = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission."timeUsed" END,
  "wallTimeUsed" = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission."wallTimeUsed" END,
  "memoryUsed" = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission."memoryUsed" END,
  "timeoutReason" = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission."timeoutReason" END,
  "metricSource" = CASE WHEN submission.result IN ('queuing', 'judging') THEN NULL ELSE submission."metricSource" END,
  "claimedAt" = CASE WHEN submission.result = 'judging' THEN COALESCE(submission."judgeStarted", submission."updatedAt") ELSE attempt."claimedAt" END,
  "startedAt" = CASE WHEN submission.result = 'judging' THEN COALESCE(submission."judgeStarted", submission."updatedAt") ELSE attempt."startedAt" END,
  "finalizedAt" = CASE WHEN submission.result NOT IN ('queuing', 'judging') THEN submission."updatedAt" ELSE NULL END,
  "updatedAt" = submission."updatedAt"
FROM "JudgeRun" run
JOIN "Submission" submission ON submission."currentJudgeRunId" = run.id
WHERE run."currentAttemptId" = attempt.id;
