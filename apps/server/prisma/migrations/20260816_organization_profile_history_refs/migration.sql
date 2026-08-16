ALTER TABLE "ContestProblemScore"
  ADD COLUMN "studentProfileId" TEXT,
  ADD COLUMN "studentNameSnapshot" TEXT,
  ADD COLUMN "usernameSnapshot" TEXT;

ALTER TABLE "ContestResult"
  ADD COLUMN "studentProfileId" TEXT,
  ADD COLUMN "studentNameSnapshot" TEXT,
  ADD COLUMN "usernameSnapshot" TEXT;

ALTER TABLE "Milestone"
  ADD COLUMN "studentMembershipId" TEXT,
  ADD COLUMN "teacherMembershipId" TEXT,
  ADD COLUMN "studentNameSnapshot" TEXT,
  ADD COLUMN "teacherNameSnapshot" TEXT;

ALTER TABLE "TeamMemberExternalAccount"
  ADD COLUMN "studentProfileId" TEXT,
  ADD COLUMN "studentNameSnapshot" TEXT;

ALTER TABLE "TeamMemberImportItem"
  ADD COLUMN "matchedStudentProfileId" TEXT,
  ADD COLUMN "createdStudentProfileId" TEXT;

ALTER TABLE "PrincipalTransferLog"
  ADD COLUMN "oldPrincipalMembershipId" TEXT,
  ADD COLUMN "newPrincipalMembershipId" TEXT,
  ADD COLUMN "oldPrincipalNameSnapshot" TEXT,
  ADD COLUMN "newPrincipalNameSnapshot" TEXT;

CREATE INDEX "ContestProblemScore_studentProfileId_idx" ON "ContestProblemScore"("studentProfileId");
CREATE INDEX "ContestResult_studentProfileId_idx" ON "ContestResult"("studentProfileId");
CREATE INDEX "Milestone_studentMembershipId_idx" ON "Milestone"("studentMembershipId");
CREATE INDEX "Milestone_teacherMembershipId_idx" ON "Milestone"("teacherMembershipId");
CREATE INDEX "TeamMemberExternalAccount_studentProfileId_idx" ON "TeamMemberExternalAccount"("studentProfileId");
CREATE INDEX "TeamMemberImportItem_matchedStudentProfileId_idx" ON "TeamMemberImportItem"("matchedStudentProfileId");
CREATE INDEX "TeamMemberImportItem_createdStudentProfileId_idx" ON "TeamMemberImportItem"("createdStudentProfileId");
CREATE INDEX "PrincipalTransferLog_oldPrincipalMembershipId_idx" ON "PrincipalTransferLog"("oldPrincipalMembershipId");
CREATE INDEX "PrincipalTransferLog_newPrincipalMembershipId_idx" ON "PrincipalTransferLog"("newPrincipalMembershipId");

ALTER TABLE "ContestProblemScore" ADD CONSTRAINT "ContestProblemScore_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "OrganizationStudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContestResult" ADD CONSTRAINT "ContestResult_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "OrganizationStudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamMemberExternalAccount" ADD CONSTRAINT "TeamMemberExternalAccount_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "OrganizationStudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_studentMembershipId_fkey" FOREIGN KEY ("studentMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_teacherMembershipId_fkey" FOREIGN KEY ("teacherMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrincipalTransferLog" ADD CONSTRAINT "PrincipalTransferLog_oldPrincipalMembershipId_fkey" FOREIGN KEY ("oldPrincipalMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrincipalTransferLog" ADD CONSTRAINT "PrincipalTransferLog_newPrincipalMembershipId_fkey" FOREIGN KEY ("newPrincipalMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
