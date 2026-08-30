-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TestcaseCandidateStatus" ADD VALUE 'UPLOADED';
ALTER TYPE "TestcaseCandidateStatus" ADD VALUE 'ADMITTED';
ALTER TYPE "TestcaseCandidateStatus" ADD VALUE 'VALIDATING';
ALTER TYPE "TestcaseCandidateStatus" ADD VALUE 'EVALUATING_L1';
ALTER TYPE "TestcaseCandidateStatus" ADD VALUE 'EVALUATING_L2';
ALTER TYPE "TestcaseCandidateStatus" ADD VALUE 'EVALUATING_HOLDOUT';
ALTER TYPE "TestcaseCandidateStatus" ADD VALUE 'ELIGIBLE';
ALTER TYPE "TestcaseCandidateStatus" ADD VALUE 'SELECTED';
ALTER TYPE "TestcaseCandidateStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "ProblemDataGenerationCase" ADD COLUMN     "candidateId" TEXT;

-- AlterTable
ALTER TABLE "ProblemDataGenerationJob" ADD COLUMN     "contribution" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reservedCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "targetRole" TEXT NOT NULL DEFAULT 'official';

-- AlterTable
ALTER TABLE "TestcaseCandidate" ADD COLUMN     "classifierVersionId" TEXT,
ADD COLUMN     "corpusRevisionId" TEXT,
ADD COLUMN     "currentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "evaluationStage" TEXT NOT NULL DEFAULT 'admission',
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "featureFingerprint" TEXT,
ADD COLUMN     "generatorVersionId" TEXT,
ADD COLUMN     "isProtected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "killVectorObjectId" TEXT,
ADD COLUMN     "marginalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "runtimeCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "selectedAt" TIMESTAMP(3),
ADD COLUMN     "semanticFingerprint" TEXT,
ADD COLUMN     "standardVersionId" TEXT,
ADD COLUMN     "targetRole" TEXT NOT NULL DEFAULT 'hack_gate',
ADD COLUMN     "validatorVersionId" TEXT;

