BEGIN;

CREATE TYPE "DataProductGrade" AS ENUM ('COMMUNITY', 'VERIFIED', 'COMPETITION_GRADE');
CREATE TYPE "DataProductStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'RETIRED');
CREATE TYPE "DataProductSellerType" AS ENUM ('USER', 'ORGANIZATION');
CREATE TYPE "DataLicenseType" AS ENUM ('PERSONAL', 'ORGANIZATION', 'CONTEST');
CREATE TYPE "DataProductUpdatePolicy" AS ENUM ('SNAPSHOT', 'UPDATE_90D', 'LIFETIME_UPDATES');
CREATE TYPE "DataPurchaseStatus" AS ENUM ('POSTED', 'REFUNDED');
CREATE TYPE "DataEntitlementGrantReason" AS ENUM ('PURCHASE', 'POLICY_UPGRADE', 'CRITICAL_FIX');
CREATE TYPE "TestSetQualityIncidentSeverity" AS ENUM ('INFO', 'MINOR', 'MAJOR', 'CRITICAL');
CREATE TYPE "TestSetQualityIncidentStatus" AS ENUM ('OPEN', 'CONFIRMED', 'RESOLVED');

CREATE TABLE "DataProduct" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "qualitySnapshotId" TEXT NOT NULL,
  "sellerType" "DataProductSellerType" NOT NULL,
  "sellerUserId" TEXT NOT NULL,
  "sellerOrganizationId" TEXT,
  "grade" "DataProductGrade" NOT NULL,
  "updatePolicy" "DataProductUpdatePolicy" NOT NULL DEFAULT 'SNAPSHOT',
  "status" "DataProductStatus" NOT NULL DEFAULT 'ACTIVE',
  "includes" JSONB NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "suspendedAt" TIMESTAMP(3),
  "suspensionReason" TEXT,
  "suspensionIncidentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataProduct_seller_scope_check" CHECK (
    ("sellerType" = 'USER' AND "sellerOrganizationId" IS NULL) OR
    ("sellerType" = 'ORGANIZATION' AND "sellerOrganizationId" IS NOT NULL)
  )
);

CREATE TABLE "DataProductPrice" (
  "id" TEXT NOT NULL,
  "dataProductId" TEXT NOT NULL,
  "licenseType" "DataLicenseType" NOT NULL,
  "amountCarits" BIGINT NOT NULL,
  "pricingVersion" INTEGER NOT NULL DEFAULT 1,
  "pricingEvidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataProductPrice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataProductPrice_positive_amount_check" CHECK ("amountCarits" > 0)
);

CREATE TABLE "DataPurchase" (
  "id" TEXT NOT NULL,
  "dataProductId" TEXT NOT NULL,
  "priceId" TEXT NOT NULL,
  "buyerUserId" TEXT NOT NULL,
  "buyerOrganizationId" TEXT,
  "contestId" INTEGER,
  "licenseType" "DataLicenseType" NOT NULL,
  "purchasedRevisionId" TEXT NOT NULL,
  "qualitySnapshotId" TEXT NOT NULL,
  "amountCarits" BIGINT NOT NULL,
  "status" "DataPurchaseStatus" NOT NULL DEFAULT 'POSTED',
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "caritsTransactionId" TEXT NOT NULL,
  "qualityCertificateSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataPurchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataPurchase_positive_amount_check" CHECK ("amountCarits" > 0),
  CONSTRAINT "DataPurchase_scope_check" CHECK (
    ("licenseType" = 'PERSONAL' AND "buyerOrganizationId" IS NULL AND "contestId" IS NULL) OR
    ("licenseType" = 'ORGANIZATION' AND "buyerOrganizationId" IS NOT NULL AND "contestId" IS NULL) OR
    ("licenseType" = 'CONTEST' AND "contestId" IS NOT NULL)
  )
);

