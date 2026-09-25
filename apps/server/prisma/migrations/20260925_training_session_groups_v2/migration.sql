ALTER TABLE "TrainingSession" ADD COLUMN IF NOT EXISTS "groupingModelVersion" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS "TrainingSessionGroup" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "name" TEXT NOT NULL, "orderIndex" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'active', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingSessionGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingSessionGroup_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrainingSessionGroup_sessionId_name_key" ON "TrainingSessionGroup"("sessionId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "TrainingSessionGroup_sessionId_orderIndex_key" ON "TrainingSessionGroup"("sessionId", "orderIndex");
CREATE INDEX IF NOT EXISTS "TrainingSessionGroup_sessionId_status_idx" ON "TrainingSessionGroup"("sessionId", "status");
CREATE TABLE IF NOT EXISTS "TrainingSessionGroupMembership" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "groupId" TEXT NOT NULL, "participantId" TEXT NOT NULL, "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "assignedBy" TEXT, "source" TEXT NOT NULL DEFAULT 'structure',
  CONSTRAINT "TrainingSessionGroupMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingSessionGroupMembership_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingSessionGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingSessionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingSessionGroupMembership_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TrainingSessionParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrainingSessionGroupMembership_participantId_key" ON "TrainingSessionGroupMembership"("participantId");
CREATE UNIQUE INDEX IF NOT EXISTS "TrainingSessionGroupMembership_sessionId_participantId_key" ON "TrainingSessionGroupMembership"("sessionId", "participantId");
CREATE INDEX IF NOT EXISTS "TrainingSessionGroupMembership_sessionId_groupId_idx" ON "TrainingSessionGroupMembership"("sessionId", "groupId");
CREATE TABLE IF NOT EXISTS "TrainingSessionStageGroupPlan" (
  "id" TEXT NOT NULL, "stageId" TEXT NOT NULL, "trainingGroupId" TEXT NOT NULL, "name" TEXT, "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "accessPolicy" "TrainingEngineStageAccessPolicy" NOT NULL DEFAULT 'ALL_AT_ONCE', "submissionMode" "TrainingEngineSubmissionMode" NOT NULL DEFAULT 'ENABLED', "rules" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingSessionStageGroupPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingSessionStageGroupPlan_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TrainingSessionStage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingSessionStageGroupPlan_trainingGroupId_fkey" FOREIGN KEY ("trainingGroupId") REFERENCES "TrainingSessionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrainingSessionStageGroupPlan_stageId_trainingGroupId_key" ON "TrainingSessionStageGroupPlan"("stageId", "trainingGroupId");
CREATE UNIQUE INDEX IF NOT EXISTS "TrainingSessionStageGroupPlan_stageId_orderIndex_key" ON "TrainingSessionStageGroupPlan"("stageId", "orderIndex");
CREATE INDEX IF NOT EXISTS "TrainingSessionStageGroupPlan_trainingGroupId_idx" ON "TrainingSessionStageGroupPlan"("trainingGroupId");
ALTER TABLE "TrainingSessionStageProblemPlan" ADD COLUMN IF NOT EXISTS "stageGroupPlanId" TEXT;
ALTER TABLE "TrainingSessionStageProblemPlan" ADD CONSTRAINT "TrainingSessionStageProblemPlan_stageGroupPlanId_fkey" FOREIGN KEY ("stageGroupPlanId") REFERENCES "TrainingSessionStageGroupPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE IF NOT EXISTS "TrainingSessionGroupChange" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "participantId" TEXT NOT NULL, "fromGroupId" TEXT, "toGroupId" TEXT NOT NULL, "reason" TEXT NOT NULL, "changedBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingSessionGroupChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingSessionGroupChange_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingSessionGroupChange_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TrainingSessionParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingSessionGroupChange_fromGroupId_fkey" FOREIGN KEY ("fromGroupId") REFERENCES "TrainingSessionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TrainingSessionGroupChange_toGroupId_fkey" FOREIGN KEY ("toGroupId") REFERENCES "TrainingSessionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TrainingSessionGroupChange_sessionId_createdAt_idx" ON "TrainingSessionGroupChange"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "TrainingSessionGroupChange_participantId_createdAt_idx" ON "TrainingSessionGroupChange"("participantId", "createdAt");
