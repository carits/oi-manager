CREATE TYPE "AssignmentStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'OVERDUE', 'CLOSED', 'REVIEWING', 'RELEASED', 'ARCHIVED', 'CANCELLED');
CREATE TYPE "AssignmentRosterMode" AS ENUM ('SNAPSHOT', 'DYNAMIC');
CREATE TYPE "AssignmentProblemCategory" AS ENUM ('REQUIRED', 'OPTIONAL', 'CHALLENGE');
CREATE TYPE "AssignmentCompletionPolicy" AS ENUM ('AC', 'TARGET_SCORE', 'ATTEMPT', 'MANUAL');
CREATE TYPE "AssignmentRecipientStatus" AS ENUM ('ASSIGNED', 'ACTIVE', 'COMPLETED', 'EXEMPT', 'REMOVED');
CREATE TYPE "AssignmentLearningStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'TARGET_MET', 'COMPLETED', 'EXEMPT');
CREATE TYPE "AssignmentTimelinessStatus" AS ENUM ('ON_TIME', 'LATE');
CREATE TYPE "AssignmentCorrectionStatus" AS ENUM ('NONE', 'NEEDS_CORRECTION', 'CORRECTING', 'CORRECTED', 'WAIVED', 'EXPIRED');
CREATE TYPE "AssignmentGradingPolicy" AS ENUM ('BEST_BEFORE_DUE', 'BEST', 'LATEST', 'FIRST_TARGET_MET', 'MANUAL');
CREATE TYPE "AssignmentLatePolicy" AS ENUM ('DISALLOW', 'ALLOW_MARK_LATE', 'ALLOW_NO_PENALTY', 'ALLOW_WITH_PENALTY');
CREATE TYPE "AssignmentCorrectionPolicy" AS ENUM ('NONE', 'BELOW_TARGET', 'NON_AC', 'TEACHER_ASSIGNED', 'ALL_INCOMPLETE');
CREATE TYPE "AssignmentSolutionReleasePolicy" AS ENUM ('NEVER', 'AFTER_DUE', 'AFTER_CLOSE', 'AFTER_RELEASE');
CREATE TYPE "AssignmentGradeSnapshotType" AS ENUM ('DUE', 'CLOSE', 'POST_CORRECTION', 'FINAL_RELEASE', 'REGRADE');

CREATE TABLE "Assignment" (
  "id" TEXT NOT NULL,
  "legacyTrainingId" INTEGER,
  "organizationId" TEXT NOT NULL,
  "teamId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "learningObjectives" TEXT,
  "status" "AssignmentStatus" NOT NULL DEFAULT 'DRAFT',
  "rosterMode" "AssignmentRosterMode" NOT NULL DEFAULT 'SNAPSHOT',
  "gradingPolicy" "AssignmentGradingPolicy" NOT NULL DEFAULT 'BEST_BEFORE_DUE',
  "latePolicy" "AssignmentLatePolicy" NOT NULL DEFAULT 'DISALLOW',
  "correctionPolicy" "AssignmentCorrectionPolicy" NOT NULL DEFAULT 'NONE',
  "solutionReleasePolicy" "AssignmentSolutionReleasePolicy" NOT NULL DEFAULT 'AFTER_RELEASE',
  "latePenaltyPercent" INTEGER,
  "publishAt" TIMESTAMP(3),
  "openAt" TIMESTAMP(3) NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "closeAt" TIMESTAMP(3) NOT NULL,
  "correctionDueAt" TIMESTAMP(3),
  "createdByMembershipId" TEXT NOT NULL,
  "statusRevision" INTEGER NOT NULL DEFAULT 0,
  "eventSeq" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Assignment_timeline_check" CHECK ("openAt" < "dueAt" AND "dueAt" <= "closeAt" AND ("publishAt" IS NULL OR "publishAt" <= "openAt") AND ("correctionDueAt" IS NULL OR "correctionDueAt" >= "closeAt")),
  CONSTRAINT "Assignment_late_penalty_check" CHECK (("latePolicy" = 'ALLOW_WITH_PENALTY' AND "latePenaltyPercent" BETWEEN 0 AND 100) OR ("latePolicy" <> 'ALLOW_WITH_PENALTY' AND "latePenaltyPercent" IS NULL))
);

