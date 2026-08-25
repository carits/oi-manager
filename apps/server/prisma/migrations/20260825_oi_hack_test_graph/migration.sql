ALTER TABLE "Problem" ADD COLUMN "testGraphRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProblemHackAttempt"
  ADD COLUMN "acceptedTestcaseId" TEXT,
  ADD COLUMN "affectedSubtaskIds" TEXT,
  ADD COLUMN "baselineScore" INTEGER,
  ADD COLUMN "candidateScore" INTEGER,
  ADD COLUMN "scoreDelta" INTEGER,
  ADD COLUMN "testGraphRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProblemHackConfig"
  ADD COLUMN "classifierLanguage" TEXT NOT NULL DEFAULT 'cpp17',
  ADD COLUMN "classifierSource" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'acm';
ALTER TABLE "TrainingProblem" ADD COLUMN "testGraphRevisionSnapshot" INTEGER;

CREATE TABLE "ProblemTestcase" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "inputFileId" TEXT NOT NULL,
  "outputFileId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'official',
  "hackerId" TEXT,
  "hackAttemptId" TEXT,
  "inputSha256" TEXT,
  "outputSha256" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProblemTestcase_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProblemSubtask" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "subtaskId" INTEGER NOT NULL,
  "score" INTEGER NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProblemSubtask_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProblemSubtaskDependency" (
  "id" TEXT NOT NULL,
  "subtaskId" TEXT NOT NULL,
  "dependsOnId" TEXT NOT NULL,
  CONSTRAINT "ProblemSubtaskDependency_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProblemTestGroup" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "subtaskId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "aggregation" TEXT NOT NULL DEFAULT 'min',
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProblemTestGroup_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProblemTestcaseGroup" (
  "id" TEXT NOT NULL,
  "testcaseId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "score" INTEGER,
  "time" TEXT,
  "memory" TEXT,
  CONSTRAINT "ProblemTestcaseGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProblemTestcase_problemId_source_enabled_idx" ON "ProblemTestcase"("problemId", "source", "enabled");
CREATE INDEX "ProblemTestcase_hackAttemptId_idx" ON "ProblemTestcase"("hackAttemptId");
CREATE UNIQUE INDEX "ProblemTestcase_problemId_inputFileId_outputFileId_key" ON "ProblemTestcase"("problemId", "inputFileId", "outputFileId");
CREATE INDEX "ProblemSubtask_problemId_orderIndex_idx" ON "ProblemSubtask"("problemId", "orderIndex");
CREATE UNIQUE INDEX "ProblemSubtask_problemId_subtaskId_key" ON "ProblemSubtask"("problemId", "subtaskId");
CREATE INDEX "ProblemSubtaskDependency_dependsOnId_idx" ON "ProblemSubtaskDependency"("dependsOnId");
CREATE UNIQUE INDEX "ProblemSubtaskDependency_subtaskId_dependsOnId_key" ON "ProblemSubtaskDependency"("subtaskId", "dependsOnId");
CREATE INDEX "ProblemTestGroup_problemId_kind_idx" ON "ProblemTestGroup"("problemId", "kind");
CREATE UNIQUE INDEX "ProblemTestGroup_subtaskId_key_key" ON "ProblemTestGroup"("subtaskId", "key");
CREATE INDEX "ProblemTestcaseGroup_groupId_orderIndex_idx" ON "ProblemTestcaseGroup"("groupId", "orderIndex");
CREATE UNIQUE INDEX "ProblemTestcaseGroup_testcaseId_groupId_key" ON "ProblemTestcaseGroup"("testcaseId", "groupId");

ALTER TABLE "ProblemTestcase" ADD CONSTRAINT "ProblemTestcase_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestcase" ADD CONSTRAINT "ProblemTestcase_inputFileId_fkey" FOREIGN KEY ("inputFileId") REFERENCES "TestdataFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemTestcase" ADD CONSTRAINT "ProblemTestcase_outputFileId_fkey" FOREIGN KEY ("outputFileId") REFERENCES "TestdataFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemSubtask" ADD CONSTRAINT "ProblemSubtask_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemSubtaskDependency" ADD CONSTRAINT "ProblemSubtaskDependency_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "ProblemSubtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemSubtaskDependency" ADD CONSTRAINT "ProblemSubtaskDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "ProblemSubtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestGroup" ADD CONSTRAINT "ProblemTestGroup_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestGroup" ADD CONSTRAINT "ProblemTestGroup_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "ProblemSubtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestcaseGroup" ADD CONSTRAINT "ProblemTestcaseGroup_testcaseId_fkey" FOREIGN KEY ("testcaseId") REFERENCES "ProblemTestcase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemTestcaseGroup" ADD CONSTRAINT "ProblemTestcaseGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProblemTestGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
