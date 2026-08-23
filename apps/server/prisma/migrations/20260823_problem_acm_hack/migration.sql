CREATE TABLE "ProblemHackConfig" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "standardSource" TEXT NOT NULL,
    "standardLanguage" TEXT NOT NULL DEFAULT 'cpp17',
    "validatorSource" TEXT NOT NULL,
    "validatorLanguage" TEXT NOT NULL DEFAULT 'cpp17',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProblemHackConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProblemHackAttempt" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queuing',
    "inputMode" TEXT NOT NULL,
    "inputData" TEXT,
    "generatorSource" TEXT,
    "generatorLanguage" TEXT,
    "hackSource" TEXT NOT NULL,
    "hackLanguage" TEXT NOT NULL,
    "hackConfigRevision" INTEGER NOT NULL,
    "judgeConfigHash" TEXT NOT NULL,
    "baselineResult" TEXT,
    "candidateResult" TEXT,
    "message" TEXT,
    "inputSha256" TEXT,
    "outputSha256" TEXT,
    "acceptedInputFile" TEXT,
    "acceptedOutputFile" TEXT,
    "judgeId" TEXT,
    "judgeStarted" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "ProblemHackAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProblemHackConfig_problemId_key" ON "ProblemHackConfig"("problemId");
CREATE INDEX "ProblemHackConfig_enabled_idx" ON "ProblemHackConfig"("enabled");
CREATE INDEX "ProblemHackConfig_updatedBy_idx" ON "ProblemHackConfig"("updatedBy");
CREATE INDEX "ProblemHackAttempt_problemId_status_createdAt_idx" ON "ProblemHackAttempt"("problemId", "status", "createdAt");
CREATE INDEX "ProblemHackAttempt_status_judgeId_idx" ON "ProblemHackAttempt"("status", "judgeId");
CREATE INDEX "ProblemHackAttempt_userId_problemId_createdAt_idx" ON "ProblemHackAttempt"("userId", "problemId", "createdAt");
CREATE UNIQUE INDEX "ProblemHackAttempt_one_judging_per_problem" ON "ProblemHackAttempt"("problemId") WHERE "status" = 'judging';
CREATE UNIQUE INDEX "ProblemHackAttempt_one_active_user_problem" ON "ProblemHackAttempt"("userId", "problemId") WHERE "status" IN ('queuing', 'judging');

ALTER TABLE "ProblemHackConfig" ADD CONSTRAINT "ProblemHackConfig_problemId_fkey"
  FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemHackAttempt" ADD CONSTRAINT "ProblemHackAttempt_problemId_fkey"
  FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemHackAttempt" ADD CONSTRAINT "ProblemHackAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
