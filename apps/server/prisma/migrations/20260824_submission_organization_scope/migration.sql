ALTER TABLE "Submission" ADD COLUMN "organizationId" TEXT;

-- Training/contest submissions have the strongest historical ownership signal.
UPDATE "Submission" AS submission
SET "organizationId" = COALESCE(training."organizationId", team."organizationId")
FROM "Training" AS training
LEFT JOIN "Team" AS team ON team.id = training."teamId"
WHERE submission."trainingId" = training.id
  AND submission."workspaceScope" = 'campus'
  AND submission."organizationId" IS NULL;

-- School-library problem submissions inherit the owning organization.
UPDATE "Submission" AS submission
SET "organizationId" = problem."organizationId"
FROM "Problem" AS problem
WHERE submission."problemInternalId" = problem.id
  AND submission."workspaceScope" = 'campus'
  AND submission."organizationId" IS NULL
  AND problem."organizationId" IS NOT NULL;

-- For remaining legacy campus submissions, a single active membership is
-- unambiguous. Multi-organization users remain NULL and are hidden from
-- organization-scoped lists until an authoritative activity can identify them.
WITH single_membership AS (
  SELECT "userId", MIN("organizationId") AS "organizationId"
  FROM "OrganizationMembership"
  WHERE status = 'active'
  GROUP BY "userId"
  HAVING COUNT(*) = 1
)
UPDATE "Submission" AS submission
SET "organizationId" = membership."organizationId"
FROM single_membership AS membership
WHERE submission."userId" = membership."userId"
  AND submission."workspaceScope" = 'campus'
  AND submission."organizationId" IS NULL;

CREATE INDEX "Submission_organizationId_workspaceScope_createdAt_idx"
ON "Submission"("organizationId", "workspaceScope", "createdAt");

ALTER TABLE "Submission"
ADD CONSTRAINT "Submission_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
