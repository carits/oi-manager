ALTER TYPE "TestcaseCandidateStatus" ADD VALUE IF NOT EXISTS 'ELIGIBLE_NOT_SELECTED';
ALTER TYPE "TestcaseCandidateStatus" ADD VALUE IF NOT EXISTS 'WAITING_REPLACEMENT';

ALTER TABLE "TestcaseCandidate"
  ADD COLUMN IF NOT EXISTS "selectionOutcome" JSONB,
  ADD COLUMN IF NOT EXISTS "protectedUntil" TIMESTAMP(3);

ALTER TABLE "WrongSolutionSample"
  ADD COLUMN IF NOT EXISTS "subtaskIds" TEXT;

ALTER TABLE "WrongBehaviorCluster"
  ADD COLUMN IF NOT EXISTS "subtaskIds" TEXT;

ALTER TABLE "ProblemTestcase"
  ADD COLUMN IF NOT EXISTS "isProtected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "protectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "protectedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "semanticFingerprint" TEXT;

CREATE TABLE IF NOT EXISTS "TestcaseMembershipRetirement" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "testcaseId" TEXT NOT NULL,
  "subtaskId" INTEGER NOT NULL,
  "groupKey" TEXT NOT NULL,
  "replacementCandidateId" TEXT,
  "replacementTestcaseId" TEXT,
  "fromRevisionId" TEXT NOT NULL,
  "toRevisionId" TEXT NOT NULL,
  "oldMarginalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "newMarginalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "metadata" JSONB,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TestcaseMembershipRetirement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TestcaseMembershipRetirement_problemId_createdAt_idx"
  ON "TestcaseMembershipRetirement"("problemId", "createdAt");
CREATE INDEX IF NOT EXISTS "TestcaseMembershipRetirement_testcaseId_idx"
  ON "TestcaseMembershipRetirement"("testcaseId");
CREATE INDEX IF NOT EXISTS "TestcaseMembershipRetirement_replacementCandidateId_idx"
  ON "TestcaseMembershipRetirement"("replacementCandidateId");
CREATE INDEX IF NOT EXISTS "TestcaseMembershipRetirement_fromRevisionId_toRevisionId_idx"
  ON "TestcaseMembershipRetirement"("fromRevisionId", "toRevisionId");

ALTER TABLE "CandidateEvaluationRun"
  ADD COLUMN IF NOT EXISTS "judgeId" TEXT,
  ADD COLUMN IF NOT EXISTS "fencingToken" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "budgetTaskId" TEXT,
  ADD COLUMN IF NOT EXISTS "budgetCredits" INTEGER NOT NULL DEFAULT 400;

CREATE INDEX IF NOT EXISTS "CandidateEvaluationRun_status_leaseExpiresAt_idx"
  ON "CandidateEvaluationRun"("status", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "CandidateEvaluationRun_budgetTaskId_idx"
  ON "CandidateEvaluationRun"("budgetTaskId");
