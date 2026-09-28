import { beforeAll, afterAll, afterEach } from 'vitest'
import { prisma } from '../src/prisma'

const PLATFORM_ORGANIZATION_ID = 'platform-organization-00000000'
const PLATFORM_SCHOOL_ID = 'platform-school-00000000'
const PLATFORM_PRINCIPAL_USER_ID = 'platform-principal-user-placeholder'
const PLATFORM_MEMBERSHIP_ID = 'platform-principal-membership-placeholder'
let cleanupTableList = ''

async function ensureMigrationTriggers() {
  const statements = [
    `
      CREATE OR REPLACE FUNCTION "solution_snapshot_immutable"()
      RETURNS TRIGGER AS $trigger$
      BEGIN
        RAISE EXCEPTION '题解投稿快照与审核记录不可修改或删除';
      END;
      $trigger$ LANGUAGE plpgsql
    `,
    `DROP TRIGGER IF EXISTS "SolutionContributionRevision_prevent_mutation" ON "SolutionContributionRevision"`,
    `
      CREATE TRIGGER "SolutionContributionRevision_prevent_mutation"
      BEFORE UPDATE OR DELETE ON "SolutionContributionRevision"
      FOR EACH ROW EXECUTE FUNCTION "solution_snapshot_immutable"()
    `,
    `DROP TRIGGER IF EXISTS "SolutionReview_prevent_mutation" ON "SolutionReview"`,
    `
      CREATE TRIGGER "SolutionReview_prevent_mutation"
      BEFORE UPDATE OR DELETE ON "SolutionReview"
      FOR EACH ROW EXECUTE FUNCTION "solution_snapshot_immutable"()
    `,
    `
      CREATE OR REPLACE FUNCTION "solution_version_content_immutable"()
      RETURNS TRIGGER AS $trigger$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION '已发布题解版本不可删除';
        END IF;
        IF NEW."solutionId" IS DISTINCT FROM OLD."solutionId"
          OR NEW."version" IS DISTINCT FROM OLD."version"
          OR NEW."title" IS DISTINCT FROM OLD."title"
          OR NEW."contentMarkdown" IS DISTINCT FROM OLD."contentMarkdown"
          OR NEW."algorithmTags" IS DISTINCT FROM OLD."algorithmTags"
          OR NEW."approachKey" IS DISTINCT FROM OLD."approachKey"
          OR NEW."complexityTime" IS DISTINCT FROM OLD."complexityTime"
          OR NEW."complexityMemory" IS DISTINCT FROM OLD."complexityMemory"
          OR NEW."language" IS DISTINCT FROM OLD."language"
          OR NEW."referenceCode" IS DISTINCT FROM OLD."referenceCode"
          OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
          OR NEW."sourceUrl" IS DISTINCT FROM OLD."sourceUrl"
          OR NEW."citation" IS DISTINCT FROM OLD."citation"
          OR NEW."licenseDeclarationVersion" IS DISTINCT FROM OLD."licenseDeclarationVersion"
          OR NEW."statementSnapshot" IS DISTINCT FROM OLD."statementSnapshot"
          OR NEW."statementSnapshotHash" IS DISTINCT FROM OLD."statementSnapshotHash"
          OR NEW."verifiedTestSetGraphHash" IS DISTINCT FROM OLD."verifiedTestSetGraphHash"
          OR NEW."sourceContributionRevisionId" IS DISTINCT FROM OLD."sourceContributionRevisionId"
          OR NEW."verificationId" IS DISTINCT FROM OLD."verificationId"
          OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
          OR NEW."publishedByUserId" IS DISTINCT FROM OLD."publishedByUserId"
          OR NEW."visibilityPolicy" IS DISTINCT FROM OLD."visibilityPolicy"
          OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
          OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
          RAISE EXCEPTION '已发布题解版本内容不可修改，只能创建新版本';
        END IF;
        RETURN NEW;
      END;
      $trigger$ LANGUAGE plpgsql
    `,
    `DROP TRIGGER IF EXISTS "ProblemSolutionVersion_prevent_content_mutation" ON "ProblemSolutionVersion"`,
    `
      CREATE TRIGGER "ProblemSolutionVersion_prevent_content_mutation"
      BEFORE UPDATE OR DELETE ON "ProblemSolutionVersion"
      FOR EACH ROW EXECUTE FUNCTION "solution_version_content_immutable"()
    `,
    `
      CREATE OR REPLACE FUNCTION "blog_version_content_immutable"()
      RETURNS TRIGGER AS $trigger$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION '已发布博客版本不可删除';
        END IF;
        IF NEW."postId" IS DISTINCT FROM OLD."postId"
          OR NEW."version" IS DISTINCT FROM OLD."version"
          OR NEW."title" IS DISTINCT FROM OLD."title"
          OR NEW."summary" IS DISTINCT FROM OLD."summary"
          OR NEW."contentMarkdown" IS DISTINCT FROM OLD."contentMarkdown"
          OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
          OR NEW."sourceVersionId" IS DISTINCT FROM OLD."sourceVersionId"
          OR NEW."visibility" IS DISTINCT FROM OLD."visibility"
          OR NEW."organizationIdSnapshot" IS DISTINCT FROM OLD."organizationIdSnapshot"
          OR NEW."classificationSnapshot" IS DISTINCT FROM OLD."classificationSnapshot"
          OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
          OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
          OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt" THEN
          RAISE EXCEPTION '已发布博客版本内容不可修改，只能创建新版本';
        END IF;
        IF NEW."status" IS DISTINCT FROM OLD."status"
          AND NOT (OLD."status" = 'CURRENT' AND NEW."status" = 'SUPERSEDED') THEN
          RAISE EXCEPTION '博客版本状态只能从 CURRENT 单向变为 SUPERSEDED';
        END IF;
        RETURN NEW;
      END;
      $trigger$ LANGUAGE plpgsql
    `,
    `DROP TRIGGER IF EXISTS "BlogPostVersion_prevent_content_mutation" ON "BlogPostVersion"`,
    `
      CREATE TRIGGER "BlogPostVersion_prevent_content_mutation"
      BEFORE UPDATE OR DELETE ON "BlogPostVersion"
      FOR EACH ROW EXECUTE FUNCTION "blog_version_content_immutable"()
    `,
    `
      CREATE OR REPLACE FUNCTION "blog_reference_immutable"()
      RETURNS TRIGGER AS $trigger$
      BEGIN
        RAISE EXCEPTION '已发布博客引用不可修改或删除';
      END;
      $trigger$ LANGUAGE plpgsql
    `,
    `DROP TRIGGER IF EXISTS "BlogReference_prevent_mutation" ON "BlogReference"`,
    `
      CREATE TRIGGER "BlogReference_prevent_mutation"
      BEFORE UPDATE OR DELETE ON "BlogReference"
      FOR EACH ROW EXECUTE FUNCTION "blog_reference_immutable"()
    `,
    `
      CREATE OR REPLACE FUNCTION reject_blog_submission_snapshot_mutation()
      RETURNS trigger AS $trigger$
      BEGIN
        RAISE EXCEPTION 'BlogSubmissionSnapshot is immutable';
      END;
      $trigger$ LANGUAGE plpgsql
    `,
    `DROP TRIGGER IF EXISTS "BlogSubmissionSnapshot_no_update" ON "BlogSubmissionSnapshot"`,
    `
      CREATE TRIGGER "BlogSubmissionSnapshot_no_update"
      BEFORE UPDATE ON "BlogSubmissionSnapshot"
      FOR EACH ROW EXECUTE FUNCTION reject_blog_submission_snapshot_mutation()
    `,
    `DROP TRIGGER IF EXISTS "BlogSubmissionSnapshot_no_delete" ON "BlogSubmissionSnapshot"`,
    `
      CREATE TRIGGER "BlogSubmissionSnapshot_no_delete"
      BEFORE DELETE ON "BlogSubmissionSnapshot"
      FOR EACH ROW EXECUTE FUNCTION reject_blog_submission_snapshot_mutation()
    `,
  ]
  for (const statement of statements) await prisma.$executeRawUnsafe(statement)
}

