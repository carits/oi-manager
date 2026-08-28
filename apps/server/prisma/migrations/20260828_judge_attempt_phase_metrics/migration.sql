ALTER TABLE "JudgeAttempt"
  ADD COLUMN "queueLatencyMs" INTEGER,
  ADD COLUMN "dispatchLatencyMs" INTEGER,
  ADD COLUMN "compileLatencyMs" INTEGER,
  ADD COLUMN "runLatencyMs" INTEGER,
  ADD COLUMN "persistLatencyMs" INTEGER,
  ADD COLUMN "totalLatencyMs" INTEGER;
