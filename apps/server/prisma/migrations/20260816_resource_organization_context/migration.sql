ALTER TABLE "Admin" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "PrincipalTransferLog" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Problem" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ProblemList" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "SchoolProblemList" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Team" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Training" ADD COLUMN "organizationId" TEXT;

UPDATE "Admin" r SET "organizationId" = s."organizationId" FROM "School" s WHERE r."schoolId" = s."id";
UPDATE "PrincipalTransferLog" r SET "organizationId" = s."organizationId" FROM "School" s WHERE r."schoolId" = s."id";
UPDATE "Problem" r SET "organizationId" = s."organizationId" FROM "School" s WHERE r."schoolId" = s."id";
UPDATE "ProblemList" r SET "organizationId" = s."organizationId" FROM "School" s WHERE r."schoolId" = s."id";
UPDATE "SchoolProblemList" r SET "organizationId" = s."organizationId" FROM "School" s WHERE r."schoolId" = s."id";
UPDATE "Team" r SET "organizationId" = s."organizationId" FROM "School" s WHERE r."schoolId" = s."id";
UPDATE "Training" r SET "organizationId" = s."organizationId" FROM "School" s WHERE r."schoolId" = s."id";

ALTER TABLE "Admin" ADD CONSTRAINT "Admin_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrincipalTransferLog" ADD CONSTRAINT "PrincipalTransferLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemList" ADD CONSTRAINT "ProblemList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolProblemList" ADD CONSTRAINT "SchoolProblemList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Training" ADD CONSTRAINT "Training_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Admin_organizationId_idx" ON "Admin"("organizationId");
CREATE INDEX "PrincipalTransferLog_organizationId_idx" ON "PrincipalTransferLog"("organizationId");
CREATE INDEX "Problem_organizationId_status_idx" ON "Problem"("organizationId", "status");
CREATE INDEX "ProblemList_organizationId_idx" ON "ProblemList"("organizationId");
CREATE INDEX "SchoolProblemList_organizationId_idx" ON "SchoolProblemList"("organizationId");
CREATE INDEX "Team_organizationId_idx" ON "Team"("organizationId");
CREATE INDEX "Training_organizationId_idx" ON "Training"("organizationId");