CREATE TABLE "AssignmentProblem" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "testSetRevisionId" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "category" "AssignmentProblemCategory" NOT NULL DEFAULT 'REQUIRED',
  "required" BOOLEAN NOT NULL DEFAULT true,
  "maxScore" INTEGER NOT NULL DEFAULT 100,
  "targetScore" INTEGER NOT NULL DEFAULT 100,
  "weight" INTEGER NOT NULL DEFAULT 100,
  "completionPolicy" "AssignmentCompletionPolicy" NOT NULL DEFAULT 'TARGET_SCORE',
  "judgeConfigSnapshot" TEXT NOT NULL,
  "judgeConfigHash" TEXT NOT NULL,
  "settings" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssignmentProblem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssignmentProblem_score_check" CHECK ("maxScore" > 0 AND "targetScore" >= 0 AND "targetScore" <= "maxScore" AND "weight" > 0),
  CONSTRAINT "AssignmentProblem_order_check" CHECK ("orderIndex" >= 0)
);

CREATE TABLE "AssignmentRecipient" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'snapshot',
  "status" "AssignmentRecipientStatus" NOT NULL DEFAULT 'ASSIGNED',
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "dueAtEffective" TIMESTAMP(3) NOT NULL,
  "closeAtEffective" TIMESTAMP(3) NOT NULL,
  "exemptReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssignmentRecipient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssignmentRecipient_timeline_check" CHECK ("dueAtEffective" <= "closeAtEffective")
);

CREATE TABLE "AssignmentRecipientOverride" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3),
  "closeAt" TIMESTAMP(3),
  "latePolicy" "AssignmentLatePolicy",
  "correctionPolicy" "AssignmentCorrectionPolicy",
  "reason" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "AssignmentRecipientOverride_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssignmentRecipientOverride_timeline_check" CHECK ("dueAt" IS NULL OR "closeAt" IS NULL OR "dueAt" <= "closeAt")
);

CREATE TABLE "AssignmentProblemProgress" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "assignmentProblemId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "learningStatus" "AssignmentLearningStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "timelinessStatus" "AssignmentTimelinessStatus" NOT NULL DEFAULT 'ON_TIME',
  "correctionStatus" "AssignmentCorrectionStatus" NOT NULL DEFAULT 'NONE',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "originalAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "correctionAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "bestScore" INTEGER,
  "bestVerdict" TEXT,
  "originalScore" INTEGER,
  "correctionScore" INTEGER,
  "finalScore" INTEGER,
  "firstSubmissionId" INTEGER,
  "bestSubmissionId" INTEGER,
  "latestSubmissionId" INTEGER,
  "targetMetAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "firstSubmittedAt" TIMESTAMP(3),
  "lastSubmittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssignmentProblemProgress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssignmentProblemProgress_attempts_check" CHECK ("attemptCount" >= 0 AND "originalAttemptCount" >= 0 AND "correctionAttemptCount" >= 0)
);

CREATE TABLE "AssignmentCorrection" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "assignmentProblemId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "status" "AssignmentCorrectionStatus" NOT NULL DEFAULT 'NEEDS_CORRECTION',
  "assignedBy" TEXT NOT NULL,
  "reason" TEXT,
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "waivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssignmentCorrection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssignmentFeedback" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "assignmentProblemId" TEXT,
  "recipientId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'recipient',
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssignmentFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssignmentScoreAdjustment" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "assignmentProblemId" TEXT,
  "recipientId" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "reversedAdjustmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignmentScoreAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssignmentGradeSnapshot" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "type" "AssignmentGradeSnapshotType" NOT NULL,
  "revision" INTEGER NOT NULL,
  "totalScore" INTEGER NOT NULL,
  "maxScore" INTEGER NOT NULL,
  "gradeData" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignmentGradeSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssignmentEvent" (
  "id" BIGSERIAL NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "actorUserId" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssignmentEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Submission"
  ADD COLUMN "assignmentId" TEXT,
  ADD COLUMN "assignmentProblemId" TEXT,
  ADD COLUMN "assignmentRecipientId" TEXT,
  ADD COLUMN "submissionPhase" TEXT;

