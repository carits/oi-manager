-- Contribution rewards, immutable purchased Evaluation Credits, and allocation-aware reservations.

BEGIN;

ALTER TABLE "ProblemDataGenerationJob" ADD COLUMN "contributionOrganizationId" TEXT;
ALTER TABLE "ProblemHackAttempt" ADD COLUMN "contributionOrganizationId" TEXT;
ALTER TABLE "TestcaseCandidate" ADD COLUMN "contributionOrganizationId" TEXT;
ALTER TABLE "ProblemDataGenerationJob" ADD CONSTRAINT "ProblemDataGenerationJob_contributionOrganizationId_fkey" FOREIGN KEY ("contributionOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProblemHackAttempt" ADD CONSTRAINT "ProblemHackAttempt_contributionOrganizationId_fkey" FOREIGN KEY ("contributionOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TestcaseCandidate" ADD CONSTRAINT "TestcaseCandidate_contributionOrganizationId_fkey" FOREIGN KEY ("contributionOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ProblemDataGenerationJob_contributionOrganizationId_idx" ON "ProblemDataGenerationJob"("contributionOrganizationId");
CREATE INDEX "ProblemHackAttempt_contributionOrganizationId_idx" ON "ProblemHackAttempt"("contributionOrganizationId");
CREATE INDEX "TestcaseCandidate_contributionOrganizationId_idx" ON "TestcaseCandidate"("contributionOrganizationId");

ALTER TABLE "EvaluationCreditLedgerEntry"
  ADD CONSTRAINT "EvaluationCreditLedgerEntry_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "EvaluationCreditAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "EvaluationCreditWallet" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "availableCredits" INTEGER NOT NULL DEFAULT 0,
  "reservedCredits" INTEGER NOT NULL DEFAULT 0,
  "consumedCredits" BIGINT NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvaluationCreditWallet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EvaluationCreditWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EvaluationCreditWallet_nonnegative_check" CHECK ("availableCredits" >= 0 AND "reservedCredits" >= 0 AND "consumedCredits" >= 0)
);
CREATE UNIQUE INDEX "EvaluationCreditWallet_userId_key" ON "EvaluationCreditWallet"("userId");
CREATE INDEX "EvaluationCreditWallet_updatedAt_idx" ON "EvaluationCreditWallet"("updatedAt");

CREATE TABLE "EvaluationCreditWalletEntry" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "referenceType" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvaluationCreditWalletEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EvaluationCreditWalletEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "EvaluationCreditWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EvaluationCreditWalletEntry_idempotencyKey_key" ON "EvaluationCreditWalletEntry"("idempotencyKey");
CREATE INDEX "EvaluationCreditWalletEntry_walletId_createdAt_idx" ON "EvaluationCreditWalletEntry"("walletId", "createdAt");
CREATE INDEX "EvaluationCreditWalletEntry_referenceType_referenceId_idx" ON "EvaluationCreditWalletEntry"("referenceType", "referenceId");

CREATE OR REPLACE FUNCTION "evaluation_credit_wallet_entry_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Evaluation Credit 钱包流水不可修改或删除';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EvaluationCreditWalletEntry_prevent_mutation"
BEFORE UPDATE OR DELETE ON "EvaluationCreditWalletEntry"
FOR EACH ROW EXECUTE FUNCTION "evaluation_credit_wallet_entry_immutable"();

CREATE OR REPLACE FUNCTION "evaluation_credit_ledger_entry_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Evaluation Credit 日额度流水不可修改或删除';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EvaluationCreditLedgerEntry_prevent_mutation"
BEFORE UPDATE OR DELETE ON "EvaluationCreditLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "evaluation_credit_ledger_entry_immutable"();

CREATE TABLE "EvaluationCreditReservation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "taskType" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "freeAccountId" TEXT NOT NULL,
  "platformAccountId" TEXT NOT NULL,
  "walletId" TEXT,
  "freeReserved" INTEGER NOT NULL DEFAULT 0,
  "paidReserved" INTEGER NOT NULL DEFAULT 0,
  "platformReserved" INTEGER NOT NULL,
  "actualCredits" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'reserved',
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "EvaluationCreditReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EvaluationCreditReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EvaluationCreditReservation_freeAccountId_fkey" FOREIGN KEY ("freeAccountId") REFERENCES "EvaluationCreditAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EvaluationCreditReservation_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "EvaluationCreditAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EvaluationCreditReservation_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "EvaluationCreditWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EvaluationCreditReservation_shape_check" CHECK ("freeReserved" >= 0 AND "paidReserved" >= 0 AND "platformReserved" >= 0 AND "platformReserved" = "freeReserved" + "paidReserved")
);
CREATE UNIQUE INDEX "EvaluationCreditReservation_idempotencyKey_key" ON "EvaluationCreditReservation"("idempotencyKey");
CREATE UNIQUE INDEX "EvaluationCreditReservation_taskType_taskId_key" ON "EvaluationCreditReservation"("taskType", "taskId");
CREATE INDEX "EvaluationCreditReservation_userId_periodStart_status_idx" ON "EvaluationCreditReservation"("userId", "periodStart", "status");
CREATE INDEX "EvaluationCreditReservation_status_createdAt_idx" ON "EvaluationCreditReservation"("status", "createdAt");

CREATE TABLE "ContributionRewardDelivery" (
  "id" TEXT NOT NULL,
  "contributionId" TEXT NOT NULL,
  "policyCode" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "userCarits" BIGINT NOT NULL,
  "organizationCarits" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "transactionId" TEXT,
  "reversalTransactionId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "fencingToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "postedAt" TIMESTAMP(3),
  "reversedAt" TIMESTAMP(3),
  CONSTRAINT "ContributionRewardDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContributionRewardDelivery_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "ContributionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContributionRewardDelivery_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "CaritsTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContributionRewardDelivery_reversalTransactionId_fkey" FOREIGN KEY ("reversalTransactionId") REFERENCES "CaritsTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContributionRewardDelivery_amount_check" CHECK ("userCarits" > 0 AND "organizationCarits" >= 0)
);
CREATE UNIQUE INDEX "ContributionRewardDelivery_contributionId_key" ON "ContributionRewardDelivery"("contributionId");
CREATE UNIQUE INDEX "ContributionRewardDelivery_transactionId_key" ON "ContributionRewardDelivery"("transactionId");
CREATE UNIQUE INDEX "ContributionRewardDelivery_reversalTransactionId_key" ON "ContributionRewardDelivery"("reversalTransactionId");
CREATE UNIQUE INDEX "ContributionRewardDelivery_fencingToken_key" ON "ContributionRewardDelivery"("fencingToken");
CREATE INDEX "ContributionRewardDelivery_status_nextAttemptAt_idx" ON "ContributionRewardDelivery"("status", "nextAttemptAt");
CREATE INDEX "ContributionRewardDelivery_leaseExpiresAt_idx" ON "ContributionRewardDelivery"("leaseExpiresAt");

CREATE TABLE "ResourcePurchase" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "packageCode" TEXT NOT NULL,
  "caritsAmount" BIGINT NOT NULL,
  "evaluationCredits" INTEGER NOT NULL,
  "policyCode" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "idempotencyKey" TEXT NOT NULL,
  "caritsTransactionId" TEXT NOT NULL,
  "walletEntryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResourcePurchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResourcePurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResourcePurchase_caritsTransactionId_fkey" FOREIGN KEY ("caritsTransactionId") REFERENCES "CaritsTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResourcePurchase_walletEntryId_fkey" FOREIGN KEY ("walletEntryId") REFERENCES "EvaluationCreditWalletEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResourcePurchase_amount_check" CHECK ("caritsAmount" > 0 AND "evaluationCredits" > 0)
);
CREATE UNIQUE INDEX "ResourcePurchase_idempotencyKey_key" ON "ResourcePurchase"("idempotencyKey");
CREATE UNIQUE INDEX "ResourcePurchase_caritsTransactionId_key" ON "ResourcePurchase"("caritsTransactionId");
CREATE UNIQUE INDEX "ResourcePurchase_walletEntryId_key" ON "ResourcePurchase"("walletEntryId");
CREATE INDEX "ResourcePurchase_userId_createdAt_idx" ON "ResourcePurchase"("userId", "createdAt");

