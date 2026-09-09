BEGIN;

CREATE TYPE "QualityEvaluationJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "TestSetQualityStatus" AS ENUM ('NOT_READY', 'READY', 'CRITICAL', 'STALE');
CREATE TYPE "QualityConfidenceLevel" AS ENUM ('VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');
CREATE TYPE "QualityMaturityLevel" AS ENUM ('EXPERIMENTAL', 'VALIDATED', 'PROVEN', 'MATURE', 'BATTLE_TESTED');
CREATE TYPE "ProblemQualityAssessmentStatus" AS ENUM ('AUTOMATED_READY', 'EXPERT_REVIEWED', 'STALE');

CREATE TABLE "QualityEvaluationJob" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "corpusRevisionId" TEXT NOT NULL,
  "qualityRuleVersion" TEXT NOT NULL,
  "ruleConfig" JSONB NOT NULL,
  "inputSnapshot" JSONB NOT NULL,
  "inputHash" TEXT NOT NULL,
  "featureSchemaHash" TEXT NOT NULL,
  "solutionProfileSchemaHash" TEXT NOT NULL,
  "standardVersionId" TEXT,
  "validatorVersionId" TEXT,
  "classifierVersionId" TEXT,
  "checkerHash" TEXT NOT NULL,
  "judgeConfigHash" TEXT NOT NULL,
  "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
  "verificationReport" JSONB,
  "verificationJudgeId" TEXT,
  "verificationLeaseExpiresAt" TIMESTAMP(3),
  "verificationFencingToken" TEXT,
  "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
  "status" "QualityEvaluationJobStatus" NOT NULL DEFAULT 'QUEUED',
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "fencingToken" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdBy" TEXT NOT NULL,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QualityEvaluationJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QualityEvaluationJob_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "QualityEvaluationJob_verification_attempts_check" CHECK ("verificationAttempts" >= 0),
  CONSTRAINT "QualityEvaluationJob_verification_status_check" CHECK (
    ("verificationStatus" = 'pending' AND "verificationReport" IS NULL AND "verificationJudgeId" IS NULL AND "verificationFencingToken" IS NULL AND "verificationLeaseExpiresAt" IS NULL) OR
    ("verificationStatus" = 'running' AND "verificationReport" IS NULL AND "verificationJudgeId" IS NOT NULL AND "verificationFencingToken" IS NOT NULL AND "verificationLeaseExpiresAt" IS NOT NULL) OR
    ("verificationStatus" = 'complete' AND "verificationReport" IS NOT NULL AND "verificationJudgeId" IS NULL AND "verificationFencingToken" IS NULL AND "verificationLeaseExpiresAt" IS NULL)
  )
);

