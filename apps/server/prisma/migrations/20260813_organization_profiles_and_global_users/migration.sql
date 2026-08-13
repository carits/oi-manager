-- 组织成员关系是校园身份的唯一来源。保留旧 schoolId 仅用于兼容尚未迁移的业务资源。
ALTER TABLE "User" ALTER COLUMN "schoolId" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'user';

CREATE TABLE "OrganizationStudentProfile" (
  "id" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "gender" TEXT,
  "enrollmentYear" INTEGER,
  "targetContest" TEXT,
  "headTeacherMembershipId" TEXT,
  "tags" TEXT,
  "notes" TEXT,
  "avatar" TEXT,
  "rating" INTEGER NOT NULL DEFAULT 1200,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationStudentProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationTeacherProfile" (
  "id" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "avatar" TEXT,
  "bio" TEXT,
  "title" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationTeacherProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationStudentProfile_membershipId_key" ON "OrganizationStudentProfile"("membershipId");
CREATE INDEX "OrganizationStudentProfile_headTeacherMembershipId_idx" ON "OrganizationStudentProfile"("headTeacherMembershipId");
CREATE INDEX "OrganizationStudentProfile_status_idx" ON "OrganizationStudentProfile"("status");
CREATE UNIQUE INDEX "OrganizationTeacherProfile_membershipId_key" ON "OrganizationTeacherProfile"("membershipId");
CREATE INDEX "OrganizationTeacherProfile_status_idx" ON "OrganizationTeacherProfile"("status");
ALTER TABLE "OrganizationStudentProfile" ADD CONSTRAINT "OrganizationStudentProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationTeacherProfile" ADD CONSTRAINT "OrganizationTeacherProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "OrganizationStudentProfile" ("id", "membershipId", "name", "gender", "enrollmentYear", "targetContest", "tags", "notes", "avatar", "rating", "status", "createdAt", "updatedAt")
SELECT 'org_student_' || m."id", m."id", s."name", s."gender", s."enrollmentYear", s."targetContest", s."tags", s."notes", s."avatar", s."rating", u."status", s."createdAt", s."updatedAt"
FROM "OrganizationMembership" m
JOIN "Student" s ON s."id" = m."userId"
JOIN "User" u ON u."id" = m."userId"
WHERE m."memberRole" = 'student'
ON CONFLICT ("membershipId") DO NOTHING;

INSERT INTO "OrganizationTeacherProfile" ("id", "membershipId", "name", "email", "phone", "avatar", "bio", "title", "status", "createdAt", "updatedAt")
SELECT 'org_teacher_' || m."id", m."id", t."name", t."email", t."phone", t."avatar", t."bio", t."title", t."status", t."createdAt", t."updatedAt"
FROM "OrganizationMembership" m
JOIN "Teacher" t ON t."id" = m."userId"
WHERE m."memberRole" IN ('teacher', 'school_principal')
ON CONFLICT ("membershipId") DO NOTHING;
