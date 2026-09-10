ALTER TABLE "AssignmentProblemProgress"
  ADD COLUMN "manualCompletionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "manualCompletedAt" TIMESTAMP(3),
  ADD COLUMN "manualCompletedByUserId" TEXT,
  ADD COLUMN "manualCompletionReason" TEXT;

ALTER TABLE "AssignmentCorrection"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'teacher',
  ADD COLUMN "policyCode" "AssignmentCorrectionPolicy",
  ADD COLUMN "policyEvaluationKey" TEXT,
  ADD COLUMN "policyEvaluatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "AssignmentCorrection_policyEvaluationKey_key"
  ON "AssignmentCorrection"("policyEvaluationKey");

ALTER TABLE "AssignmentProblemProgress"
  ADD CONSTRAINT "AssignmentProblemProgress_manualCompletedByUserId_fkey"
  FOREIGN KEY ("manualCompletedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