CREATE TABLE "DataEntitlement" (
  "id" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "buyerUserId" TEXT NOT NULL,
  "buyerOrganizationId" TEXT,
  "contestId" INTEGER,
  "licenseType" "DataLicenseType" NOT NULL,
  "downloadAllowed" BOOLEAN NOT NULL DEFAULT true,
  "importAllowed" BOOLEAN NOT NULL DEFAULT true,
  "updatesUntil" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataEntitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataEntitlement_scope_check" CHECK (
    ("licenseType" = 'PERSONAL' AND "buyerOrganizationId" IS NULL AND "contestId" IS NULL) OR
    ("licenseType" = 'ORGANIZATION' AND "buyerOrganizationId" IS NOT NULL AND "contestId" IS NULL) OR
    ("licenseType" = 'CONTEST' AND "contestId" IS NOT NULL)
  )
);

CREATE TABLE "DataEntitlementRevision" (
  "id" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "dataProductId" TEXT,
  "testSetRevisionId" TEXT NOT NULL,
  "qualitySnapshotId" TEXT NOT NULL,
  "grantReason" "DataEntitlementGrantReason" NOT NULL,
  "sourceIncidentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataEntitlementRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataEntitlementRevision_sequence_check" CHECK ("sequence" > 0)
);

CREATE TABLE "TestSetQualityIncident" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "severity" "TestSetQualityIncidentSeverity" NOT NULL,
  "type" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "status" "TestSetQualityIncidentStatus" NOT NULL DEFAULT 'OPEN',
  "discoveredByUserId" TEXT NOT NULL,
  "confirmedByUserId" TEXT,
  "resolvedByUserId" TEXT,
  "fixedByRevisionId" TEXT,
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TestSetQualityIncident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataProduct_revisionId_qualitySnapshotId_updatePolicy_key" ON "DataProduct"("revisionId", "qualitySnapshotId", "updatePolicy");
CREATE INDEX "DataProduct_problemId_status_grade_idx" ON "DataProduct"("problemId", "status", "grade");
CREATE INDEX "DataProduct_revisionId_status_idx" ON "DataProduct"("revisionId", "status");
CREATE INDEX "DataProduct_sellerUserId_status_idx" ON "DataProduct"("sellerUserId", "status");
CREATE INDEX "DataProduct_sellerOrganizationId_status_idx" ON "DataProduct"("sellerOrganizationId", "status");
CREATE INDEX "DataProduct_suspensionIncidentId_idx" ON "DataProduct"("suspensionIncidentId");
CREATE UNIQUE INDEX "DataProductPrice_dataProductId_licenseType_key" ON "DataProductPrice"("dataProductId", "licenseType");
CREATE INDEX "DataProductPrice_licenseType_amountCarits_idx" ON "DataProductPrice"("licenseType", "amountCarits");
CREATE UNIQUE INDEX "DataPurchase_idempotencyKey_key" ON "DataPurchase"("idempotencyKey");
CREATE UNIQUE INDEX "DataPurchase_caritsTransactionId_key" ON "DataPurchase"("caritsTransactionId");
CREATE INDEX "DataPurchase_buyerUserId_createdAt_idx" ON "DataPurchase"("buyerUserId", "createdAt");
CREATE INDEX "DataPurchase_buyerOrganizationId_createdAt_idx" ON "DataPurchase"("buyerOrganizationId", "createdAt");
CREATE INDEX "DataPurchase_contestId_createdAt_idx" ON "DataPurchase"("contestId", "createdAt");
CREATE INDEX "DataPurchase_dataProductId_licenseType_status_idx" ON "DataPurchase"("dataProductId", "licenseType", "status");
CREATE INDEX "DataPurchase_purchasedRevisionId_idx" ON "DataPurchase"("purchasedRevisionId");
CREATE UNIQUE INDEX "DataEntitlement_purchaseId_key" ON "DataEntitlement"("purchaseId");
CREATE INDEX "DataEntitlement_buyerUserId_revokedAt_createdAt_idx" ON "DataEntitlement"("buyerUserId", "revokedAt", "createdAt");
CREATE INDEX "DataEntitlement_buyerOrganizationId_revokedAt_idx" ON "DataEntitlement"("buyerOrganizationId", "revokedAt");
CREATE INDEX "DataEntitlement_contestId_revokedAt_idx" ON "DataEntitlement"("contestId", "revokedAt");
CREATE UNIQUE INDEX "DataEntitlementRevision_entitlementId_sequence_key" ON "DataEntitlementRevision"("entitlementId", "sequence");
CREATE UNIQUE INDEX "DataEntitlementRevision_entitlementId_testSetRevisionId_key" ON "DataEntitlementRevision"("entitlementId", "testSetRevisionId");
CREATE UNIQUE INDEX "DataEntitlementRevision_entitlementId_sourceIncidentId_key" ON "DataEntitlementRevision"("entitlementId", "sourceIncidentId");
CREATE INDEX "DataEntitlementRevision_testSetRevisionId_idx" ON "DataEntitlementRevision"("testSetRevisionId");
CREATE INDEX "DataEntitlementRevision_dataProductId_idx" ON "DataEntitlementRevision"("dataProductId");
CREATE INDEX "TestSetQualityIncident_problemId_status_severity_idx" ON "TestSetQualityIncident"("problemId", "status", "severity");
CREATE INDEX "TestSetQualityIncident_revisionId_status_idx" ON "TestSetQualityIncident"("revisionId", "status");
CREATE INDEX "TestSetQualityIncident_fixedByRevisionId_idx" ON "TestSetQualityIncident"("fixedByRevisionId");

