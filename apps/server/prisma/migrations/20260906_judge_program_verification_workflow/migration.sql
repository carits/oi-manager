ALTER TABLE "ProblemJudgeProgramVersion"
  ADD COLUMN "protocolConfig" JSONB,
  ADD COLUMN "fixtureSetId" TEXT;

ALTER TABLE "TestcaseCandidate"
  ADD COLUMN "provenance" JSONB;

ALTER TABLE "ValidatorSpec"
  ADD COLUMN "programVersionId" TEXT;
CREATE INDEX "ValidatorSpec_programVersionId_idx" ON "ValidatorSpec"("programVersionId");

CREATE TABLE "ProblemJudgeProgramDraft" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "programId" TEXT,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "protocol" TEXT NOT NULL,
  "templateId" TEXT,
  "templateVersion" INTEGER,
  "source" TEXT NOT NULL,
  "protocolConfig" JSONB,
  "fixtures" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProblemJudgeProgramDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProblemJudgeProgramDraft_kind_check" CHECK ("kind" IN ('standard','validator','classifier','generator')),
  CONSTRAINT "ProblemJudgeProgramDraft_revision_check" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "ProblemJudgeProgramDraft_problemId_userId_kind_key"
  ON "ProblemJudgeProgramDraft"("problemId", "userId", "kind");
CREATE INDEX "ProblemJudgeProgramDraft_programId_idx" ON "ProblemJudgeProgramDraft"("programId");
CREATE INDEX "ProblemJudgeProgramDraft_userId_updatedAt_idx" ON "ProblemJudgeProgramDraft"("userId", "updatedAt");

CREATE TABLE "ProblemJudgeProgramFixtureSet" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "fixtures" JSONB NOT NULL,
  "fixtureHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProblemJudgeProgramFixtureSet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProblemJudgeProgramFixtureSet_revision_check" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "ProblemJudgeProgramFixtureSet_programId_revision_key"
  ON "ProblemJudgeProgramFixtureSet"("programId", "revision");
CREATE INDEX "ProblemJudgeProgramFixtureSet_problemId_createdAt_idx"
  ON "ProblemJudgeProgramFixtureSet"("problemId", "createdAt");
CREATE INDEX "ProblemJudgeProgramFixtureSet_fixtureHash_idx"
  ON "ProblemJudgeProgramFixtureSet"("fixtureHash");

CREATE TABLE "ProblemJudgeProgramVerificationJob" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "fixtureSetId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "judgeId" TEXT,
  "fencingToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "report" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdBy" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProblemJudgeProgramVerificationJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProblemJudgeProgramVerificationJob_mode_check" CHECK ("mode" IN ('compile','preflight')),
  CONSTRAINT "ProblemJudgeProgramVerificationJob_status_check" CHECK ("status" IN ('queued','running','completed','failed','cancelled')),
  CONSTRAINT "ProblemJudgeProgramVerificationJob_attempt_check" CHECK ("attemptCount" BETWEEN 0 AND 10)
);

CREATE UNIQUE INDEX "ProblemJudgeProgramVerificationJob_fencingToken_key"
  ON "ProblemJudgeProgramVerificationJob"("fencingToken");
CREATE INDEX "ProblemJudgeProgramVerificationJob_status_createdAt_idx"
  ON "ProblemJudgeProgramVerificationJob"("status", "createdAt");
CREATE INDEX "ProblemJudgeProgramVerificationJob_problemId_createdAt_idx"
  ON "ProblemJudgeProgramVerificationJob"("problemId", "createdAt");
CREATE INDEX "ProblemJudgeProgramVerificationJob_programId_versionId_idx"
  ON "ProblemJudgeProgramVerificationJob"("programId", "versionId");
CREATE INDEX "ProblemJudgeProgramVerificationJob_judgeId_status_idx"
  ON "ProblemJudgeProgramVerificationJob"("judgeId", "status");

CREATE TABLE "ProblemJudgeProgramAuditLog" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "versionId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProblemJudgeProgramAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProblemJudgeProgramAuditLog_problemId_createdAt_idx"
  ON "ProblemJudgeProgramAuditLog"("problemId", "createdAt");
CREATE INDEX "ProblemJudgeProgramAuditLog_programId_createdAt_idx"
  ON "ProblemJudgeProgramAuditLog"("programId", "createdAt");
CREATE INDEX "ProblemJudgeProgramAuditLog_versionId_idx"
  ON "ProblemJudgeProgramAuditLog"("versionId");
CREATE INDEX "ProblemJudgeProgramAuditLog_actorUserId_createdAt_idx"
  ON "ProblemJudgeProgramAuditLog"("actorUserId", "createdAt");

CREATE INDEX "ProblemJudgeProgramVersion_fixtureSetId_idx"
  ON "ProblemJudgeProgramVersion"("fixtureSetId");

ALTER TABLE "ProblemJudgeProgramDraft"
  ADD CONSTRAINT "ProblemJudgeProgramDraft_problemId_fkey"
  FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemJudgeProgramDraft"
  ADD CONSTRAINT "ProblemJudgeProgramDraft_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "ProblemJudgeProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProblemJudgeProgramFixtureSet"
  ADD CONSTRAINT "ProblemJudgeProgramFixtureSet_problemId_fkey"
  FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemJudgeProgramFixtureSet"
  ADD CONSTRAINT "ProblemJudgeProgramFixtureSet_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "ProblemJudgeProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProblemJudgeProgramVersion"
  ADD CONSTRAINT "ProblemJudgeProgramVersion_fixtureSetId_fkey"
  FOREIGN KEY ("fixtureSetId") REFERENCES "ProblemJudgeProgramFixtureSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProblemJudgeProgramVerificationJob"
  ADD CONSTRAINT "ProblemJudgeProgramVerificationJob_problemId_fkey"
  FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemJudgeProgramVerificationJob"
  ADD CONSTRAINT "ProblemJudgeProgramVerificationJob_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "ProblemJudgeProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemJudgeProgramVerificationJob"
  ADD CONSTRAINT "ProblemJudgeProgramVerificationJob_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "ProblemJudgeProgramVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemJudgeProgramVerificationJob"
  ADD CONSTRAINT "ProblemJudgeProgramVerificationJob_fixtureSetId_fkey"
  FOREIGN KEY ("fixtureSetId") REFERENCES "ProblemJudgeProgramFixtureSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProblemJudgeProgramAuditLog"
  ADD CONSTRAINT "ProblemJudgeProgramAuditLog_problemId_fkey"
  FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemJudgeProgramAuditLog"
  ADD CONSTRAINT "ProblemJudgeProgramAuditLog_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "ProblemJudgeProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProblemJudgeProgramAuditLog"
  ADD CONSTRAINT "ProblemJudgeProgramAuditLog_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "ProblemJudgeProgramVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
