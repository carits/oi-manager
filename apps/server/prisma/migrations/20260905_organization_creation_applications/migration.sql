+ALTER TABLE "School" ADD COLUMN "nameKey" TEXT;

CREATE TABLE "OrganizationCreationApplication" (
  "id" TEXT NOT NULL,
  "applicantUserId" TEXT NOT NULL,
  "organizationType" TEXT NOT NULL DEFAULT 'school',
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "shortName" TEXT,
  "region" TEXT NOT NULL,
  "schoolType" TEXT NOT NULL,
  "schoolNature" TEXT,
  "educationSystem" TEXT,
  "contactPerson" TEXT,
  "contactPhone" TEXT,
  "contactEmail" TEXT,
  "applicantRealName" TEXT NOT NULL,
  "applicantTitle" TEXT,
  "description" TEXT NOT NULL,
  "evidenceData" JSONB,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "decisionMessage" TEXT,
  "internalReviewNote" TEXT,
  "createdOrganizationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationCreationApplication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationCreationApplication_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT "OrganizationCreationApplication_type_check"
    CHECK ("organizationType" = 'school')
);

CREATE TABLE "PlatformAuditLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "School_nameKey_key" ON "School"("nameKey");
CREATE INDEX "OrganizationCreationApplication_applicantUserId_status_createdAt_idx"
  ON "OrganizationCreationApplication"("applicantUserId", "status", "createdAt");
CREATE INDEX "OrganizationCreationApplication_status_createdAt_idx"
  ON "OrganizationCreationApplication"("status", "createdAt");
CREATE INDEX "OrganizationCreationApplication_nameKey_status_idx"
  ON "OrganizationCreationApplication"("nameKey", "status");
CREATE UNIQUE INDEX "OrganizationCreationApplication_pending_user_unique"
  ON "OrganizationCreationApplication"("applicantUserId") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "OrganizationCreationApplication_pending_name_unique"
  ON "OrganizationCreationApplication"("nameKey") WHERE "status" = 'pending';
CREATE INDEX "PlatformAuditLog_actorUserId_createdAt_idx" ON "PlatformAuditLog"("actorUserId", "createdAt");
CREATE INDEX "PlatformAuditLog_action_createdAt_idx" ON "PlatformAuditLog"("action", "createdAt");
CREATE INDEX "PlatformAuditLog_targetType_targetId_idx" ON "PlatformAuditLog"("targetType", "targetId");

ALTER TABLE "OrganizationCreationApplication"
  ADD CONSTRAINT "OrganizationCreationApplication_applicantUserId_fkey"
  FOREIGN KEY ("applicantUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationCreationApplication"
  ADD CONSTRAINT "OrganizationCreationApplication_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganizationCreationApplication"
  ADD CONSTRAINT "OrganizationCreationApplication_createdOrganizationId_fkey"
  FOREIGN KEY ("createdOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlatformAuditLog"
  ADD CONSTRAINT "PlatformAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


