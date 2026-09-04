ALTER TABLE "Organization"
  ADD COLUMN "joinPolicy" TEXT NOT NULL DEFAULT 'invite_only';

CREATE TABLE "OrganizationJoinApplication" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestedRole" TEXT NOT NULL,
  "requestedRelationType" TEXT NOT NULL,
  "realName" TEXT NOT NULL,
  "profileData" JSONB,
  "message" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewedByUserId" TEXT,
  "reviewedByMembershipId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "decisionMessage" TEXT,
  "internalReviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationJoinApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationInvitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memberRole" TEXT NOT NULL,
  "relationType" TEXT NOT NULL,
  "invitedByUserId" TEXT NOT NULL,
  "invitedByMembershipId" TEXT NOT NULL,
  "headTeacherMembershipId" TEXT,
  "profileData" JSONB,
  "message" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationAuditLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorMembershipId" TEXT,
  "action" TEXT NOT NULL,
  "targetUserId" TEXT,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationJoinApplication_organizationId_status_createdAt_idx"
  ON "OrganizationJoinApplication"("organizationId", "status", "createdAt");
CREATE INDEX "OrganizationJoinApplication_userId_status_createdAt_idx"
  ON "OrganizationJoinApplication"("userId", "status", "createdAt");
CREATE UNIQUE INDEX "OrganizationJoinApplication_pending_unique"
  ON "OrganizationJoinApplication"("organizationId", "userId") WHERE "status" = 'pending';

CREATE INDEX "OrganizationInvitation_organizationId_status_createdAt_idx"
  ON "OrganizationInvitation"("organizationId", "status", "createdAt");
CREATE INDEX "OrganizationInvitation_userId_status_createdAt_idx"
  ON "OrganizationInvitation"("userId", "status", "createdAt");
CREATE INDEX "OrganizationInvitation_expiresAt_status_idx"
  ON "OrganizationInvitation"("expiresAt", "status");
CREATE UNIQUE INDEX "OrganizationInvitation_pending_unique"
  ON "OrganizationInvitation"("organizationId", "userId") WHERE "status" = 'pending';

CREATE INDEX "OrganizationAuditLog_organizationId_createdAt_idx"
  ON "OrganizationAuditLog"("organizationId", "createdAt");
CREATE INDEX "OrganizationAuditLog_actorUserId_createdAt_idx"
  ON "OrganizationAuditLog"("actorUserId", "createdAt");
CREATE INDEX "OrganizationAuditLog_targetUserId_createdAt_idx"
  ON "OrganizationAuditLog"("targetUserId", "createdAt");

ALTER TABLE "OrganizationJoinApplication"
  ADD CONSTRAINT "OrganizationJoinApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrganizationJoinApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrganizationJoinApplication_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "OrganizationJoinApplication_reviewedByMembershipId_fkey" FOREIGN KEY ("reviewedByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrganizationInvitation"
  ADD CONSTRAINT "OrganizationInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrganizationInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrganizationInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrganizationInvitation_invitedByMembershipId_fkey" FOREIGN KEY ("invitedByMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrganizationInvitation_headTeacherMembershipId_fkey" FOREIGN KEY ("headTeacherMembershipId") REFERENCES "OrganizationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrganizationAuditLog"
  ADD CONSTRAINT "OrganizationAuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserNotification"
  ADD COLUMN "contextType" TEXT NOT NULL DEFAULT 'account',
  ADD COLUMN "contextKey" TEXT NOT NULL DEFAULT 'account',
  ADD COLUMN "organizationId" TEXT;

UPDATE "UserNotification"
SET "contextType" = CASE WHEN "scope" = 'personal' OR "type" = 'organization_invitation' THEN 'account' ELSE 'organization' END,
    "contextKey" = CASE WHEN "scope" = 'personal' OR "type" = 'organization_invitation' THEN 'account' ELSE 'legacy:campus' END;

-- The old uniqueness key contained scope. If the same account event exists in
-- both scopes, retain the newest actionable row and retire older duplicates
-- before installing the account-context uniqueness constraint.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "userId", "contextKey", "type", "sourceType", "sourceId"
    ORDER BY "createdAt" DESC, "id" DESC
  ) AS position
  FROM "UserNotification"
)
UPDATE "UserNotification" notification
SET "contextKey" = 'retired:' || notification."id",
    "readAt" = COALESCE(notification."readAt", CURRENT_TIMESTAMP),
    "href" = NULL
FROM ranked
WHERE notification."id" = ranked."id" AND ranked.position > 1;

DROP INDEX "UserNotification_userId_scope_sourceType_sourceId_key";
CREATE UNIQUE INDEX "UserNotification_userId_contextKey_type_sourceType_sourceId_key"
  ON "UserNotification"("userId", "contextKey", "type", "sourceType", "sourceId");
CREATE INDEX "UserNotification_userId_contextKey_readAt_createdAt_idx"
  ON "UserNotification"("userId", "contextKey", "readAt", "createdAt");