-- CreateTable
CREATE TABLE "WrongSolutionSample" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "submissionId" INTEGER,
    "language" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "sourceObjectId" TEXT,
    "result" TEXT,
    "score" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "behaviorHash" TEXT,
    "clusterId" TEXT,
    "categoryId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WrongSolutionSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WrongBehaviorCluster" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "corpusRevisionId" TEXT,
    "representativeSampleId" TEXT NOT NULL,
    "behaviorHash" TEXT NOT NULL,
    "categoryId" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "partition" TEXT NOT NULL DEFAULT 'evaluation',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WrongBehaviorCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WrongCorpusRevision" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'building',
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "clusterCount" INTEGER NOT NULL DEFAULT 0,
    "evaluationCount" INTEGER NOT NULL DEFAULT 0,
    "holdoutCount" INTEGER NOT NULL DEFAULT 0,
    "corpusHash" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "WrongCorpusRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BugCategory" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BugCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateEvaluationRun" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "corpusRevisionId" TEXT,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "executionCount" INTEGER NOT NULL DEFAULT 0,
    "cpuMilliseconds" INTEGER NOT NULL DEFAULT 0,
    "generatedBytes" BIGINT NOT NULL DEFAULT 0,
    "newClusterWeight" INTEGER NOT NULL DEFAULT 0,
    "newCategoryCount" INTEGER NOT NULL DEFAULT 0,
    "newFeatureCount" INTEGER NOT NULL DEFAULT 0,
    "similarity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateEvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalSelectionRun" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "baseTestSetRevisionId" TEXT NOT NULL,
    "corpusRevisionId" TEXT,
    "policyRevision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "mode" TEXT NOT NULL DEFAULT 'observe',
    "baselineQuality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "candidateQuality" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qualityDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holdoutRegressed" BOOLEAN NOT NULL DEFAULT false,
    "selectedCandidateIds" JSONB,
    "promotedRevisionId" TEXT,
    "publishReason" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CanonicalSelectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemCandidatePolicy" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "selectorMode" TEXT NOT NULL DEFAULT 'observe',
    "maxHotCandidates" INTEGER NOT NULL DEFAULT 2000,
    "maxHotBytes" BIGINT NOT NULL DEFAULT 1073741824,
    "topK" INTEGER NOT NULL DEFAULT 500,
    "maxCanonicalCases" INTEGER NOT NULL DEFAULT 100,
    "maxOiCanonicalCases" INTEGER NOT NULL DEFAULT 300,
    "qualityThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "maxAutoPublishesPerHour" INTEGER NOT NULL DEFAULT 3,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemCandidatePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationCreditAccount" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "limitCredits" INTEGER NOT NULL,
    "availableCredits" INTEGER NOT NULL,
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "consumedCredits" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationCreditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationCreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationCreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidatorSpec" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "spec" JSONB NOT NULL,
    "specHash" TEXT NOT NULL,
    "generatedSource" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "compileStatus" TEXT NOT NULL,
    "compileMessage" TEXT,
    "verification" JSONB,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "aiRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "ValidatorSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemFeatureDefinition" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemFeatureDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemSubtaskRule" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "subtaskId" INTEGER NOT NULL,
    "rule" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemSubtaskRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlobObject" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageTier" TEXT NOT NULL DEFAULT 'hot',
    "contentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleteAfter" TIMESTAMP(3),

    CONSTRAINT "BlobObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlobReference" (
    "id" TEXT NOT NULL,
    "blobId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlobReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WrongSolutionSample_problemId_status_createdAt_idx" ON "WrongSolutionSample"("problemId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WrongSolutionSample_clusterId_idx" ON "WrongSolutionSample"("clusterId");

-- CreateIndex
CREATE INDEX "WrongSolutionSample_submissionId_idx" ON "WrongSolutionSample"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "WrongSolutionSample_problemId_sourceSha256_key" ON "WrongSolutionSample"("problemId", "sourceSha256");

-- CreateIndex
CREATE INDEX "WrongBehaviorCluster_problemId_status_partition_idx" ON "WrongBehaviorCluster"("problemId", "status", "partition");

-- CreateIndex
CREATE INDEX "WrongBehaviorCluster_corpusRevisionId_idx" ON "WrongBehaviorCluster"("corpusRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "WrongBehaviorCluster_problemId_behaviorHash_key" ON "WrongBehaviorCluster"("problemId", "behaviorHash");

-- CreateIndex
CREATE INDEX "WrongCorpusRevision_problemId_status_createdAt_idx" ON "WrongCorpusRevision"("problemId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WrongCorpusRevision_problemId_revisionNumber_key" ON "WrongCorpusRevision"("problemId", "revisionNumber");

-- CreateIndex
CREATE INDEX "BugCategory_problemId_idx" ON "BugCategory"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "BugCategory_problemId_key_key" ON "BugCategory"("problemId", "key");

-- CreateIndex
CREATE INDEX "CandidateEvaluationRun_candidateId_stage_idx" ON "CandidateEvaluationRun"("candidateId", "stage");

-- CreateIndex
CREATE INDEX "CandidateEvaluationRun_problemId_status_createdAt_idx" ON "CandidateEvaluationRun"("problemId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CanonicalSelectionRun_problemId_status_createdAt_idx" ON "CanonicalSelectionRun"("problemId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CanonicalSelectionRun_promotedRevisionId_idx" ON "CanonicalSelectionRun"("promotedRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemCandidatePolicy_problemId_key" ON "ProblemCandidatePolicy"("problemId");

-- CreateIndex
CREATE INDEX "EvaluationCreditAccount_periodStart_idx" ON "EvaluationCreditAccount"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationCreditAccount_subjectType_subjectId_periodStart_key" ON "EvaluationCreditAccount"("subjectType", "subjectId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationCreditLedgerEntry_idempotencyKey_key" ON "EvaluationCreditLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EvaluationCreditLedgerEntry_accountId_createdAt_idx" ON "EvaluationCreditLedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "EvaluationCreditLedgerEntry_taskType_taskId_idx" ON "EvaluationCreditLedgerEntry"("taskType", "taskId");

-- CreateIndex
CREATE INDEX "ValidatorSpec_problemId_status_idx" ON "ValidatorSpec"("problemId", "status");

-- CreateIndex
CREATE INDEX "ValidatorSpec_aiRequestId_idx" ON "ValidatorSpec"("aiRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ValidatorSpec_problemId_versionNumber_key" ON "ValidatorSpec"("problemId", "versionNumber");

-- CreateIndex
CREATE INDEX "ProblemFeatureDefinition_problemId_orderIndex_idx" ON "ProblemFeatureDefinition"("problemId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemFeatureDefinition_problemId_key_key" ON "ProblemFeatureDefinition"("problemId", "key");

-- CreateIndex
CREATE INDEX "ProblemSubtaskRule_problemId_idx" ON "ProblemSubtaskRule"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemSubtaskRule_problemId_subtaskId_key" ON "ProblemSubtaskRule"("problemId", "subtaskId");

-- CreateIndex
CREATE UNIQUE INDEX "BlobObject_sha256_key" ON "BlobObject"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "BlobObject_storageKey_key" ON "BlobObject"("storageKey");

-- CreateIndex
CREATE INDEX "BlobObject_storageTier_deleteAfter_idx" ON "BlobObject"("storageTier", "deleteAfter");

-- CreateIndex
CREATE INDEX "BlobReference_blobId_idx" ON "BlobReference"("blobId");

-- CreateIndex
CREATE INDEX "BlobReference_ownerType_ownerId_idx" ON "BlobReference"("ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "BlobReference_ownerType_ownerId_role_key" ON "BlobReference"("ownerType", "ownerId", "role");

-- CreateIndex
CREATE INDEX "ProblemDataGenerationCase_candidateId_idx" ON "ProblemDataGenerationCase"("candidateId");

-- CreateIndex
CREATE INDEX "TestcaseCandidate_problemId_targetRole_status_marginalValue_idx" ON "TestcaseCandidate"("problemId", "targetRole", "status", "marginalValue");

-- CreateIndex
CREATE INDEX "TestcaseCandidate_createdBy_createdAt_idx" ON "TestcaseCandidate"("createdBy", "createdAt");

-- CreateIndex
CREATE INDEX "TestcaseCandidate_expiresAt_idx" ON "TestcaseCandidate"("expiresAt");

-- AddForeignKey
ALTER TABLE "BlobReference" ADD CONSTRAINT "BlobReference_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "BlobObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
