ALTER TABLE "Contest" ADD COLUMN "runtimeTrainingId" INTEGER;
ALTER TABLE "Contest" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Contest" ADD COLUMN "startAt" TIMESTAMP(3);
ALTER TABLE "Contest" ADD COLUMN "endAt" TIMESTAMP(3);
ALTER TABLE "Contest" ADD COLUMN "format" TEXT;
ALTER TABLE "Contest" ADD COLUMN "statusRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ContestProblem" ADD COLUMN "runtimeTrainingProblemId" TEXT;
ALTER TABLE "ContestProblem" ADD COLUMN "canonicalProblemId" TEXT;
ALTER TABLE "ContestProblem" ADD COLUMN "testSetRevisionId" TEXT;

CREATE UNIQUE INDEX "Contest_runtimeTrainingId_key" ON "Contest"("runtimeTrainingId");
CREATE INDEX "Contest_organizationId_status_idx" ON "Contest"("organizationId", "status");
CREATE UNIQUE INDEX "ContestProblem_runtimeTrainingProblemId_key" ON "ContestProblem"("runtimeTrainingProblemId");
CREATE INDEX "ContestProblem_canonicalProblemId_idx" ON "ContestProblem"("canonicalProblemId");
CREATE INDEX "ContestProblem_testSetRevisionId_idx" ON "ContestProblem"("testSetRevisionId");

ALTER TABLE "Contest" ADD CONSTRAINT "Contest_runtimeTrainingId_fkey" FOREIGN KEY ("runtimeTrainingId") REFERENCES "Training"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_runtimeTrainingProblemId_fkey" FOREIGN KEY ("runtimeTrainingProblemId") REFERENCES "TrainingProblem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_canonicalProblemId_fkey" FOREIGN KEY ("canonicalProblemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_testSetRevisionId_fkey" FOREIGN KEY ("testSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