CREATE TABLE "ProblemSolutionProfile" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "expectedClass" TEXT NOT NULL,
  "expectedComplexity" TEXT,
  "expectedScoreMin" INTEGER NOT NULL,
  "expectedScoreMax" INTEGER NOT NULL,
  "expectedSubtaskScores" JSONB,
  "sourceType" TEXT NOT NULL DEFAULT 'submission',
  "submissionId" INTEGER NOT NULL,
  "definitionHash" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProblemSolutionProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProblemSolutionProfile_score_range_check" CHECK (
    "expectedScoreMin" BETWEEN 0 AND 100 AND
    "expectedScoreMax" BETWEEN 0 AND 100 AND
    "expectedScoreMin" <= "expectedScoreMax"
  ),
  CONSTRAINT "ProblemSolutionProfile_source_check" CHECK ("sourceType" = 'submission'),
  CONSTRAINT "ProblemSolutionProfile_status_check" CHECK ("status" IN ('active', 'retired')),
  CONSTRAINT "ProblemSolutionProfile_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "TestSetQualitySnapshot" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "corpusRevisionId" TEXT NOT NULL,
  "evaluationJobId" TEXT NOT NULL,
  "qualityRuleVersion" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "correctnessScore" INTEGER NOT NULL,
  "discriminationScore" INTEGER NOT NULL,
  "coverageScore" INTEGER NOT NULL,
  "diversityScore" INTEGER NOT NULL,
  "subtaskQualityScore" INTEGER NOT NULL,
  "stabilityScore" INTEGER NOT NULL,
  "overallScore" INTEGER,
  "confidenceScore" INTEGER NOT NULL,
  "confidenceLevel" "QualityConfidenceLevel" NOT NULL,
  "maturityLevel" "QualityMaturityLevel" NOT NULL,
  "wrongProgramCount" INTEGER NOT NULL DEFAULT 0,
  "behaviorClusterCount" INTEGER NOT NULL DEFAULT 0,
  "evaluationClusterCount" INTEGER NOT NULL DEFAULT 0,
  "holdoutClusterCount" INTEGER NOT NULL DEFAULT 0,
  "weightedKillCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "evaluationCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "holdoutCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "featureCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "criticalFeatureCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "realSubmissionCount" INTEGER NOT NULL DEFAULT 0,
  "validHackCount" INTEGER NOT NULL DEFAULT 0,
  "revisionAgeDays" INTEGER NOT NULL DEFAULT 0,
  "criticalIssueCount" INTEGER NOT NULL DEFAULT 0,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "qualityStatus" "TestSetQualityStatus" NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TestSetQualitySnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TestSetQualitySnapshot_scores_check" CHECK (
    "correctnessScore" BETWEEN 0 AND 30 AND
    "discriminationScore" BETWEEN 0 AND 25 AND
    "coverageScore" BETWEEN 0 AND 15 AND
    "diversityScore" BETWEEN 0 AND 10 AND
    "subtaskQualityScore" BETWEEN 0 AND 10 AND
    "stabilityScore" BETWEEN 0 AND 10 AND
    ("overallScore" IS NULL OR "overallScore" BETWEEN 0 AND 100) AND
    ("overallScore" IS NULL OR "overallScore" = "correctnessScore" + "discriminationScore" + "coverageScore" + "diversityScore" + "subtaskQualityScore" + "stabilityScore") AND
    "confidenceScore" BETWEEN 0 AND 100
  ),
  CONSTRAINT "TestSetQualitySnapshot_critical_gate_check" CHECK (
    ("qualityStatus" IN ('NOT_READY', 'CRITICAL') AND "overallScore" IS NULL) OR
    ("qualityStatus" = 'READY' AND "overallScore" IS NOT NULL) OR
    ("qualityStatus" = 'STALE')
  ),
  CONSTRAINT "TestSetQualitySnapshot_evidence_counts_check" CHECK (
    "wrongProgramCount" >= 0 AND "behaviorClusterCount" >= 0 AND
    "evaluationClusterCount" >= 0 AND "holdoutClusterCount" >= 0 AND
    "realSubmissionCount" >= 0 AND "validHackCount" >= 0 AND
    "revisionAgeDays" >= 0 AND "criticalIssueCount" >= 0 AND "warningCount" >= 0
  ),
  CONSTRAINT "TestSetQualitySnapshot_ratios_check" CHECK (
    "weightedKillCoverage" BETWEEN 0 AND 1 AND
    "evaluationCoverage" BETWEEN 0 AND 1 AND
    "holdoutCoverage" BETWEEN 0 AND 1 AND
    "featureCoverage" BETWEEN 0 AND 1 AND
    "criticalFeatureCoverage" BETWEEN 0 AND 1
  )
);

