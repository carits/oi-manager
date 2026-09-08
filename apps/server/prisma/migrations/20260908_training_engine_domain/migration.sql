CREATE TYPE "TrainingEngineSessionType" AS ENUM ('OI', 'ACM', 'GENERAL');
CREATE TYPE "TrainingEngineSessionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'ENDED', 'ARCHIVED');
CREATE TYPE "TrainingEngineStageMode" AS ENUM ('FREE', 'SEQUENTIAL', 'FOCUS', 'SCORE_PROGRESSIVE', 'TEACHING', 'REVIEW', 'MOCK_CONTEST');
CREATE TYPE "TrainingEngineAdvanceMode" AS ENUM ('MANUAL', 'TIME', 'COMPLETION', 'HYBRID');
CREATE TYPE "TrainingEngineProblemAccessMode" AS ENUM ('ALL', 'STAGE_ONLY', 'SEQUENTIAL', 'FOCUS_ONLY');
CREATE TYPE "TrainingEngineSubmissionMode" AS ENUM ('ENABLED', 'DISABLED');
CREATE TYPE "TrainingEnginePauseMode" AS ENUM ('SOFT', 'HARD');
CREATE TYPE "TrainingEngineTargetType" AS ENUM ('ALL', 'GROUP', 'TEAM', 'USER');
CREATE TYPE "TrainingEngineProgressStatus" AS ENUM ('NOT_STARTED', 'WORKING', 'STUCK', 'COMPLETED', 'SKIPPED', 'PAUSED', 'FOCUS_OVERRIDE');
CREATE TYPE "TrainingEngineRankingMode" AS ENUM ('OFF', 'PROGRESS_ONLY', 'SCORE', 'ACM_RANKING');
CREATE TYPE "TrainingEnginePeerVisibility" AS ENUM ('NONE', 'PROGRESS', 'SCORE', 'FULL');
CREATE TYPE "TrainingEngineJoinMode" AS ENUM ('CURRENT_STAGE', 'FROM_BEGINNING', 'TEACHER_ASSIGN');
CREATE TYPE "TrainingEngineHintOpenMode" AS ENUM ('MANUAL', 'TIME', 'ATTEMPT', 'SCORE');

ALTER TABLE "Submission"
  ADD COLUMN "trainingSessionId" TEXT,
  ADD COLUMN "trainingStageProblemId" TEXT,
  ADD COLUMN "judgeConfigSnapshot" TEXT;

ALTER TABLE "JudgeRun" ADD COLUMN "judgeConfigSnapshot" TEXT;

CREATE TABLE "TrainingSession" (
  "id" TEXT NOT NULL,
  "legacyTrainingId" INTEGER,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sessionType" "TrainingEngineSessionType" NOT NULL DEFAULT 'GENERAL',
  "status" "TrainingEngineSessionStatus" NOT NULL DEFAULT 'DRAFT',
  "organizationId" TEXT,
  "teamId" TEXT,
  "createdBy" TEXT NOT NULL,
  "scheduledStartAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "runningSince" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "activeElapsedSeconds" INTEGER NOT NULL DEFAULT 0,
  "currentStageId" TEXT,
  "statusRevision" INTEGER NOT NULL DEFAULT 0,
  "commandSeq" INTEGER NOT NULL DEFAULT 0,
  "eventSeq" INTEGER NOT NULL DEFAULT 0,
  "defaultProblemAccessMode" "TrainingEngineProblemAccessMode" NOT NULL DEFAULT 'STAGE_ONLY',
  "defaultSubmissionMode" "TrainingEngineSubmissionMode" NOT NULL DEFAULT 'ENABLED',
  "pauseMode" "TrainingEnginePauseMode",
  "allowHints" BOOLEAN NOT NULL DEFAULT true,
  "allowSolution" BOOLEAN NOT NULL DEFAULT false,
  "allowDiscussion" BOOLEAN NOT NULL DEFAULT false,
  "rankingMode" "TrainingEngineRankingMode" NOT NULL DEFAULT 'PROGRESS_ONLY',
  "peerVisibility" "TrainingEnginePeerVisibility" NOT NULL DEFAULT 'PROGRESS',
  "joinMode" "TrainingEngineJoinMode" NOT NULL DEFAULT 'CURRENT_STAGE',
  "settings" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingSession_exactly_one_scope" CHECK (("organizationId" IS NOT NULL)::int + ("teamId" IS NOT NULL)::int = 1)
);