CREATE UNIQUE INDEX "Assignment_legacyTrainingId_key" ON "Assignment"("legacyTrainingId");
CREATE INDEX "Assignment_organizationId_status_openAt_idx" ON "Assignment"("organizationId", "status", "openAt");
CREATE INDEX "Assignment_teamId_status_openAt_idx" ON "Assignment"("teamId", "status", "openAt");
CREATE INDEX "Assignment_createdByMembershipId_createdAt_idx" ON "Assignment"("createdByMembershipId", "createdAt");
CREATE INDEX "Assignment_status_publishAt_idx" ON "Assignment"("status", "publishAt");
CREATE INDEX "Assignment_status_dueAt_idx" ON "Assignment"("status", "dueAt");
CREATE INDEX "Assignment_status_closeAt_idx" ON "Assignment"("status", "closeAt");
CREATE UNIQUE INDEX "AssignmentProblem_assignmentId_problemId_key" ON "AssignmentProblem"("assignmentId", "problemId");
CREATE UNIQUE INDEX "AssignmentProblem_assignmentId_orderIndex_key" ON "AssignmentProblem"("assignmentId", "orderIndex");
CREATE INDEX "AssignmentProblem_problemId_idx" ON "AssignmentProblem"("problemId");
CREATE INDEX "AssignmentProblem_testSetRevisionId_idx" ON "AssignmentProblem"("testSetRevisionId");
CREATE UNIQUE INDEX "AssignmentRecipient_assignmentId_userId_key" ON "AssignmentRecipient"("assignmentId", "userId");
CREATE INDEX "AssignmentRecipient_assignmentId_status_idx" ON "AssignmentRecipient"("assignmentId", "status");
CREATE INDEX "AssignmentRecipient_userId_status_dueAtEffective_idx" ON "AssignmentRecipient"("userId", "status", "dueAtEffective");
CREATE INDEX "AssignmentRecipient_membershipId_idx" ON "AssignmentRecipient"("membershipId");
CREATE INDEX "AssignmentRecipientOverride_recipientId_createdAt_idx" ON "AssignmentRecipientOverride"("recipientId", "createdAt");
CREATE INDEX "AssignmentRecipientOverride_assignmentId_createdAt_idx" ON "AssignmentRecipientOverride"("assignmentId", "createdAt");
CREATE UNIQUE INDEX "AssignmentProblemProgress_assignmentProblemId_recipientId_key" ON "AssignmentProblemProgress"("assignmentProblemId", "recipientId");
CREATE INDEX "AssignmentProblemProgress_assignmentId_learningStatus_idx" ON "AssignmentProblemProgress"("assignmentId", "learningStatus");
CREATE INDEX "AssignmentProblemProgress_recipientId_updatedAt_idx" ON "AssignmentProblemProgress"("recipientId", "updatedAt");
CREATE INDEX "AssignmentCorrection_assignmentId_status_dueAt_idx" ON "AssignmentCorrection"("assignmentId", "status", "dueAt");
CREATE INDEX "AssignmentCorrection_recipientId_status_idx" ON "AssignmentCorrection"("recipientId", "status");
CREATE INDEX "AssignmentFeedback_assignmentId_recipientId_createdAt_idx" ON "AssignmentFeedback"("assignmentId", "recipientId", "createdAt");
CREATE INDEX "AssignmentScoreAdjustment_assignment_recipient_created_idx" ON "AssignmentScoreAdjustment"("assignmentId", "recipientId", "createdAt");
CREATE INDEX "AssignmentScoreAdjustment_reversedAdjustmentId_idx" ON "AssignmentScoreAdjustment"("reversedAdjustmentId");
CREATE UNIQUE INDEX "AssignmentGradeSnapshot_assignment_recipient_type_rev_key" ON "AssignmentGradeSnapshot"("assignmentId", "recipientId", "type", "revision");
CREATE INDEX "AssignmentGradeSnapshot_assignmentId_type_createdAt_idx" ON "AssignmentGradeSnapshot"("assignmentId", "type", "createdAt");
CREATE UNIQUE INDEX "AssignmentEvent_assignmentId_seq_key" ON "AssignmentEvent"("assignmentId", "seq");
CREATE INDEX "AssignmentEvent_assignmentId_createdAt_idx" ON "AssignmentEvent"("assignmentId", "createdAt");
CREATE INDEX "Submission_assignmentId_createdAt_idx" ON "Submission"("assignmentId", "createdAt");
CREATE INDEX "Submission_assignmentProblemId_createdAt_idx" ON "Submission"("assignmentProblemId", "createdAt");
CREATE INDEX "Submission_assignmentRecipientId_createdAt_idx" ON "Submission"("assignmentRecipientId", "createdAt");

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_legacyTrainingId_fkey" FOREIGN KEY ("legacyTrainingId") REFERENCES "Training"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssignmentProblem" ADD CONSTRAINT "AssignmentProblem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentProblem" ADD CONSTRAINT "AssignmentProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssignmentProblem" ADD CONSTRAINT "AssignmentProblem_testSetRevisionId_fkey" FOREIGN KEY ("testSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssignmentRecipient" ADD CONSTRAINT "AssignmentRecipient_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentRecipient" ADD CONSTRAINT "AssignmentRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssignmentRecipient" ADD CONSTRAINT "AssignmentRecipient_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssignmentRecipientOverride" ADD CONSTRAINT "AssignmentRecipientOverride_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentRecipientOverride" ADD CONSTRAINT "AssignmentRecipientOverride_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "AssignmentRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentProblemProgress" ADD CONSTRAINT "AssignmentProblemProgress_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentProblemProgress" ADD CONSTRAINT "AssignmentProblemProgress_assignmentProblemId_fkey" FOREIGN KEY ("assignmentProblemId") REFERENCES "AssignmentProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentProblemProgress" ADD CONSTRAINT "AssignmentProblemProgress_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "AssignmentRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentCorrection" ADD CONSTRAINT "AssignmentCorrection_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentCorrection" ADD CONSTRAINT "AssignmentCorrection_assignmentProblemId_fkey" FOREIGN KEY ("assignmentProblemId") REFERENCES "AssignmentProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentCorrection" ADD CONSTRAINT "AssignmentCorrection_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "AssignmentRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentFeedback" ADD CONSTRAINT "AssignmentFeedback_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentFeedback" ADD CONSTRAINT "AssignmentFeedback_assignmentProblemId_fkey" FOREIGN KEY ("assignmentProblemId") REFERENCES "AssignmentProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentFeedback" ADD CONSTRAINT "AssignmentFeedback_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "AssignmentRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentScoreAdjustment" ADD CONSTRAINT "AssignmentScoreAdjustment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentScoreAdjustment" ADD CONSTRAINT "AssignmentScoreAdjustment_assignmentProblemId_fkey" FOREIGN KEY ("assignmentProblemId") REFERENCES "AssignmentProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentScoreAdjustment" ADD CONSTRAINT "AssignmentScoreAdjustment_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "AssignmentRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentScoreAdjustment" ADD CONSTRAINT "AssignmentScoreAdjustment_reversedAdjustmentId_fkey" FOREIGN KEY ("reversedAdjustmentId") REFERENCES "AssignmentScoreAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssignmentGradeSnapshot" ADD CONSTRAINT "AssignmentGradeSnapshot_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentGradeSnapshot" ADD CONSTRAINT "AssignmentGradeSnapshot_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "AssignmentRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentEvent" ADD CONSTRAINT "AssignmentEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentProblemId_fkey" FOREIGN KEY ("assignmentProblemId") REFERENCES "AssignmentProblem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentRecipientId_fkey" FOREIGN KEY ("assignmentRecipientId") REFERENCES "AssignmentRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignment_scope_check" CHECK (
  ("assignmentId" IS NULL AND "assignmentProblemId" IS NULL AND "assignmentRecipientId" IS NULL AND "submissionPhase" IS NULL)
  OR
  ("assignmentId" IS NOT NULL AND "assignmentProblemId" IS NOT NULL AND "assignmentRecipientId" IS NOT NULL AND "submissionPhase" IN ('ORIGINAL', 'LATE', 'CORRECTION'))
);

ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignment_scope_requires_context" CHECK (
  "submitScope" <> 'assignment' OR "assignmentId" IS NOT NULL
);
