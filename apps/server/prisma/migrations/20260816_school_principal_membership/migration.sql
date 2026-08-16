ALTER TABLE "School" ADD COLUMN "currentPrincipalMembershipId" TEXT;
CREATE UNIQUE INDEX "School_currentPrincipalMembershipId_key" ON "School"("currentPrincipalMembershipId");
