ALTER TABLE "TeamMemberImportBatch"
ADD COLUMN "organizationId" TEXT;

UPDATE "TeamMemberImportBatch" b
SET "organizationId" = t."organizationId"
FROM "Team" t
WHERE b."teamId" = t."id"
  AND b."organizationId" IS NULL
  AND t."organizationId" IS NOT NULL;

CREATE INDEX "TeamMemberImportBatch_organizationId_idx"
ON "TeamMemberImportBatch"("organizationId");

-- Legacy batches without a team cannot be mapped to an organization safely.
-- They intentionally remain NULL and are treated as inaccessible by the hardened runtime.
