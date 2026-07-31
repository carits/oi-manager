ALTER TABLE "Team"
ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'campus';

-- Before scopes existed, only personal-mode students could create teams.
-- Keep teacher-owned and transferred school teams in the campus scope.
UPDATE "Team" AS team
SET "scope" = 'personal'
WHERE EXISTS (
  SELECT 1
  FROM "TeamMember" AS member
  WHERE member."teamId" = team."id"
    AND member."role" = 'owner'
    AND member."userType" = 'student'
)
AND NOT EXISTS (
  SELECT 1
  FROM "TeamOperationLog" AS operation
  WHERE operation."teamId" = team."id"
    AND operation."action" = 'ownership_transfer'
    AND operation."oldValue" LIKE '%"oldOwnerType":"teacher"%'
);

CREATE INDEX "Team_scope_idx" ON "Team"("scope");
CREATE INDEX "Team_scope_isPublic_idx" ON "Team"("scope", "isPublic");
DROP INDEX IF EXISTS "Team_schoolId_isPublic_idx";
CREATE INDEX "Team_schoolId_scope_isPublic_idx"
ON "Team"("schoolId", "scope", "isPublic");