ALTER TABLE "DataProduct" ADD CONSTRAINT "DataProduct_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataProduct" ADD CONSTRAINT "DataProduct_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataProduct" ADD CONSTRAINT "DataProduct_qualitySnapshotId_fkey" FOREIGN KEY ("qualitySnapshotId") REFERENCES "TestSetQualitySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataProduct" ADD CONSTRAINT "DataProduct_sellerUserId_fkey" FOREIGN KEY ("sellerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataProduct" ADD CONSTRAINT "DataProduct_sellerOrganizationId_fkey" FOREIGN KEY ("sellerOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataProductPrice" ADD CONSTRAINT "DataProductPrice_dataProductId_fkey" FOREIGN KEY ("dataProductId") REFERENCES "DataProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataPurchase" ADD CONSTRAINT "DataPurchase_dataProductId_fkey" FOREIGN KEY ("dataProductId") REFERENCES "DataProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataPurchase" ADD CONSTRAINT "DataPurchase_priceId_fkey" FOREIGN KEY ("priceId") REFERENCES "DataProductPrice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataPurchase" ADD CONSTRAINT "DataPurchase_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataPurchase" ADD CONSTRAINT "DataPurchase_buyerOrganizationId_fkey" FOREIGN KEY ("buyerOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataPurchase" ADD CONSTRAINT "DataPurchase_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Training"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataPurchase" ADD CONSTRAINT "DataPurchase_purchasedRevisionId_fkey" FOREIGN KEY ("purchasedRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataPurchase" ADD CONSTRAINT "DataPurchase_qualitySnapshotId_fkey" FOREIGN KEY ("qualitySnapshotId") REFERENCES "TestSetQualitySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataPurchase" ADD CONSTRAINT "DataPurchase_caritsTransactionId_fkey" FOREIGN KEY ("caritsTransactionId") REFERENCES "CaritsTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataEntitlement" ADD CONSTRAINT "DataEntitlement_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "DataPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataEntitlement" ADD CONSTRAINT "DataEntitlement_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataEntitlement" ADD CONSTRAINT "DataEntitlement_buyerOrganizationId_fkey" FOREIGN KEY ("buyerOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataEntitlement" ADD CONSTRAINT "DataEntitlement_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Training"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataEntitlementRevision" ADD CONSTRAINT "DataEntitlementRevision_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "DataEntitlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataEntitlementRevision" ADD CONSTRAINT "DataEntitlementRevision_dataProductId_fkey" FOREIGN KEY ("dataProductId") REFERENCES "DataProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataEntitlementRevision" ADD CONSTRAINT "DataEntitlementRevision_testSetRevisionId_fkey" FOREIGN KEY ("testSetRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataEntitlementRevision" ADD CONSTRAINT "DataEntitlementRevision_qualitySnapshotId_fkey" FOREIGN KEY ("qualitySnapshotId") REFERENCES "TestSetQualitySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestSetQualityIncident" ADD CONSTRAINT "TestSetQualityIncident_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestSetQualityIncident" ADD CONSTRAINT "TestSetQualityIncident_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestSetQualityIncident" ADD CONSTRAINT "TestSetQualityIncident_fixedByRevisionId_fkey" FOREIGN KEY ("fixedByRevisionId") REFERENCES "ProblemTestSetRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestSetQualityIncident" ADD CONSTRAINT "TestSetQualityIncident_discoveredByUserId_fkey" FOREIGN KEY ("discoveredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestSetQualityIncident" ADD CONSTRAINT "TestSetQualityIncident_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestSetQualityIncident" ADD CONSTRAINT "TestSetQualityIncident_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataProduct" ADD CONSTRAINT "DataProduct_suspensionIncidentId_fkey" FOREIGN KEY ("suspensionIncidentId") REFERENCES "TestSetQualityIncident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataEntitlementRevision" ADD CONSTRAINT "DataEntitlementRevision_sourceIncidentId_fkey" FOREIGN KEY ("sourceIncidentId") REFERENCES "TestSetQualityIncident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_data_market_immutable_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION enforce_data_product_binding_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."problemId" IS DISTINCT FROM OLD."problemId" OR NEW."revisionId" IS DISTINCT FROM OLD."revisionId"
     OR NEW."qualitySnapshotId" IS DISTINCT FROM OLD."qualitySnapshotId" OR NEW."grade" IS DISTINCT FROM OLD."grade"
     OR NEW."sellerType" IS DISTINCT FROM OLD."sellerType" OR NEW."sellerUserId" IS DISTINCT FROM OLD."sellerUserId"
     OR NEW."sellerOrganizationId" IS DISTINCT FROM OLD."sellerOrganizationId" OR NEW."updatePolicy" IS DISTINCT FROM OLD."updatePolicy"
     OR NEW."includes" IS DISTINCT FROM OLD."includes" OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt" THEN
    RAISE EXCEPTION 'DataProduct certificate binding is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION enforce_data_entitlement_identity_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."purchaseId" IS DISTINCT FROM OLD."purchaseId" OR NEW."buyerUserId" IS DISTINCT FROM OLD."buyerUserId"
     OR NEW."buyerOrganizationId" IS DISTINCT FROM OLD."buyerOrganizationId" OR NEW."contestId" IS DISTINCT FROM OLD."contestId"
     OR NEW."licenseType" IS DISTINCT FROM OLD."licenseType" OR NEW."updatesUntil" IS DISTINCT FROM OLD."updatesUntil"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'DataEntitlement identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DataProduct_binding_immutable" BEFORE UPDATE ON "DataProduct" FOR EACH ROW EXECUTE FUNCTION enforce_data_product_binding_immutable();
CREATE TRIGGER "DataProductPrice_immutable" BEFORE UPDATE OR DELETE ON "DataProductPrice" FOR EACH ROW EXECUTE FUNCTION reject_data_market_immutable_update();
CREATE TRIGGER "DataPurchase_immutable" BEFORE UPDATE OR DELETE ON "DataPurchase" FOR EACH ROW EXECUTE FUNCTION reject_data_market_immutable_update();
CREATE TRIGGER "DataEntitlement_identity_immutable" BEFORE UPDATE ON "DataEntitlement" FOR EACH ROW EXECUTE FUNCTION enforce_data_entitlement_identity_immutable();
CREATE TRIGGER "DataEntitlementRevision_immutable" BEFORE UPDATE OR DELETE ON "DataEntitlementRevision" FOR EACH ROW EXECUTE FUNCTION reject_data_market_immutable_update();

COMMIT;
