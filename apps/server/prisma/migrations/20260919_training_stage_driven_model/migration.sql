-- Training Engine stage-driven cutover. This migration is intentionally a
-- single-writer cutover: active/scheduled classroom state must be drained first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "TrainingSession"
    WHERE status IN ('SCHEDULED', 'RUNNING', 'PAUSED')
  ) THEN
    RAISE EXCEPTION 'TRAINING_STAGE_MIGRATION_ACTIVE_SESSION';
  END IF;
END $$;

CREATE TYPE "TrainingEngineStageKind" AS ENUM ('TRAINING', 'TEACHING', 'REVIEW');
CREATE TYPE "TrainingEngineStageAudienceMode" AS ENUM ('ALL', 'GROUPED');
CREATE TYPE "TrainingEngineStageLifecycle" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'ENDED_EARLY', 'SKIPPED');
CREATE TYPE "TrainingEngineStageEndPolicy" AS ENUM ('MANUAL', 'TIME', 'COMPLETION', 'HYBRID');
CREATE TYPE "TrainingEngineStageAccessPolicy" AS ENUM ('ALL_AT_ONCE', 'SEQUENTIAL', 'TEACHER_CONTROLLED');
CREATE TYPE "TrainingEngineGroupChangeEffectiveMode" AS ENUM ('IMMEDIATE', 'NEXT_STAGE');

ALTER TABLE "TrainingSession" ADD COLUMN "defaultAccessPolicy" "TrainingEngineStageAccessPolicy" NOT NULL DEFAULT 'ALL_AT_ONCE';
UPDATE "TrainingSession"
SET "defaultAccessPolicy" = CASE
  WHEN "defaultProblemAccessMode"::text = 'SEQUENTIAL' THEN 'SEQUENTIAL'::"TrainingEngineStageAccessPolicy"
  WHEN "defaultProblemAccessMode"::text = 'FOCUS_ONLY' THEN 'TEACHER_CONTROLLED'::"TrainingEngineStageAccessPolicy"
  ELSE 'ALL_AT_ONCE'::"TrainingEngineStageAccessPolicy"
END;

ALTER TABLE "TrainingSessionStage"
  ADD COLUMN "kind" "TrainingEngineStageKind" NOT NULL DEFAULT 'TRAINING',
  ADD COLUMN "audienceMode" "TrainingEngineStageAudienceMode" NOT NULL DEFAULT 'ALL',
  ADD COLUMN "lifecycle" "TrainingEngineStageLifecycle" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "endPolicy" "TrainingEngineStageEndPolicy" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "accessPolicy" "TrainingEngineStageAccessPolicy" NOT NULL DEFAULT 'ALL_AT_ONCE',
  ADD COLUMN "plannedDurationSeconds" INTEGER,
  ADD COLUMN "defaultTargetScore" INTEGER,
  ADD COLUMN "runningSince" TIMESTAMP(3),
  ADD COLUMN "activeElapsedSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "endedBy" TEXT,
  ADD COLUMN "endReason" TEXT,
  ADD COLUMN "definitionRevision" INTEGER NOT NULL DEFAULT 0;

UPDATE "TrainingSessionStage" s SET
  "kind" = CASE
    WHEN s.mode::text = 'TEACHING' THEN 'TEACHING'::"TrainingEngineStageKind"
    WHEN s.mode::text = 'REVIEW' THEN 'REVIEW'::"TrainingEngineStageKind"
    ELSE 'TRAINING'::"TrainingEngineStageKind"
  END,
  "audienceMode" = CASE WHEN EXISTS (
    SELECT 1 FROM "TrainingSessionGroup" g WHERE g."sessionId" = s."sessionId"
  ) THEN 'GROUPED'::"TrainingEngineStageAudienceMode" ELSE 'ALL'::"TrainingEngineStageAudienceMode" END,
  "lifecycle" = CASE lower(s.status)
    WHEN 'running' THEN 'RUNNING'::"TrainingEngineStageLifecycle"
    WHEN 'completed' THEN 'COMPLETED'::"TrainingEngineStageLifecycle"
    WHEN 'ended_early' THEN 'ENDED_EARLY'::"TrainingEngineStageLifecycle"
    WHEN 'skipped' THEN 'SKIPPED'::"TrainingEngineStageLifecycle"
    ELSE 'PENDING'::"TrainingEngineStageLifecycle"
  END,
  "endPolicy" = s."advanceMode"::text::"TrainingEngineStageEndPolicy",
  "accessPolicy" = CASE
    WHEN s."problemAccessMode"::text = 'SEQUENTIAL' OR s.mode::text = 'SEQUENTIAL' THEN 'SEQUENTIAL'::"TrainingEngineStageAccessPolicy"
    WHEN s."problemAccessMode"::text = 'FOCUS_ONLY' OR s.mode::text = 'FOCUS' THEN 'TEACHER_CONTROLLED'::"TrainingEngineStageAccessPolicy"
    ELSE 'ALL_AT_ONCE'::"TrainingEngineStageAccessPolicy"
  END,
  "plannedDurationSeconds" = s."durationSeconds",
  "defaultTargetScore" = s."targetScore",
  "runningSince" = CASE WHEN lower(s.status) = 'running' THEN s."startedAt" ELSE NULL END,
  "activeElapsedSeconds" = CASE
    WHEN s."startedAt" IS NOT NULL AND s."endedAt" IS NOT NULL
      THEN GREATEST(0, floor(extract(epoch FROM (s."endedAt" - s."startedAt")))::integer)
    ELSE 0
  END;