CREATE TABLE "ProblemQualityAssessment" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "ruleVersion" TEXT NOT NULL,
  "subjectVersionHash" TEXT NOT NULL,
  "status" "ProblemQualityAssessmentStatus" NOT NULL DEFAULT 'AUTOMATED_READY',
  "statementScore" INTEGER NOT NULL,
  "solutionCorrectnessScore" INTEGER NOT NULL,
  "algorithmicValueScore" INTEGER,
  "difficultyDesignScore" INTEGER NOT NULL,
  "constraintDesignScore" INTEGER NOT NULL,
  "subtaskDesignScore" INTEGER NOT NULL,
  "editorialScore" INTEGER,
  "originalityScore" INTEGER,
  "automatedScore" INTEGER NOT NULL,
  "expertScore" INTEGER,
  "overallScore" INTEGER,
  "confidenceScore" INTEGER NOT NULL,
  "confidenceLevel" "QualityConfidenceLevel" NOT NULL,
  "automatedEvidence" JSONB NOT NULL,
  "expertEvidence" JSONB,
  "createdBy" TEXT NOT NULL,
  "reviewedBy" TEXT,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProblemQualityAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProblemQualityAssessment_scores_check" CHECK (
    "statementScore" BETWEEN 0 AND 20 AND
    "solutionCorrectnessScore" BETWEEN 0 AND 20 AND
    ("algorithmicValueScore" IS NULL OR "algorithmicValueScore" BETWEEN 0 AND 20) AND
    "difficultyDesignScore" BETWEEN 0 AND 15 AND
    "constraintDesignScore" BETWEEN 0 AND 10 AND
    "subtaskDesignScore" BETWEEN 0 AND 5 AND
    ("editorialScore" IS NULL OR "editorialScore" BETWEEN 0 AND 5) AND
    ("originalityScore" IS NULL OR "originalityScore" BETWEEN 0 AND 5) AND
    "automatedScore" BETWEEN 0 AND 70 AND
    ("expertScore" IS NULL OR "expertScore" BETWEEN 0 AND 30) AND
    ("overallScore" IS NULL OR "overallScore" BETWEEN 0 AND 100) AND
    "confidenceScore" BETWEEN 0 AND 100
  ),
  CONSTRAINT "ProblemQualityAssessment_score_composition_check" CHECK (
    "automatedScore" = "statementScore" + "solutionCorrectnessScore" +
      "difficultyDesignScore" + "constraintDesignScore" + "subtaskDesignScore" AND
    (
      ("status" = 'AUTOMATED_READY' AND "algorithmicValueScore" IS NULL AND
        "editorialScore" IS NULL AND "originalityScore" IS NULL AND
        "expertScore" IS NULL AND "overallScore" IS NULL AND
        "reviewedBy" IS NULL AND "reviewedAt" IS NULL AND "expertEvidence" IS NULL)
      OR
      ("status" = 'EXPERT_REVIEWED' AND "algorithmicValueScore" IS NOT NULL AND
        "editorialScore" IS NOT NULL AND "originalityScore" IS NOT NULL AND
        "expertScore" = "algorithmicValueScore" + "editorialScore" + "originalityScore" AND
        "overallScore" = "automatedScore" + "expertScore" AND
        "reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "expertEvidence" IS NOT NULL)
      OR "status" = 'STALE'
    )
  )
);

CREATE UNIQUE INDEX "QualityEvaluationJob_inputHash_key" ON "QualityEvaluationJob"("inputHash");
CREATE UNIQUE INDEX "QualityEvaluationJob_fencingToken_key" ON "QualityEvaluationJob"("fencingToken");
CREATE UNIQUE INDEX "QualityEvaluationJob_verificationFencingToken_key" ON "QualityEvaluationJob"("verificationFencingToken");
CREATE INDEX "QualityEvaluationJob_status_queuedAt_idx" ON "QualityEvaluationJob"("status", "queuedAt");
CREATE INDEX "QualityEvaluationJob_verificationStatus_queuedAt_idx" ON "QualityEvaluationJob"("verificationStatus", "queuedAt");
CREATE INDEX "QualityEvaluationJob_verificationLeaseExpiresAt_idx" ON "QualityEvaluationJob"("verificationLeaseExpiresAt");
CREATE INDEX "QualityEvaluationJob_problemId_createdAt_idx" ON "QualityEvaluationJob"("problemId", "createdAt");
CREATE INDEX "QualityEvaluationJob_revisionId_qualityRuleVersion_idx" ON "QualityEvaluationJob"("revisionId", "qualityRuleVersion");
CREATE INDEX "QualityEvaluationJob_leaseExpiresAt_idx" ON "QualityEvaluationJob"("leaseExpiresAt");