CREATE TABLE "TrainingSessionStage" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
  "orderIndex" INTEGER NOT NULL, "mode" "TrainingEngineStageMode" NOT NULL DEFAULT 'FREE',
  "durationSeconds" INTEGER, "advanceMode" "TrainingEngineAdvanceMode" NOT NULL DEFAULT 'MANUAL',
  "problemAccessMode" "TrainingEngineProblemAccessMode" NOT NULL DEFAULT 'STAGE_ONLY',
  "submissionMode" "TrainingEngineSubmissionMode" NOT NULL DEFAULT 'ENABLED', "targetScore" INTEGER,
  "completionThreshold" INTEGER, "minDurationSeconds" INTEGER, "status" TEXT NOT NULL DEFAULT 'pending',
  "rules" JSONB, "startedAt" TIMESTAMP(3), "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingSessionStage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionStageProblem" (
  "id" TEXT NOT NULL, "stageId" TEXT NOT NULL, "problemId" TEXT NOT NULL, "testSetRevisionId" TEXT NOT NULL,
  "alias" TEXT, "orderIndex" INTEGER NOT NULL, "unlockPolicy" JSONB, "targetScore" INTEGER,
  "timeLimitSeconds" INTEGER, "hintPolicy" JSONB, "judgeConfigProjection" TEXT, "allowedSubtaskIds" JSONB,
  "strategyIntervalSeconds" INTEGER, "maxContinuousWorkSeconds" INTEGER,
  "forceSwitchOnTimeout" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingSessionStageProblem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionGroup" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "name" TEXT NOT NULL, "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingSessionGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionParticipant" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "userId" TEXT NOT NULL, "groupId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active', "currentStageId" TEXT, "currentProblemId" TEXT,
  "returnStageId" TEXT, "returnProblemId" TEXT, "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3), "activeSeconds" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingSessionParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionProblemProgress" (
  "id" TEXT NOT NULL, "participantId" TEXT NOT NULL, "stageProblemId" TEXT NOT NULL,
  "status" "TrainingEngineProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "firstOpenedAt" TIMESTAMP(3), "lastOpenedAt" TIMESTAMP(3), "activeSeconds" INTEGER NOT NULL DEFAULT 0,
  "continuousActiveSeconds" INTEGER NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0, "bestScore" INTEGER, "bestVerdict" TEXT, "acAt" TIMESTAMP(3),
  "hintCount" INTEGER NOT NULL DEFAULT 0, "highestHintLevel" INTEGER NOT NULL DEFAULT 0,
  "lastSubmissionAt" TIMESTAMP(3), "lastScoreImprovedAt" TIMESTAMP(3), "lastProgressAt" TIMESTAMP(3), "stuckDetectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingSessionProblemProgress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionCommand" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "seq" INTEGER NOT NULL, "type" TEXT NOT NULL,
  "targetType" "TrainingEngineTargetType" NOT NULL DEFAULT 'ALL', "targetId" TEXT, "payload" JSONB,
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingSessionCommand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionOverlay" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "type" TEXT NOT NULL,
  "targetType" "TrainingEngineTargetType" NOT NULL DEFAULT 'ALL', "targetId" TEXT, "stageProblemId" TEXT,
  "payload" JSONB, "status" TEXT NOT NULL DEFAULT 'active', "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3), "endedAt" TIMESTAMP(3), "createdBy" TEXT NOT NULL,
  CONSTRAINT "TrainingSessionOverlay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionUserOverride" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" TEXT NOT NULL,
  "stageProblemId" TEXT, "payload" JSONB, "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingSessionUserOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionProblemDraft" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "userId" TEXT NOT NULL, "problemId" TEXT NOT NULL,
  "language" TEXT NOT NULL, "code" TEXT NOT NULL, "inputFilename" TEXT, "outputFilename" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1, "editorFocused" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingSessionProblemDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionHint" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "stageProblemId" TEXT NOT NULL, "level" INTEGER NOT NULL,
  "title" TEXT, "content" TEXT NOT NULL, "openMode" "TrainingEngineHintOpenMode" NOT NULL DEFAULT 'MANUAL',
  "triggerSeconds" INTEGER, "triggerAttempts" INTEGER, "triggerScore" INTEGER, "globallyOpenedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingSessionHint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionHintAccess" (
  "id" TEXT NOT NULL, "hintId" TEXT NOT NULL, "participantId" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "source" TEXT NOT NULL, "openedBy" TEXT,
  CONSTRAINT "TrainingSessionHintAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionScoreEvent" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "participantId" TEXT NOT NULL,
  "stageProblemId" TEXT NOT NULL, "submissionId" INTEGER NOT NULL, "score" INTEGER, "verdict" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingSessionScoreEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionStrategyDecision" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "participantId" TEXT NOT NULL,
  "stageProblemId" TEXT, "decision" TEXT NOT NULL, "reason" TEXT,
  "activeSecondsAtDecision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingSessionStrategyDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionEvent" (
  "id" BIGSERIAL NOT NULL, "sessionId" TEXT NOT NULL, "seq" INTEGER NOT NULL, "type" TEXT NOT NULL,
  "targetType" "TrainingEngineTargetType" NOT NULL DEFAULT 'ALL', "targetId" TEXT, "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingSessionEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionTemplate" (
  "id" TEXT NOT NULL, "organizationId" TEXT, "teamId" TEXT, "key" TEXT NOT NULL, "name" TEXT NOT NULL,
  "sessionType" "TrainingEngineSessionType" NOT NULL, "description" TEXT, "settings" JSONB,
  "status" TEXT NOT NULL DEFAULT 'active', "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingSessionTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingSessionTemplateStage" (
  "id" TEXT NOT NULL, "templateId" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
  "orderIndex" INTEGER NOT NULL, "mode" "TrainingEngineStageMode" NOT NULL,
  "durationSeconds" INTEGER, "advanceMode" "TrainingEngineAdvanceMode" NOT NULL, "rules" JSONB,
  CONSTRAINT "TrainingSessionTemplateStage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrainingSession_organizationId_status_idx" ON "TrainingSession"("organizationId", "status");
CREATE UNIQUE INDEX "TrainingSession_legacyTrainingId_key" ON "TrainingSession"("legacyTrainingId");
CREATE INDEX "TrainingSession_teamId_status_idx" ON "TrainingSession"("teamId", "status");
CREATE INDEX "TrainingSession_createdBy_createdAt_idx" ON "TrainingSession"("createdBy", "createdAt");
CREATE INDEX "TrainingSession_status_scheduledStartAt_idx" ON "TrainingSession"("status", "scheduledStartAt");
CREATE UNIQUE INDEX "TrainingSessionStage_sessionId_orderIndex_key" ON "TrainingSessionStage"("sessionId", "orderIndex");
CREATE INDEX "TrainingSessionStage_sessionId_status_idx" ON "TrainingSessionStage"("sessionId", "status");
CREATE UNIQUE INDEX "TrainingSessionStageProblem_stageId_problemId_key" ON "TrainingSessionStageProblem"("stageId", "problemId");
CREATE UNIQUE INDEX "TrainingSessionStageProblem_stageId_orderIndex_key" ON "TrainingSessionStageProblem"("stageId", "orderIndex");
CREATE INDEX "TrainingSessionStageProblem_problemId_idx" ON "TrainingSessionStageProblem"("problemId");
CREATE INDEX "TrainingSessionStageProblem_testSetRevisionId_idx" ON "TrainingSessionStageProblem"("testSetRevisionId");
CREATE UNIQUE INDEX "TrainingSessionGroup_sessionId_name_key" ON "TrainingSessionGroup"("sessionId", "name");
CREATE INDEX "TrainingSessionGroup_sessionId_orderIndex_idx" ON "TrainingSessionGroup"("sessionId", "orderIndex");
CREATE UNIQUE INDEX "TrainingSessionParticipant_sessionId_userId_key" ON "TrainingSessionParticipant"("sessionId", "userId");
CREATE INDEX "TrainingSessionParticipant_userId_status_idx" ON "TrainingSessionParticipant"("userId", "status");
CREATE INDEX "TrainingSessionParticipant_sessionId_groupId_idx" ON "TrainingSessionParticipant"("sessionId", "groupId");
CREATE UNIQUE INDEX "TrainingSessionProblemProgress_participantId_stageProblemId_key" ON "TrainingSessionProblemProgress"("participantId", "stageProblemId");
CREATE INDEX "TrainingSessionProblemProgress_stageProblemId_status_idx" ON "TrainingSessionProblemProgress"("stageProblemId", "status");
CREATE INDEX "TrainingSessionProblemProgress_participantId_lastProgressAt_idx" ON "TrainingSessionProblemProgress"("participantId", "lastProgressAt");
CREATE UNIQUE INDEX "TrainingSessionCommand_sessionId_seq_key" ON "TrainingSessionCommand"("sessionId", "seq");
CREATE INDEX "TrainingSessionCommand_sessionId_createdAt_idx" ON "TrainingSessionCommand"("sessionId", "createdAt");
CREATE INDEX "TrainingSessionOverlay_sessionId_status_startedAt_idx" ON "TrainingSessionOverlay"("sessionId", "status", "startedAt");
CREATE INDEX "TrainingSessionOverlay_expiresAt_status_idx" ON "TrainingSessionOverlay"("expiresAt", "status");
CREATE INDEX "TrainingSessionUserOverride_sessionId_userId_type_idx" ON "TrainingSessionUserOverride"("sessionId", "userId", "type");
CREATE INDEX "TrainingSessionUserOverride_expiresAt_idx" ON "TrainingSessionUserOverride"("expiresAt");
CREATE UNIQUE INDEX "TrainingSessionProblemDraft_sessionId_userId_problemId_key" ON "TrainingSessionProblemDraft"("sessionId", "userId", "problemId");
CREATE INDEX "TrainingSessionProblemDraft_userId_updatedAt_idx" ON "TrainingSessionProblemDraft"("userId", "updatedAt");
CREATE UNIQUE INDEX "TrainingSessionHint_stageProblemId_level_key" ON "TrainingSessionHint"("stageProblemId", "level");
CREATE INDEX "TrainingSessionHint_sessionId_level_idx" ON "TrainingSessionHint"("sessionId", "level");
CREATE UNIQUE INDEX "TrainingSessionHintAccess_hintId_participantId_key" ON "TrainingSessionHintAccess"("hintId", "participantId");
CREATE INDEX "TrainingSessionHintAccess_participantId_openedAt_idx" ON "TrainingSessionHintAccess"("participantId", "openedAt");
CREATE UNIQUE INDEX "TrainingSessionScoreEvent_submissionId_key" ON "TrainingSessionScoreEvent"("submissionId");
CREATE INDEX "TrainingSessionScoreEvent_sessionId_participantId_createdAt_idx" ON "TrainingSessionScoreEvent"("sessionId", "participantId", "createdAt");
CREATE INDEX "TrainingSessionScoreEvent_stageProblemId_createdAt_idx" ON "TrainingSessionScoreEvent"("stageProblemId", "createdAt");
CREATE INDEX "TrainingSessionStrategyDecision_sessionId_participantId_createdAt_idx" ON "TrainingSessionStrategyDecision"("sessionId", "participantId", "createdAt");
CREATE UNIQUE INDEX "TrainingSessionEvent_sessionId_seq_key" ON "TrainingSessionEvent"("sessionId", "seq");
CREATE INDEX "TrainingSessionEvent_sessionId_createdAt_idx" ON "TrainingSessionEvent"("sessionId", "createdAt");
CREATE INDEX "TrainingSessionEvent_expiresAt_idx" ON "TrainingSessionEvent"("expiresAt");
CREATE UNIQUE INDEX "TrainingSessionTemplate_organizationId_teamId_key_key" ON "TrainingSessionTemplate"("organizationId", "teamId", "key");
CREATE INDEX "TrainingSessionTemplate_organizationId_status_idx" ON "TrainingSessionTemplate"("organizationId", "status");
CREATE INDEX "TrainingSessionTemplate_teamId_status_idx" ON "TrainingSessionTemplate"("teamId", "status");
CREATE UNIQUE INDEX "TrainingSessionTemplateStage_templateId_orderIndex_key" ON "TrainingSessionTemplateStage"("templateId", "orderIndex");
CREATE INDEX "Submission_trainingSessionId_idx" ON "Submission"("trainingSessionId");
CREATE INDEX "Submission_trainingStageProblemId_idx" ON "Submission"("trainingStageProblemId");

ALTER TABLE "Submission" ADD CONSTRAINT "Submission_trainingSessionId_fkey" FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_trainingStageProblemId_fkey" FOREIGN KEY ("trainingStageProblemId") REFERENCES "TrainingSessionStageProblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionStage" ADD CONSTRAINT "TrainingSessionStage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionStageProblem" ADD CONSTRAINT "TrainingSessionStageProblem_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TrainingSessionStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionStageProblem" ADD CONSTRAINT "TrainingSessionStageProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionStageProblem" ADD CONSTRAINT "TrainingSessionStageProblem_testSetRevisionId_fkey" FOREIGN KEY ("testSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionGroup" ADD CONSTRAINT "TrainingSessionGroup_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionParticipant" ADD CONSTRAINT "TrainingSessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionParticipant" ADD CONSTRAINT "TrainingSessionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionParticipant" ADD CONSTRAINT "TrainingSessionParticipant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingSessionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionProblemProgress" ADD CONSTRAINT "TrainingSessionProblemProgress_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TrainingSessionParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionProblemProgress" ADD CONSTRAINT "TrainingSessionProblemProgress_stageProblemId_fkey" FOREIGN KEY ("stageProblemId") REFERENCES "TrainingSessionStageProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionCommand" ADD CONSTRAINT "TrainingSessionCommand_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionOverlay" ADD CONSTRAINT "TrainingSessionOverlay_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionUserOverride" ADD CONSTRAINT "TrainingSessionUserOverride_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionProblemDraft" ADD CONSTRAINT "TrainingSessionProblemDraft_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionHint" ADD CONSTRAINT "TrainingSessionHint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionHint" ADD CONSTRAINT "TrainingSessionHint_stageProblemId_fkey" FOREIGN KEY ("stageProblemId") REFERENCES "TrainingSessionStageProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionHintAccess" ADD CONSTRAINT "TrainingSessionHintAccess_hintId_fkey" FOREIGN KEY ("hintId") REFERENCES "TrainingSessionHint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionHintAccess" ADD CONSTRAINT "TrainingSessionHintAccess_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TrainingSessionParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionScoreEvent" ADD CONSTRAINT "TrainingSessionScoreEvent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TrainingSessionParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionScoreEvent" ADD CONSTRAINT "TrainingSessionScoreEvent_stageProblemId_fkey" FOREIGN KEY ("stageProblemId") REFERENCES "TrainingSessionStageProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionStrategyDecision" ADD CONSTRAINT "TrainingSessionStrategyDecision_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TrainingSessionParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionStrategyDecision" ADD CONSTRAINT "TrainingSessionStrategyDecision_stageProblemId_fkey" FOREIGN KEY ("stageProblemId") REFERENCES "TrainingSessionStageProblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionEvent" ADD CONSTRAINT "TrainingSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingSessionTemplateStage" ADD CONSTRAINT "TrainingSessionTemplateStage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TrainingSessionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
