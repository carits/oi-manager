CREATE TYPE "RatingScope" AS ENUM ('NONE', 'ORGANIZATION', 'GLOBAL', 'BOTH');
CREATE TYPE "RatingTrack" AS ENUM ('OI', 'IOI', 'ACM');
CREATE TYPE "RatingParticipantStatus" AS ENUM ('REGISTERED', 'RATING_LOCKED', 'NO_SHOW', 'EXCLUDED');
CREATE TYPE "RatingParticipantDisposition" AS ENUM ('NORMAL', 'EXCLUDE', 'KEEP_RESULT', 'FORCE_LAST');
CREATE TYPE "ContestFinalizationStatus" AS ENUM ('LIVE', 'JUDGING', 'FINALIZING', 'FINALIZED', 'HELD', 'FAILED');
CREATE TYPE "StandingSnapshotStatus" AS ENUM ('BUILDING', 'FINALIZED', 'SUPERSEDED');
CREATE TYPE "RatingBatchStatus" AS ENUM ('PENDING', 'CALCULATING', 'READY', 'APPLIED', 'SKIPPED', 'STALE', 'RECALCULATING', 'SUPERSEDED', 'FAILED');

ALTER TABLE "Training"
  ADD COLUMN "finalizationStatus" "ContestFinalizationStatus" NOT NULL DEFAULT 'LIVE',
  ADD COLUMN "finalizedStandingId" TEXT;

ALTER TABLE "TrainingParticipant"
  ADD COLUMN "organizationIdSnapshot" TEXT,
  ADD COLUMN "ratingStatus" "RatingParticipantStatus" NOT NULL DEFAULT 'REGISTERED',
  ADD COLUMN "ratingDisposition" "RatingParticipantDisposition" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "ratingDispositionReason" TEXT,
  ADD COLUMN "ratingDispositionBy" TEXT,
  ADD COLUMN "ratingDispositionAt" TIMESTAMP(3),
  ADD COLUMN "firstSubmissionAt" TIMESTAMP(3),
  ADD COLUMN "ratingLockedAt" TIMESTAMP(3);

CREATE TABLE "TrainingRatingConfig" (
  "id" TEXT NOT NULL,
  "trainingId" INTEGER NOT NULL,
  "scope" "RatingScope" NOT NULL DEFAULT 'NONE',
  "track" "RatingTrack" NOT NULL,
  "weightBasisPoints" INTEGER NOT NULL DEFAULT 10000,
  "algorithmCode" TEXT NOT NULL DEFAULT 'CARITS_MULTI_ELO',
  "algorithmVersion" INTEGER NOT NULL DEFAULT 1,
  "organizationMinParticipants" INTEGER NOT NULL DEFAULT 5,
  "globalMinParticipants" INTEGER NOT NULL DEFAULT 20,
  "scoringRules" JSONB NOT NULL,
  "rulesHash" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "lockedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingRatingConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContestStandingSnapshot" (
  "id" TEXT NOT NULL,
  "trainingId" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "scoringMode" "RatingTrack" NOT NULL,
  "rulesHash" TEXT NOT NULL,
  "status" "StandingSnapshotStatus" NOT NULL DEFAULT 'BUILDING',
  "inputHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  CONSTRAINT "ContestStandingSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContestStandingEntry" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationIdSnapshot" TEXT,
  "rank" INTEGER NOT NULL,
  "ratingTieGroup" TEXT NOT NULL,
  "totalScore" DECIMAL(14,4),
  "solvedCount" INTEGER,
  "penaltySeconds" INTEGER,
  "lastAcceptedAt" TIMESTAMP(3),
  "fullScoreCount" INTEGER,
  "ratingEligible" BOOLEAN NOT NULL DEFAULT true,
  "participantDisposition" "RatingParticipantDisposition" NOT NULL DEFAULT 'NORMAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContestStandingEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RatingPool" (
  "id" TEXT NOT NULL,
  "scopeType" "RatingScope" NOT NULL,
  "organizationId" TEXT,
  "track" "RatingTrack" NOT NULL,
  "baseRating" INTEGER NOT NULL DEFAULT 1500,
  "scale" INTEGER NOT NULL DEFAULT 400,
  "kFactor" INTEGER NOT NULL DEFAULT 96,
  "algorithmCode" TEXT NOT NULL DEFAULT 'CARITS_MULTI_ELO',
  "algorithmVersion" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RatingPool_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RatingPool_scope_shape" CHECK (
    ("scopeType" = 'GLOBAL' AND "organizationId" IS NULL) OR
    ("scopeType" = 'ORGANIZATION' AND "organizationId" IS NOT NULL)
  )
);

