-- Retire the pre-OrganizationInvitation membership invitation representation.
-- The guard intentionally fails instead of guessing how to migrate unresolved data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "OrganizationMembership"
    WHERE "status" IN ('pending', 'rejected')
       OR "invitedBy" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'OrganizationMembership still contains legacy invitation rows; run the audited invitation migration before this schema migration';
  END IF;
END
$$;

ALTER TABLE "OrganizationMembership"
  DROP COLUMN "invitedBy";

ALTER TABLE "OrganizationMembership"
  ADD CONSTRAINT "OrganizationMembership_status_check"
  CHECK ("status" IN ('active', 'disabled', 'archived'));

ALTER TABLE "OrganizationMembershipRole"
  ALTER COLUMN "source" SET DEFAULT 'application';

ALTER TABLE "LoginLog"
  DROP COLUMN "loginRole";

ALTER TABLE "LoginLog"
  RENAME COLUMN "userRole" TO "accountRoleSnapshot";
