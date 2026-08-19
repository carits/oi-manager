import { beforeAll, afterAll, afterEach } from 'vitest'
import { prisma } from '../src/prisma'

const PLATFORM_ORGANIZATION_ID = 'platform-organization-00000000'
const PLATFORM_SCHOOL_ID = 'platform-school-00000000'
const PLATFORM_PRINCIPAL_USER_ID = 'platform-principal-user-placeholder'
const PLATFORM_MEMBERSHIP_ID = 'platform-principal-membership-placeholder'

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
    },
    update: { status: 'active', currentPrincipalMembershipId: PLATFORM_MEMBERSHIP_ID },
  })
  await prisma.organizationTeacherProfile.upsert({
    where: { membershipId: PLATFORM_MEMBERSHIP_ID },
    create: { id: 'platform-principal-profile-placeholder', membershipId: PLATFORM_MEMBERSHIP_ID, name: '平台负责人', status: 'active' },
    update: { status: 'active' },
  })
}

beforeAll(async () => {
  await prisma.$connect()
  await ensurePlatformFixture()
})

afterEach(async () => {
  const cleanupSql = [
    'DO $$',
    'DECLARE table_record RECORD;',
    'BEGIN',
    '  FOR table_record IN',
    '    SELECT tablename FROM pg_tables',
    '    WHERE schemaname = current_schema() AND tablename <> \'_prisma_migrations\'',
    '  LOOP',
    '    EXECUTE format(\'TRUNCATE TABLE %I.%I CASCADE\', current_schema(), table_record.tablename);',
    '  END LOOP;',
    'END $$;',
  ].join('\n')
  await prisma.$executeRawUnsafe(cleanupSql)
  await ensurePlatformFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})