CREATE UNIQUE INDEX "ProblemSolutionProfile_problemId_key_key" ON "ProblemSolutionProfile"("problemId", "key");
CREATE UNIQUE INDEX "ProblemSolutionProfile_problemId_submissionId_key" ON "ProblemSolutionProfile"("problemId", "submissionId");
CREATE INDEX "ProblemSolutionProfile_problemId_status_idx" ON "ProblemSolutionProfile"("problemId", "status");
CREATE INDEX "ProblemSolutionProfile_submissionId_idx" ON "ProblemSolutionProfile"("submissionId");
CREATE INDEX "ProblemSolutionProfile_createdBy_createdAt_idx" ON "ProblemSolutionProfile"("createdBy", "createdAt");

CREATE UNIQUE INDEX "TestSetQualitySnapshot_evaluationJobId_key" ON "TestSetQualitySnapshot"("evaluationJobId");
CREATE UNIQUE INDEX "TestSetQualitySnapshot_revisionId_qualityRuleVersion_corpusRevisionId_inputHash_key" ON "TestSetQualitySnapshot"("revisionId", "qualityRuleVersion", "corpusRevisionId", "inputHash");
CREATE INDEX "TestSetQualitySnapshot_problemId_createdAt_idx" ON "TestSetQualitySnapshot"("problemId", "createdAt");
CREATE INDEX "TestSetQualitySnapshot_qualityStatus_confidenceLevel_idx" ON "TestSetQualitySnapshot"("qualityStatus", "confidenceLevel");

CREATE UNIQUE INDEX "ProblemQualityAssessment_problemId_ruleVersion_subjectVersionHash_key" ON "ProblemQualityAssessment"("problemId", "ruleVersion", "subjectVersionHash");
CREATE INDEX "ProblemQualityAssessment_problemId_evaluatedAt_idx" ON "ProblemQualityAssessment"("problemId", "evaluatedAt");
CREATE INDEX "ProblemQualityAssessment_status_evaluatedAt_idx" ON "ProblemQualityAssessment"("status", "evaluatedAt");

ALTER TABLE "QualityEvaluationJob" ADD CONSTRAINT "QualityEvaluationJob_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityEvaluationJob" ADD CONSTRAINT "QualityEvaluationJob_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityEvaluationJob" ADD CONSTRAINT "QualityEvaluationJob_corpusRevisionId_fkey" FOREIGN KEY ("corpusRevisionId") REFERENCES "WrongCorpusRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityEvaluationJob" ADD CONSTRAINT "QualityEvaluationJob_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProblemSolutionProfile" ADD CONSTRAINT "ProblemSolutionProfile_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemSolutionProfile" ADD CONSTRAINT "ProblemSolutionProfile_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemSolutionProfile" ADD CONSTRAINT "ProblemSolutionProfile_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TestSetQualitySnapshot" ADD CONSTRAINT "TestSetQualitySnapshot_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestSetQualitySnapshot" ADD CONSTRAINT "TestSetQualitySnapshot_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestSetQualitySnapshot" ADD CONSTRAINT "TestSetQualitySnapshot_corpusRevisionId_fkey" FOREIGN KEY ("corpusRevisionId") REFERENCES "WrongCorpusRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestSetQualitySnapshot" ADD CONSTRAINT "TestSetQualitySnapshot_evaluationJobId_fkey" FOREIGN KEY ("evaluationJobId") REFERENCES "QualityEvaluationJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProblemQualityAssessment" ADD CONSTRAINT "ProblemQualityAssessment_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemQualityAssessment" ADD CONSTRAINT "ProblemQualityAssessment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemQualityAssessment" ADD CONSTRAINT "ProblemQualityAssessment_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A worker may update lease and terminal-state columns, but never the inputs
-- which define the evaluation it is performing.  The application-level
-- inputHash is useful for idempotency; this trigger is the database boundary
-- that makes the pinned-input contract hold even if a future code path uses a
-- broad update.
CREATE OR REPLACE FUNCTION prevent_quality_job_input_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD."verificationStatus" = 'complete' AND (
    NEW."verificationStatus" IS DISTINCT FROM OLD."verificationStatus"
    OR NEW."verificationReport" IS DISTINCT FROM OLD."verificationReport"
  ) THEN
    RAISE EXCEPTION 'QualityEvaluationJob verification evidence is immutable';
  END IF;
  IF NEW."problemId" IS DISTINCT FROM OLD."problemId"
    OR NEW."revisionId" IS DISTINCT FROM OLD."revisionId"
    OR NEW."corpusRevisionId" IS DISTINCT FROM OLD."corpusRevisionId"
    OR NEW."qualityRuleVersion" IS DISTINCT FROM OLD."qualityRuleVersion"
    OR NEW."ruleConfig" IS DISTINCT FROM OLD."ruleConfig"
    OR NEW."inputSnapshot" IS DISTINCT FROM OLD."inputSnapshot"
    OR NEW."inputHash" IS DISTINCT FROM OLD."inputHash"
    OR NEW."featureSchemaHash" IS DISTINCT FROM OLD."featureSchemaHash"
    OR NEW."solutionProfileSchemaHash" IS DISTINCT FROM OLD."solutionProfileSchemaHash"
    OR NEW."standardVersionId" IS DISTINCT FROM OLD."standardVersionId"
    OR NEW."validatorVersionId" IS DISTINCT FROM OLD."validatorVersionId"
    OR NEW."classifierVersionId" IS DISTINCT FROM OLD."classifierVersionId"
    OR NEW."checkerHash" IS DISTINCT FROM OLD."checkerHash"
    OR NEW."judgeConfigHash" IS DISTINCT FROM OLD."judgeConfigHash"
    OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."queuedAt" IS DISTINCT FROM OLD."queuedAt"
  THEN
    RAISE EXCEPTION 'QualityEvaluationJob pinned inputs are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "QualityEvaluationJob_immutable_inputs"
