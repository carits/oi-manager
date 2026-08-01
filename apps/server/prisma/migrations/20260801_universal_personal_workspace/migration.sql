CREATE TABLE "PersonalProfile" (
  "userId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL DEFAULT 1200,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonalProfile_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "ProblemList"
ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'campus';

ALTER TABLE "Training"
ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'campus';

ALTER TABLE "Submission"
ADD COLUMN "workspaceScope" TEXT NOT NULL DEFAULT 'campus';

ALTER TABLE "Team"
ALTER COLUMN "schoolId" DROP NOT NULL;

ALTER TABLE "TeamJoinRequest"
DROP CONSTRAINT IF EXISTS "TeamJoinRequest_userId_fkey";

ALTER TABLE "TeamJoinRequest"
ADD CONSTRAINT "TeamJoinRequest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamMember"
ADD CONSTRAINT "TeamMember_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PersonalProfile"
ADD CONSTRAINT "PersonalProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "Team"
SET "schoolId" = NULL
WHERE "scope" = 'personal';

UPDATE "TeamMember" AS member
SET "userType" = 'user'
FROM "Team" AS team
WHERE member."teamId" = team."id"
  AND team."scope" = 'personal';

UPDATE "ProblemList" AS list
SET "scope" = 'personal',
    "schoolId" = NULL,
    "ownerType" = 'user'
WHERE EXISTS (
  SELECT 1 FROM "User" AS owner
  WHERE owner."id" = list."ownerId"
    AND owner."role" = 'student'
)
AND NOT EXISTS (
  SELECT 1 FROM "SchoolProblemList" AS school_list
  WHERE school_list."problemListId" = list."id"
)
AND NOT EXISTS (
  SELECT 1
  FROM "TeamProblemList" AS team_list
  JOIN "Team" AS team ON team."id" = team_list."teamId"
  WHERE team_list."problemListId" = list."id"
    AND team."scope" = 'campus'
);

UPDATE "ProblemList" AS list
SET "scope" = 'personal',
    "schoolId" = NULL,
    "ownerType" = 'user'
WHERE EXISTS (
  SELECT 1
  FROM "TeamProblemList" AS team_list
  JOIN "Team" AS team ON team."id" = team_list."teamId"
  WHERE team_list."problemListId" = list."id"
    AND team."scope" = 'personal'
);

UPDATE "Training" AS training
SET "scope" = team."scope"
FROM "Team" AS team
WHERE training."teamId" = team."id";

UPDATE "Submission" AS submission
SET "workspaceScope" = training."scope"
FROM "Training" AS training
WHERE submission."trainingId" = training."id";

INSERT INTO "PersonalProfile" ("userId", "rating", "createdAt", "updatedAt")
SELECT DISTINCT candidate."userId", 1200, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT member."userId"
  FROM "TeamMember" AS member
  JOIN "Team" AS team ON team."id" = member."teamId"
  WHERE team."scope" = 'personal'
  UNION
  SELECT list."ownerId" AS "userId"
  FROM "ProblemList" AS list
  WHERE list."scope" = 'personal'
) AS candidate
JOIN "User" AS users ON users."id" = candidate."userId"
ON CONFLICT ("userId") DO NOTHING;

CREATE INDEX "PersonalProfile_rating_idx" ON "PersonalProfile"("rating");
CREATE INDEX "ProblemList_scope_idx" ON "ProblemList"("scope");
CREATE INDEX "ProblemList_scope_ownerId_idx" ON "ProblemList"("scope", "ownerId");
CREATE INDEX "Training_scope_idx" ON "Training"("scope");
CREATE INDEX "Training_scope_status_idx" ON "Training"("scope", "status");
CREATE INDEX "Submission_workspaceScope_idx" ON "Submission"("workspaceScope");
CREATE INDEX "Submission_workspaceScope_userId_createdAt_idx"
ON "Submission"("workspaceScope", "userId", "createdAt");
