CREATE TABLE "OrganizationMembershipRole" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'legacy_backfill',
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationMembershipRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationMembershipCapability" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'explicit',
    "grantedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationMembershipCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationMembershipRole_membershipId_roleKey_key"
  ON "OrganizationMembershipRole"("membershipId", "roleKey");
CREATE INDEX "OrganizationMembershipRole_roleKey_idx" ON "OrganizationMembershipRole"("roleKey");
CREATE UNIQUE INDEX "OrganizationMembershipCapability_membershipId_capabilityKey_key"
  ON "OrganizationMembershipCapability"("membershipId", "capabilityKey");
CREATE INDEX "OrganizationMembershipCapability_capabilityKey_idx"
  ON "OrganizationMembershipCapability"("capabilityKey");

ALTER TABLE "OrganizationMembershipRole"
  ADD CONSTRAINT "OrganizationMembershipRole_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembershipCapability"
  ADD CONSTRAINT "OrganizationMembershipCapability_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
