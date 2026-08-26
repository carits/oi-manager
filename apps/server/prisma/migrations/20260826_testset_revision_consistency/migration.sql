ALTER TABLE "Problem" ADD COLUMN "latestTestSetRevisionId" TEXT;

ALTER TABLE "ProblemHackAttempt"
  ADD COLUMN "baseTestSetRevisionId" TEXT,
  ADD COLUMN "candidateTestcaseId" TEXT,
  ADD COLUMN "promotedRevisionId" TEXT,
  ADD COLUMN "canonicalStatus" TEXT,
  ADD COLUMN "promotionRetries" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "TrainingProblem" ADD COLUMN "testSetRevisionId" TEXT;
ALTER TABLE "Submission"
  ADD COLUMN "testSetRevisionId" TEXT,
  ADD COLUMN "judgeConfigHash" TEXT;

CREATE TABLE "TestdataObject" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TestdataObject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProblemTestSetRevision" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "parentRevisionId" TEXT,
  "mode" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "judgeConfig" TEXT NOT NULL,
  "judgeConfigHash" TEXT NOT NULL,
  "graphHash" TEXT NOT NULL,
  "testdataPath" TEXT NOT NULL,
  "createdBy" TEXT,
  "hackAttemptId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProblemTestSetRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProblemTestSetRevisionCase" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "testcaseId" TEXT,
  "inputObjectId" TEXT NOT NULL,
  "outputObjectId" TEXT NOT NULL,
  "inputName" TEXT NOT NULL,
  "outputName" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "score" INTEGER,
  "time" TEXT,
  "memory" TEXT,
  "source" TEXT NOT NULL DEFAULT 'official',
  CONSTRAINT "ProblemTestSetRevisionCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProblemTestSetRevisionSubtask" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "subtaskId" INTEGER NOT NULL,
  "score" INTEGER NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  CONSTRAINT "ProblemTestSetRevisionSubtask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProblemTestSetRevisionDependency" (
  "id" TEXT NOT NULL,
  "subtaskId" TEXT NOT NULL,
  "dependsOnId" TEXT NOT NULL,
  CONSTRAINT "ProblemTestSetRevisionDependency_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProblemTestSetRevisionGroup" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "subtaskId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "aggregation" TEXT NOT NULL DEFAULT 'min',
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProblemTestSetRevisionGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProblemTestSetRevisionGroupCase" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "testcaseId" TEXT,
  "inputObjectId" TEXT NOT NULL,
  "outputObjectId" TEXT NOT NULL,
  "inputName" TEXT NOT NULL,
  "outputName" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "score" INTEGER,
  "time" TEXT,
  "memory" TEXT,
  "source" TEXT NOT NULL DEFAULT 'official',
  CONSTRAINT "ProblemTestSetRevisionGroupCase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TestdataObject_problemId_sha256_key" ON "TestdataObject"("problemId", "sha256");
CREATE INDEX "TestdataObject_problemId_idx" ON "TestdataObject"("problemId");
CREATE UNIQUE INDEX "ProblemTestSetRevision_problemId_revisionNumber_key" ON "ProblemTestSetRevision"("problemId", "revisionNumber");
CREATE INDEX "ProblemTestSetRevision_problemId_createdAt_idx" ON "ProblemTestSetRevision"("problemId", "createdAt");
CREATE INDEX "ProblemTestSetRevision_parentRevisionId_idx" ON "ProblemTestSetRevision"("parentRevisionId");
CREATE INDEX "ProblemTestSetRevision_judgeConfigHash_idx" ON "ProblemTestSetRevision"("judgeConfigHash");
CREATE UNIQUE INDEX "ProblemTestSetRevisionCase_revisionId_orderIndex_key" ON "ProblemTestSetRevisionCase"("revisionId", "orderIndex");
CREATE INDEX "ProblemTestSetRevisionCase_revisionId_idx" ON "ProblemTestSetRevisionCase"("revisionId");
CREATE INDEX "ProblemTestSetRevisionCase_testcaseId_idx" ON "ProblemTestSetRevisionCase"("testcaseId");
CREATE UNIQUE INDEX "ProblemTestSetRevisionSubtask_revisionId_subtaskId_key" ON "ProblemTestSetRevisionSubtask"("revisionId", "subtaskId");
CREATE INDEX "ProblemTestSetRevisionSubtask_revisionId_orderIndex_idx" ON "ProblemTestSetRevisionSubtask"("revisionId", "orderIndex");
CREATE UNIQUE INDEX "ProblemTestSetRevisionDependency_subtaskId_dependsOnId_key" ON "ProblemTestSetRevisionDependency"("subtaskId", "dependsOnId");
CREATE INDEX "ProblemTestSetRevisionDependency_dependsOnId_idx" ON "ProblemTestSetRevisionDependency"("dependsOnId");
CREATE UNIQUE INDEX "ProblemTestSetRevisionGroup_subtaskId_key_key" ON "ProblemTestSetRevisionGroup"("subtaskId", "key");
CREATE INDEX "ProblemTestSetRevisionGroup_revisionId_kind_idx" ON "ProblemTestSetRevisionGroup"("revisionId", "kind");
CREATE UNIQUE INDEX "ProblemTestSetRevisionGroupCase_groupId_testcaseId_key" ON "ProblemTestSetRevisionGroupCase"("groupId", "testcaseId");
CREATE INDEX "ProblemTestSetRevisionGroupCase_revisionId_idx" ON "ProblemTestSetRevisionGroupCase"("revisionId");
CREATE INDEX "ProblemTestSetRevisionGroupCase_groupId_orderIndex_idx" ON "ProblemTestSetRevisionGroupCase"("groupId", "orderIndex");
CREATE INDEX "ProblemTestSetRevisionGroupCase_testcaseId_idx" ON "ProblemTestSetRevisionGroupCase"("testcaseId");
CREATE INDEX "Problem_latestTestSetRevisionId_idx" ON "Problem"("latestTestSetRevisionId");
CREATE INDEX "ProblemHackAttempt_baseTestSetRevisionId_idx" ON "ProblemHackAttempt"("baseTestSetRevisionId");
CREATE INDEX "ProblemHackAttempt_promotedRevisionId_idx" ON "ProblemHackAttempt"("promotedRevisionId");
CREATE INDEX "TrainingProblem_testSetRevisionId_idx" ON "TrainingProblem"("testSetRevisionId");
CREATE INDEX "Submission_testSetRevisionId_idx" ON "Submission"("testSetRevisionId");

ALTER TABLE "TestdataObject" ADD CONSTRAINT "TestdataObject_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevision" ADD CONSTRAINT "ProblemTestSetRevision_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevision" ADD CONSTRAINT "ProblemTestSetRevision_parentRevisionId_fkey" FOREIGN KEY ("parentRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_latestTestSetRevisionId_fkey" FOREIGN KEY ("latestTestSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionCase" ADD CONSTRAINT "ProblemTestSetRevisionCase_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionCase" ADD CONSTRAINT "ProblemTestSetRevisionCase_testcaseId_fkey" FOREIGN KEY ("testcaseId") REFERENCES "ProblemTestcase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionCase" ADD CONSTRAINT "ProblemTestSetRevisionCase_inputObjectId_fkey" FOREIGN KEY ("inputObjectId") REFERENCES "TestdataObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionCase" ADD CONSTRAINT "ProblemTestSetRevisionCase_outputObjectId_fkey" FOREIGN KEY ("outputObjectId") REFERENCES "TestdataObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionSubtask" ADD CONSTRAINT "ProblemTestSetRevisionSubtask_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionDependency" ADD CONSTRAINT "ProblemTestSetRevisionDependency_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "ProblemTestSetRevisionSubtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionDependency" ADD CONSTRAINT "ProblemTestSetRevisionDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "ProblemTestSetRevisionSubtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionGroup" ADD CONSTRAINT "ProblemTestSetRevisionGroup_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionGroup" ADD CONSTRAINT "ProblemTestSetRevisionGroup_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "ProblemTestSetRevisionSubtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionGroupCase" ADD CONSTRAINT "ProblemTestSetRevisionGroupCase_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionGroupCase" ADD CONSTRAINT "ProblemTestSetRevisionGroupCase_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProblemTestSetRevisionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionGroupCase" ADD CONSTRAINT "ProblemTestSetRevisionGroupCase_testcaseId_fkey" FOREIGN KEY ("testcaseId") REFERENCES "ProblemTestcase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionGroupCase" ADD CONSTRAINT "ProblemTestSetRevisionGroupCase_inputObjectId_fkey" FOREIGN KEY ("inputObjectId") REFERENCES "TestdataObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemTestSetRevisionGroupCase" ADD CONSTRAINT "ProblemTestSetRevisionGroupCase_outputObjectId_fkey" FOREIGN KEY ("outputObjectId") REFERENCES "TestdataObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingProblem" ADD CONSTRAINT "TrainingProblem_testSetRevisionId_fkey" FOREIGN KEY ("testSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_testSetRevisionId_fkey" FOREIGN KEY ("testSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProblemHackAttempt" ADD CONSTRAINT "ProblemHackAttempt_baseTestSetRevisionId_fkey" FOREIGN KEY ("baseTestSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProblemHackAttempt" ADD CONSTRAINT "ProblemHackAttempt_promotedRevisionId_fkey" FOREIGN KEY ("promotedRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