ALTER TABLE "TrainingSessionStageProblem" ADD COLUMN "scoreGoals" JSONB;
UPDATE "TrainingSessionStageProblem" p
SET "scoreGoals" = jsonb_build_array(jsonb_build_object(
  'score', COALESCE(p."targetScore", s."targetScore", 100),
  'allowedSubtaskIds', COALESCE(p."allowedSubtaskIds", '[]'::jsonb)
))
FROM "TrainingSessionStage" s
WHERE p."stageId" = s.id AND s.mode::text = 'SCORE_PROGRESSIVE';

CREATE TABLE "TrainingSessionStageGroup" (
  "id" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "accessPolicy" "TrainingEngineStageAccessPolicy" NOT NULL DEFAULT 'ALL_AT_ONCE',
  "submissionMode" "TrainingEngineSubmissionMode" NOT NULL DEFAULT 'ENABLED',
  "rules" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingSessionStageGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingSessionStageGroup_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TrainingSessionStage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrainingSessionStageGroup_stageId_name_key" ON "TrainingSessionStageGroup"("stageId", "name");
CREATE UNIQUE INDEX "TrainingSessionStageGroup_stageId_orderIndex_key" ON "TrainingSessionStageGroup"("stageId", "orderIndex");
CREATE INDEX "TrainingSessionStageGroup_stageId_idx" ON "TrainingSessionStageGroup"("stageId");

CREATE TEMP TABLE "_TrainingStageGroupMap" (
  "stageId" TEXT NOT NULL,
  "oldGroupId" TEXT NOT NULL,
  "newGroupId" TEXT NOT NULL,
  PRIMARY KEY ("stageId", "oldGroupId")
) ON COMMIT DROP;

INSERT INTO "_TrainingStageGroupMap" ("stageId", "oldGroupId", "newGroupId")
SELECT s.id, g.id, gen_random_uuid()::text
FROM "TrainingSessionStage" s
JOIN "TrainingSessionGroup" g ON g."sessionId" = s."sessionId";

INSERT INTO "TrainingSessionStageGroup" ("id", "stageId", "name", "orderIndex", "accessPolicy", "submissionMode", "createdAt", "updatedAt")
SELECT m."newGroupId", m."stageId", g.name, g."orderIndex", s."accessPolicy", s."submissionMode", g."createdAt", CURRENT_TIMESTAMP
FROM "_TrainingStageGroupMap" m
JOIN "TrainingSessionGroup" g ON g.id = m."oldGroupId"
JOIN "TrainingSessionStage" s ON s.id = m."stageId";

CREATE TABLE "TrainingSessionStageParticipantAssignment" (
  "id" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "groupId" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedBy" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  CONSTRAINT "TrainingSessionStageParticipantAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingStageParticipantAssignment_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TrainingSessionStage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingStageParticipantAssignment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TrainingSessionParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingStageParticipantAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingSessionStageGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrainingStageParticipantAssignment_stage_participant_key" ON "TrainingSessionStageParticipantAssignment"("stageId", "participantId");
CREATE INDEX "TrainingStageParticipantAssignment_participant_stage_idx" ON "TrainingSessionStageParticipantAssignment"("participantId", "stageId");
CREATE INDEX "TrainingStageParticipantAssignment_groupId_idx" ON "TrainingSessionStageParticipantAssignment"("groupId");

INSERT INTO "TrainingSessionStageParticipantAssignment" ("id", "stageId", "participantId", "groupId", "assignedAt", "source")
SELECT gen_random_uuid()::text, s.id, p.id, m."newGroupId", p."joinedAt", 'migration'
FROM "TrainingSessionParticipant" p
JOIN "TrainingSessionStage" s ON s."sessionId" = p."sessionId"
LEFT JOIN "_TrainingStageGroupMap" m ON m."stageId" = s.id AND m."oldGroupId" = p."groupId";

ALTER TABLE "TrainingSessionStageProblem" ADD COLUMN "timePolicy" JSONB, ADD COLUMN "stuckPolicy" JSONB;
UPDATE "TrainingSessionStageProblem" SET "timePolicy" = CASE
  WHEN "forceSwitchOnTimeout" = true THEN jsonb_build_object('mode', 'SWITCH_REQUIRED', 'limitSeconds', COALESCE("maxContinuousWorkSeconds", "timeLimitSeconds", 60))
  WHEN "timeLimitSeconds" IS NOT NULL THEN jsonb_build_object('mode', 'SOFT', 'limitSeconds', "timeLimitSeconds")
  WHEN "maxContinuousWorkSeconds" IS NOT NULL THEN jsonb_build_object('mode', 'SOFT', 'limitSeconds', "maxContinuousWorkSeconds")
  ELSE NULL
END;

CREATE TABLE "TrainingSessionStageProblemPlan" (
  "id" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "stageProblemId" TEXT NOT NULL,
  "groupId" TEXT,
  "orderIndex" INTEGER NOT NULL,
  "unlockPolicy" JSONB,
  "targetScore" INTEGER,
  "scoreGoals" JSONB,
  "timePolicy" JSONB,
  "stuckPolicy" JSONB,
  "hintPolicy" JSONB,
  "allowedSubtaskIds" JSONB,
  "judgeConfigProjection" TEXT,
  "strategyIntervalSeconds" INTEGER,
  "rules" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingSessionStageProblemPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingStageProblemPlan_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TrainingSessionStage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingStageProblemPlan_stageProblemId_fkey" FOREIGN KEY ("stageProblemId") REFERENCES "TrainingSessionStageProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingStageProblemPlan_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TrainingSessionStageGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrainingStageProblemPlan_all_unique" ON "TrainingSessionStageProblemPlan"("stageId", "stageProblemId") WHERE "groupId" IS NULL;
CREATE UNIQUE INDEX "TrainingStageProblemPlan_group_unique" ON "TrainingSessionStageProblemPlan"("stageId", "groupId", "stageProblemId") WHERE "groupId" IS NOT NULL;
CREATE INDEX "TrainingStageProblemPlan_stage_group_order_idx" ON "TrainingSessionStageProblemPlan"("stageId", "groupId", "orderIndex");
CREATE INDEX "TrainingStageProblemPlan_stageProblemId_idx" ON "TrainingSessionStageProblemPlan"("stageProblemId");

INSERT INTO "TrainingSessionStageProblemPlan" (
  "id", "stageId", "stageProblemId", "groupId", "orderIndex", "unlockPolicy", "targetScore", "scoreGoals",
  "timePolicy", "stuckPolicy", "hintPolicy", "allowedSubtaskIds", "judgeConfigProjection", "strategyIntervalSeconds"
)
SELECT gen_random_uuid()::text, p."stageId", p.id,
  CASE WHEN s."audienceMode" = 'GROUPED' THEN m."newGroupId" ELSE NULL END,
  p."orderIndex", p."unlockPolicy", p."targetScore", p."scoreGoals", p."timePolicy", p."stuckPolicy", p."hintPolicy", p."allowedSubtaskIds", p."judgeConfigProjection",
  p."strategyIntervalSeconds"
FROM "TrainingSessionStageProblem" p
JOIN "TrainingSessionStage" s ON s.id = p."stageId"
LEFT JOIN "_TrainingStageGroupMap" m ON m."stageId" = s.id
WHERE s."audienceMode" = 'ALL' OR m."newGroupId" IS NOT NULL;

ALTER TABLE "TrainingSessionStageProblem"
  DROP COLUMN "timeLimitSeconds",
  DROP COLUMN "maxContinuousWorkSeconds",
  DROP COLUMN "forceSwitchOnTimeout";

CREATE TABLE "TrainingSessionStageGroupChange" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "fromGroupId" TEXT,
  "toGroupId" TEXT NOT NULL,
  "effectiveMode" "TrainingEngineGroupChangeEffectiveMode" NOT NULL,
  "targetStageId" TEXT,
  "reason" TEXT NOT NULL,
  "changedBy" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveAt" TIMESTAMP(3),
  CONSTRAINT "TrainingSessionStageGroupChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingStageGroupChange_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TrainingSessionStage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingStageGroupChange_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TrainingSessionParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingStageGroupChange_fromGroupId_fkey" FOREIGN KEY ("fromGroupId") REFERENCES "TrainingSessionStageGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TrainingStageGroupChange_toGroupId_fkey" FOREIGN KEY ("toGroupId") REFERENCES "TrainingSessionStageGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TrainingStageGroupChange_session_stage_requested_idx" ON "TrainingSessionStageGroupChange"("sessionId", "stageId", "requestedAt");
CREATE INDEX "TrainingStageGroupChange_participant_requested_idx" ON "TrainingSessionStageGroupChange"("participantId", "requestedAt");

CREATE TABLE "TrainingSessionStageRuntimeSnapshot" (
  "id" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "definitionRevision" INTEGER NOT NULL,
  "projection" JSONB NOT NULL,
  "projectionHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingSessionStageRuntimeSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingStageRuntimeSnapshot_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TrainingSessionStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrainingStageRuntimeSnapshot_stageId_key" ON "TrainingSessionStageRuntimeSnapshot"("stageId");
CREATE INDEX "TrainingStageRuntimeSnapshot_projectionHash_idx" ON "TrainingSessionStageRuntimeSnapshot"("projectionHash");
CREATE OR REPLACE FUNCTION "training_stage_runtime_snapshot_immutable"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TrainingSessionStageRuntimeSnapshot is immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TrainingStageRuntimeSnapshot_immutable"
BEFORE UPDATE OR DELETE ON "TrainingSessionStageRuntimeSnapshot"
FOR EACH ROW EXECUTE FUNCTION "training_stage_runtime_snapshot_immutable"();

CREATE TABLE "TrainingSessionStageTimeAdjustment" (
  "id" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "seconds" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingSessionStageTimeAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingStageTimeAdjustment_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TrainingSessionStage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrainingStageTimeAdjustment_nonzero" CHECK ("seconds" <> 0)
);
CREATE INDEX "TrainingStageTimeAdjustment_stage_created_idx" ON "TrainingSessionStageTimeAdjustment"("stageId", "createdAt");

ALTER TABLE "Submission" ADD COLUMN "trainingScoreGoalIndex" INTEGER, ADD COLUMN "trainingScoreGoalSnapshot" JSONB;
ALTER TABLE "JudgeRun" ADD COLUMN "trainingScoreGoalIndex" INTEGER, ADD COLUMN "trainingScoreGoalSnapshot" JSONB;

ALTER TABLE "TrainingSessionTemplateStage"
  ADD COLUMN "kind" "TrainingEngineStageKind" NOT NULL DEFAULT 'TRAINING',
  ADD COLUMN "audienceMode" "TrainingEngineStageAudienceMode" NOT NULL DEFAULT 'ALL',
  ADD COLUMN "plannedDurationSeconds" INTEGER,
  ADD COLUMN "endPolicy" "TrainingEngineStageEndPolicy" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "accessPolicy" "TrainingEngineStageAccessPolicy" NOT NULL DEFAULT 'ALL_AT_ONCE',
  ADD COLUMN "submissionMode" "TrainingEngineSubmissionMode" NOT NULL DEFAULT 'ENABLED';
UPDATE "TrainingSessionTemplateStage" SET
  "kind" = CASE WHEN mode::text = 'TEACHING' THEN 'TEACHING'::"TrainingEngineStageKind" WHEN mode::text = 'REVIEW' THEN 'REVIEW'::"TrainingEngineStageKind" ELSE 'TRAINING'::"TrainingEngineStageKind" END,
  "plannedDurationSeconds" = "durationSeconds",
  "endPolicy" = "advanceMode"::text::"TrainingEngineStageEndPolicy",
  "accessPolicy" = CASE WHEN mode::text = 'SEQUENTIAL' THEN 'SEQUENTIAL'::"TrainingEngineStageAccessPolicy" WHEN mode::text = 'FOCUS' THEN 'TEACHER_CONTROLLED'::"TrainingEngineStageAccessPolicy" ELSE 'ALL_AT_ONCE'::"TrainingEngineStageAccessPolicy" END;
ALTER TABLE "TrainingSessionTemplateStage" DROP COLUMN "mode", DROP COLUMN "durationSeconds", DROP COLUMN "advanceMode";

ALTER TABLE "TrainingSessionParticipant" DROP CONSTRAINT IF EXISTS "TrainingSessionParticipant_groupId_fkey";
ALTER TABLE "TrainingSessionParticipant" DROP COLUMN "groupId";
DROP TABLE "TrainingSessionGroup";

DROP INDEX IF EXISTS "TrainingSessionStage_sessionId_status_idx";
CREATE INDEX "TrainingSessionStage_sessionId_lifecycle_idx" ON "TrainingSessionStage"("sessionId", "lifecycle");

ALTER TABLE "TrainingSessionStage"
  DROP COLUMN "mode",
  DROP COLUMN "durationSeconds",
  DROP COLUMN "advanceMode",
  DROP COLUMN "problemAccessMode",
  DROP COLUMN "targetScore",
  DROP COLUMN "status";
ALTER TABLE "TrainingSession" DROP COLUMN "defaultProblemAccessMode";

DROP TYPE "TrainingEngineStageMode";
DROP TYPE "TrainingEngineAdvanceMode";
DROP TYPE "TrainingEngineProblemAccessMode";