BEFORE UPDATE ON "QualityEvaluationJob"
FOR EACH ROW EXECUTE FUNCTION prevent_quality_job_input_mutation();

-- Expert review augments an automated PQS assessment.  It must never rewrite
-- the machine score or the evidence on which that score was based.
CREATE OR REPLACE FUNCTION prevent_problem_quality_automatic_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'EXPERT_REVIEWED' THEN
    RAISE EXCEPTION 'ProblemQualityAssessment expert conclusion is immutable';
  END IF;
  IF NEW."problemId" IS DISTINCT FROM OLD."problemId"
    OR NEW."ruleVersion" IS DISTINCT FROM OLD."ruleVersion"
    OR NEW."subjectVersionHash" IS DISTINCT FROM OLD."subjectVersionHash"
    OR NEW."statementScore" IS DISTINCT FROM OLD."statementScore"
    OR NEW."solutionCorrectnessScore" IS DISTINCT FROM OLD."solutionCorrectnessScore"
    OR NEW."difficultyDesignScore" IS DISTINCT FROM OLD."difficultyDesignScore"
    OR NEW."constraintDesignScore" IS DISTINCT FROM OLD."constraintDesignScore"
    OR NEW."subtaskDesignScore" IS DISTINCT FROM OLD."subtaskDesignScore"
    OR NEW."automatedScore" IS DISTINCT FROM OLD."automatedScore"
    OR NEW."confidenceScore" IS DISTINCT FROM OLD."confidenceScore"
    OR NEW."confidenceLevel" IS DISTINCT FROM OLD."confidenceLevel"
    OR NEW."automatedEvidence" IS DISTINCT FROM OLD."automatedEvidence"
    OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy"
    OR NEW."evaluatedAt" IS DISTINCT FROM OLD."evaluatedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'ProblemQualityAssessment automated evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProblemQualityAssessment_immutable_automatic_evidence"
BEFORE UPDATE ON "ProblemQualityAssessment"
FOR EACH ROW EXECUTE FUNCTION prevent_problem_quality_automatic_mutation();

-- A quality certificate is historical evidence. Corrections are represented by
-- another rule version or a later retrospective snapshot, never by mutation.
CREATE OR REPLACE FUNCTION prevent_quality_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TestSetQualitySnapshot is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TestSetQualitySnapshot_immutable_update"
BEFORE UPDATE ON "TestSetQualitySnapshot"
FOR EACH ROW EXECUTE FUNCTION prevent_quality_snapshot_mutation();

CREATE TRIGGER "TestSetQualitySnapshot_immutable_delete"
BEFORE DELETE ON "TestSetQualitySnapshot"
FOR EACH ROW EXECUTE FUNCTION prevent_quality_snapshot_mutation();

COMMIT;
