-- Carits币与贡献系统 V1：仅建立账本和贡献事实底座，不写入账户、余额、流水或贡献数据。

CREATE TYPE "CaritsAccountOwnerType" AS ENUM ('USER', 'ORGANIZATION', 'SYSTEM');

CREATE TABLE "CaritsAccount" (
  "id" TEXT NOT NULL,
  "ownerType" "CaritsAccountOwnerType" NOT NULL,
  "userId" TEXT,
  "organizationId" TEXT,
  "systemKey" TEXT,
  "balance" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CaritsAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaritsAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaritsAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaritsAccount_owner_shape_check" CHECK (
    ("ownerType" = 'USER' AND "userId" IS NOT NULL AND "organizationId" IS NULL AND "systemKey" IS NULL)
    OR ("ownerType" = 'ORGANIZATION' AND "userId" IS NULL AND "organizationId" IS NOT NULL AND "systemKey" IS NULL)
    OR ("ownerType" = 'SYSTEM' AND "userId" IS NULL AND "organizationId" IS NULL AND "systemKey" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "CaritsAccount_userId_key" ON "CaritsAccount"("userId");
CREATE UNIQUE INDEX "CaritsAccount_organizationId_key" ON "CaritsAccount"("organizationId");
CREATE UNIQUE INDEX "CaritsAccount_systemKey_key" ON "CaritsAccount"("systemKey");
CREATE INDEX "CaritsAccount_ownerType_status_idx" ON "CaritsAccount"("ownerType", "status");

CREATE TABLE "CaritsTransaction" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "idempotencyKey" TEXT NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "operatorUserId" TEXT,
  "organizationId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "postedAt" TIMESTAMP(3),
  CONSTRAINT "CaritsTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaritsTransaction_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "CaritsTransaction_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaritsTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CaritsTransaction_referenceType_referenceId_idx" ON "CaritsTransaction"("referenceType", "referenceId");
CREATE INDEX "CaritsTransaction_organizationId_createdAt_idx" ON "CaritsTransaction"("organizationId", "createdAt");

CREATE TABLE "CaritsLedgerEntry" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "balanceAfter" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaritsLedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaritsLedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "CaritsTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CaritsLedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CaritsAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CaritsLedgerEntry_accountId_createdAt_idx" ON "CaritsLedgerEntry"("accountId", "createdAt");
CREATE INDEX "CaritsLedgerEntry_transactionId_idx" ON "CaritsLedgerEntry"("transactionId");

CREATE TABLE "ContributionEvent" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "ruleCode" TEXT NOT NULL,
  "ruleVersion" INTEGER NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "evidence" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContributionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContributionEvent_dedupeKey_key" UNIQUE ("dedupeKey"),
  CONSTRAINT "ContributionEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContributionEvent_score_positive_check" CHECK ("score" > 0)
);

CREATE INDEX "ContributionEvent_actorUserId_status_acceptedAt_idx" ON "ContributionEvent"("actorUserId", "status", "acceptedAt");
CREATE INDEX "ContributionEvent_sourceType_sourceId_idx" ON "ContributionEvent"("sourceType", "sourceId");
CREATE INDEX "ContributionEvent_status_acceptedAt_idx" ON "ContributionEvent"("status", "acceptedAt");

CREATE TABLE "OrganizationContributionAttribution" (
  "id" TEXT NOT NULL,
  "contributionId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationContributionAttribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationContributionAttribution_contributionId_key" UNIQUE ("contributionId"),
  CONSTRAINT "OrganizationContributionAttribution_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "ContributionEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrganizationContributionAttribution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "OrganizationContributionAttribution_organizationId_createdAt_idx" ON "OrganizationContributionAttribution"("organizationId", "createdAt");

CREATE TABLE "ContributionProject" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdByMembershipId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "ContributionProject_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContributionProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ContributionProject_organizationId_status_idx" ON "ContributionProject"("organizationId", "status");

CREATE OR REPLACE FUNCTION "carits_prevent_posted_transaction_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'posted' THEN
    RAISE EXCEPTION '已入账交易不可修改或删除，只能创建冲正交易';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CaritsTransaction_prevent_posted_update"
BEFORE UPDATE OR DELETE ON "CaritsTransaction"
FOR EACH ROW EXECUTE FUNCTION "carits_prevent_posted_transaction_mutation"();

CREATE OR REPLACE FUNCTION "carits_prevent_ledger_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '账本分录不可修改或删除';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CaritsLedgerEntry_prevent_mutation"
BEFORE UPDATE OR DELETE ON "CaritsLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "carits_prevent_ledger_mutation"();

CREATE OR REPLACE FUNCTION "carits_validate_posted_transaction"()
RETURNS TRIGGER AS $$
DECLARE
  entry_total BIGINT;
BEGIN
  IF NEW."status" = 'posted' THEN
    SELECT COALESCE(SUM("amount"), 0) INTO entry_total
    FROM "CaritsLedgerEntry"
    WHERE "transactionId" = NEW."id";
    IF entry_total <> 0 THEN
      RAISE EXCEPTION '已入账交易的账本分录金额之和必须为 0';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CaritsTransaction_validate_posted"
BEFORE INSERT OR UPDATE OF "status" ON "CaritsTransaction"
FOR EACH ROW EXECUTE FUNCTION "carits_validate_posted_transaction"();