CREATE TABLE "RatingAccount" (
  "id" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL DEFAULT 1500,
  "peakRating" INTEGER NOT NULL DEFAULT 1500,
  "ratedContestCount" INTEGER NOT NULL DEFAULT 0,
  "provisional" BOOLEAN NOT NULL DEFAULT true,
  "lastRatedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RatingAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RatingBatch" (
  "id" TEXT NOT NULL,
  "trainingId" INTEGER NOT NULL,
  "poolId" TEXT NOT NULL,
  "standingSnapshotId" TEXT NOT NULL,
  "algorithmCode" TEXT NOT NULL,
  "algorithmVersion" INTEGER NOT NULL,
  "batchRevision" INTEGER NOT NULL DEFAULT 1,
  "fieldSize" INTEGER NOT NULL,
  "status" "RatingBatchStatus" NOT NULL DEFAULT 'PENDING',
  "inputHash" TEXT NOT NULL,
  "sequenceAt" TIMESTAMP(3) NOT NULL,
  "skipReason" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "calculatedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "supersedesBatchId" TEXT,
  CONSTRAINT "RatingBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RatingChange" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "ratingBefore" INTEGER NOT NULL,
  "expectedPerformance" DECIMAL(8,7) NOT NULL,
  "actualPerformance" DECIMAL(8,7) NOT NULL,
  "rank" INTEGER NOT NULL,
  "fieldSize" INTEGER NOT NULL,
  "rawDelta" DECIMAL(12,6) NOT NULL,
  "appliedDelta" INTEGER NOT NULL,
  "ratingAfter" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RatingChange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RatingRebuildJob" (
  "id" TEXT NOT NULL,
  "poolId" TEXT NOT NULL,
  "fromTrainingId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "requestedBy" TEXT NOT NULL,
  "report" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "RatingRebuildJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Training_finalizedStandingId_key" ON "Training"("finalizedStandingId");
CREATE UNIQUE INDEX "TrainingRatingConfig_trainingId_key" ON "TrainingRatingConfig"("trainingId");
CREATE INDEX "TrainingRatingConfig_scope_track_idx" ON "TrainingRatingConfig"("scope", "track");
CREATE INDEX "TrainingRatingConfig_lockedAt_idx" ON "TrainingRatingConfig"("lockedAt");
CREATE UNIQUE INDEX "ContestStandingSnapshot_trainingId_revision_key" ON "ContestStandingSnapshot"("trainingId", "revision");
CREATE INDEX "ContestStandingSnapshot_trainingId_status_idx" ON "ContestStandingSnapshot"("trainingId", "status");
CREATE UNIQUE INDEX "ContestStandingEntry_snapshotId_userId_key" ON "ContestStandingEntry"("snapshotId", "userId");
CREATE INDEX "ContestStandingEntry_snapshotId_rank_idx" ON "ContestStandingEntry"("snapshotId", "rank");
CREATE INDEX "ContestStandingEntry_userId_createdAt_idx" ON "ContestStandingEntry"("userId", "createdAt");
CREATE INDEX "ContestStandingEntry_organizationIdSnapshot_idx" ON "ContestStandingEntry"("organizationIdSnapshot");
CREATE UNIQUE INDEX "RatingPool_scopeType_organizationId_track_key" ON "RatingPool"("scopeType", "organizationId", "track");
CREATE UNIQUE INDEX "RatingPool_global_track_key" ON "RatingPool"("track") WHERE "scopeType" = 'GLOBAL';
CREATE INDEX "RatingPool_organizationId_track_idx" ON "RatingPool"("organizationId", "track");
CREATE INDEX "RatingPool_scopeType_track_status_idx" ON "RatingPool"("scopeType", "track", "status");
CREATE UNIQUE INDEX "RatingAccount_poolId_userId_key" ON "RatingAccount"("poolId", "userId");
CREATE INDEX "RatingAccount_poolId_rating_idx" ON "RatingAccount"("poolId", "rating" DESC);
CREATE INDEX "RatingAccount_userId_updatedAt_idx" ON "RatingAccount"("userId", "updatedAt");
CREATE UNIQUE INDEX "RatingBatch_pool_snapshot_algorithm_revision_key" ON "RatingBatch"("poolId", "standingSnapshotId", "algorithmCode", "algorithmVersion", "batchRevision");
CREATE INDEX "RatingBatch_trainingId_status_idx" ON "RatingBatch"("trainingId", "status");
CREATE INDEX "RatingBatch_poolId_sequenceAt_idx" ON "RatingBatch"("poolId", "sequenceAt");
CREATE UNIQUE INDEX "RatingChange_batchId_userId_key" ON "RatingChange"("batchId", "userId");
CREATE INDEX "RatingChange_userId_createdAt_idx" ON "RatingChange"("userId", "createdAt");
CREATE INDEX "RatingChange_accountId_createdAt_idx" ON "RatingChange"("accountId", "createdAt");
CREATE INDEX "RatingRebuildJob_poolId_status_idx" ON "RatingRebuildJob"("poolId", "status");

ALTER TABLE "TrainingRatingConfig" ADD CONSTRAINT "TrainingRatingConfig_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContestStandingSnapshot" ADD CONSTRAINT "ContestStandingSnapshot_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContestStandingEntry" ADD CONSTRAINT "ContestStandingEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ContestStandingSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContestStandingEntry" ADD CONSTRAINT "ContestStandingEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingPool" ADD CONSTRAINT "RatingPool_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingAccount" ADD CONSTRAINT "RatingAccount_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "RatingPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingAccount" ADD CONSTRAINT "RatingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingBatch" ADD CONSTRAINT "RatingBatch_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingBatch" ADD CONSTRAINT "RatingBatch_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "RatingPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingBatch" ADD CONSTRAINT "RatingBatch_standingSnapshotId_fkey" FOREIGN KEY ("standingSnapshotId") REFERENCES "ContestStandingSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingBatch" ADD CONSTRAINT "RatingBatch_supersedesBatchId_fkey" FOREIGN KEY ("supersedesBatchId") REFERENCES "RatingBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RatingChange" ADD CONSTRAINT "RatingChange_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "RatingBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingChange" ADD CONSTRAINT "RatingChange_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RatingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingChange" ADD CONSTRAINT "RatingChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RatingRebuildJob" ADD CONSTRAINT "RatingRebuildJob_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "RatingPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Training" ADD CONSTRAINT "Training_finalizedStandingId_fkey" FOREIGN KEY ("finalizedStandingId") REFERENCES "ContestStandingSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrainingRatingConfig" ADD CONSTRAINT "TrainingRatingConfig_weight_range" CHECK ("weightBasisPoints" BETWEEN 1000 AND 10000);
ALTER TABLE "TrainingRatingConfig" ADD CONSTRAINT "TrainingRatingConfig_participant_minimums" CHECK ("organizationMinParticipants" >= 2 AND "globalMinParticipants" >= 2);
ALTER TABLE "RatingPool" ADD CONSTRAINT "RatingPool_scope_shape" CHECK (
  ("scopeType" = 'GLOBAL' AND "organizationId" IS NULL) OR
  ("scopeType" = 'ORGANIZATION' AND "organizationId" IS NOT NULL)
);
