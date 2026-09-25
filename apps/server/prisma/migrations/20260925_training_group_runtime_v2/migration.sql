ALTER TABLE "TrainingSessionStageGroupPlan" ADD COLUMN IF NOT EXISTS "trainingMode" TEXT NOT NULL DEFAULT 'PRACTICE';
ALTER TABLE "TrainingSessionStageGroupPlan" ADD COLUMN IF NOT EXISTS "completionPolicy" JSONB;
ALTER TABLE "TrainingSessionStageGroupPlan" ADD COLUMN IF NOT EXISTS "transitionPolicy" TEXT NOT NULL DEFAULT 'WAIT_FOR_TEACHER';
CREATE TABLE "TrainingSessionGroupRuntimeState" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "groupId" TEXT NOT NULL, "currentStageId" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "stageStartedAt" TIMESTAMP(3), "runningSince" TIMESTAMP(3), "activeElapsedSeconds" INTEGER NOT NULL DEFAULT 0, "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingSessionGroupRuntimeState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingSessionGroupRuntimeState_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingSessionGroupRuntimeState_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingSessionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingSessionGroupRuntimeState_currentStageId_fkey" FOREIGN KEY ("currentStageId") REFERENCES "TrainingSessionStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrainingSessionGroupRuntimeState_groupId_key" ON "TrainingSessionGroupRuntimeState"("groupId");
CREATE INDEX "TrainingSessionGroupRuntimeState_sessionId_status_idx" ON "TrainingSessionGroupRuntimeState"("sessionId", "status");
CREATE INDEX "TrainingSessionGroupRuntimeState_currentStageId_idx" ON "TrainingSessionGroupRuntimeState"("currentStageId");
CREATE TABLE "TrainingSessionStageGroupRuntimeSnapshot" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "stageId" TEXT NOT NULL, "groupId" TEXT NOT NULL, "stageGroupPlanId" TEXT NOT NULL, "runtimeRevision" INTEGER NOT NULL,
  "projection" JSONB NOT NULL, "projectionHash" TEXT NOT NULL, "memberParticipantIds" JSONB NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL, "endedAt" TIMESTAMP(3), "endReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingSessionStageGroupRuntimeSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingSessionStageGroupRuntimeSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TrainingSessionStageGroupRuntimeSnapshot_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TrainingSessionStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TrainingSessionStageGroupRuntimeSnapshot_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingSessionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TrainingSessionStageGroupRuntimeSnapshot_stageGroupPlanId_fkey" FOREIGN KEY ("stageGroupPlanId") REFERENCES "TrainingSessionStageGroupPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrainingSessionStageGroupRuntimeSnapshot_stageId_groupId_key" ON "TrainingSessionStageGroupRuntimeSnapshot"("stageId", "groupId");
CREATE INDEX "TrainingSessionStageGroupRuntimeSnapshot_sessionId_startedAt_idx" ON "TrainingSessionStageGroupRuntimeSnapshot"("sessionId", "startedAt");
CREATE INDEX "TrainingSessionStageGroupRuntimeSnapshot_projectionHash_idx" ON "TrainingSessionStageGroupRuntimeSnapshot"("projectionHash");
