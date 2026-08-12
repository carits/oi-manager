CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'school',
  "status" TEXT NOT NULL DEFAULT 'active',
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationMembership" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memberRole" TEXT NOT NULL,
  "relationType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "invitedBy" TEXT,
  "joinedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "School" ADD COLUMN "organizationId" TEXT;
CREATE UNIQUE INDEX "School_organizationId_key" ON "School"("organizationId");
CREATE INDEX "Organization_type_status_idx" ON "Organization"("type", "status");
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");
CREATE INDEX "OrganizationMembership_userId_status_idx" ON "OrganizationMembership"("userId", "status");
CREATE INDEX "OrganizationMembership_organizationId_status_idx" ON "OrganizationMembership"("organizationId", "status");

INSERT INTO "Organization" ("id", "name", "type", "status", "description", "createdAt", "updatedAt")
SELECT 'org_' || "id", "name", 'school', CASE WHEN "status" = 'disabled' THEN 'disabled' ELSE 'active' END, "description", "createdAt", "updatedAt" FROM "School";
UPDATE "School" SET "organizationId" = 'org_' || "id" WHERE "organizationId" IS NULL;

INSERT INTO "OrganizationMembership" ("id", "organizationId", "userId", "memberRole", "relationType", "status", "joinedAt")
SELECT 'membership_' || u."id" || '_' || u."schoolId", 'org_' || u."schoolId", u."id",
  CASE WHEN u."role" = 'school_principal' THEN 'school_principal' WHEN u."role" = 'student' THEN 'student' ELSE 'teacher' END,
  CASE WHEN u."role" = 'student' THEN 'enrolled' WHEN u."role" = 'school_principal' THEN 'principal' ELSE 'employee' END,
  'active', u."createdAt"
FROM "User" u
WHERE EXISTS (SELECT 1 FROM "School" s WHERE s."id" = u."schoolId")
ON CONFLICT ("organizationId", "userId") DO NOTHING;

ALTER TABLE "School" ADD CONSTRAINT "School_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