// 测试夹具必须跟随当前 Prisma schema：User 不再直接关联 schoolId，
// 校园关系通过 OrganizationMembership 与 OrganizationTeacherProfile 表达。
async function ensurePlatformFixture() {
  await prisma.organization.upsert({
    where: { id: PLATFORM_ORGANIZATION_ID },
    create: { id: PLATFORM_ORGANIZATION_ID, name: '平台学校组织', type: 'school', status: 'active' },
    update: { status: 'active' },
  })
  await prisma.user.upsert({
    where: { id: PLATFORM_PRINCIPAL_USER_ID },
    create: {
      id: PLATFORM_PRINCIPAL_USER_ID,
      username: 'platform_principal_placeholder',
      passwordHash: 'placeholder',
      role: 'teacher',
      status: 'active',
    },
    update: { status: 'active' },
  })
  await prisma.organizationMembership.upsert({
    where: { id: PLATFORM_MEMBERSHIP_ID },
    create: {
      id: PLATFORM_MEMBERSHIP_ID,
      organizationId: PLATFORM_ORGANIZATION_ID,
      userId: PLATFORM_PRINCIPAL_USER_ID,
      memberRole: 'teacher',
      relationType: 'employee',
      status: 'active',
      joinedAt: new Date(),
    },
    update: { status: 'active' },
  })
  await prisma.school.upsert({
    where: { id: PLATFORM_SCHOOL_ID },
    create: {
      id: PLATFORM_SCHOOL_ID,
      name: '平台学校',
      organizationId: PLATFORM_ORGANIZATION_ID,
      currentPrincipalMembershipId: PLATFORM_MEMBERSHIP_ID,
      status: 'active',
      directoryStatus: 'hidden',
    },
    update: { status: 'active', directoryStatus: 'hidden', currentPrincipalMembershipId: PLATFORM_MEMBERSHIP_ID },
  })
  await prisma.organizationTeacherProfile.upsert({
    where: { membershipId: PLATFORM_MEMBERSHIP_ID },
    create: { id: 'platform-principal-profile-placeholder', membershipId: PLATFORM_MEMBERSHIP_ID, name: '平台负责人', status: 'active' },
    update: { status: 'active' },
  })
}

beforeAll(async () => {
  await prisma.$connect()
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = current_schema()
      AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `
  cleanupTableList = tables
    .map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`)
    .join(', ')
  await ensureMigrationTriggers()
  await ensurePlatformFixture()
})

afterEach(async () => {
  if (!cleanupTableList) throw new Error('Test cleanup table list was not initialized')
  // One multi-table TRUNCATE resolves all foreign-key relationships together.
  // The old per-table CASCADE loop repeatedly traversed the same 66-table graph
  // and added roughly 4.5 seconds to every test, including pure unit tests.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${cleanupTableList} RESTART IDENTITY CASCADE`)
  await ensurePlatformFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})