CREATE UNIQUE INDEX "CaritsLedgerEntry_transactionId_accountId_key" ON "CaritsLedgerEntry"("transactionId", "accountId");

-- Reinstall the posted-transaction guard together with the other ledger
-- functions so upgraded databases and clean bootstraps have one canonical
-- function definition (including deployments crossing operating systems).
CREATE OR REPLACE FUNCTION "carits_prevent_posted_transaction_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'posted' THEN
    RAISE EXCEPTION '已入账交易不可修改或删除，只能创建冲正交易';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "carits_prevent_ledger_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM "CaritsTransaction" WHERE "id" = NEW."transactionId" AND "status" = 'posted'
  ) THEN
    RAISE EXCEPTION '已入账交易不可追加账本分录';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '账本分录不可修改或删除';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "CaritsLedgerEntry_prevent_mutation" ON "CaritsLedgerEntry";
CREATE TRIGGER "CaritsLedgerEntry_prevent_mutation"
BEFORE INSERT OR UPDATE OR DELETE ON "CaritsLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "carits_prevent_ledger_mutation"();

CREATE OR REPLACE FUNCTION "carits_validate_posted_transaction"()
RETURNS TRIGGER AS $$
DECLARE
  entry_total BIGINT;
  entry_count INTEGER;
BEGIN
  IF NEW."status" = 'posted' THEN
    SELECT COALESCE(SUM("amount"), 0), COUNT(*) INTO entry_total, entry_count
    FROM "CaritsLedgerEntry"
    WHERE "transactionId" = NEW."id";
    IF entry_count < 2 OR entry_total <> 0 THEN
      RAISE EXCEPTION '已入账交易必须至少有两条分录且金额总和为 0';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER TABLE "CaritsTransaction" ADD COLUMN IF NOT EXISTS "requestFingerprint" TEXT;

COMMIT;
