import { beforeAll, afterAll, afterEach } from 'vitest'
import { prisma } from '../src/prisma'

const PLATFORM_ORGANIZATION_ID = 'platform-organization-00000000'
const PLATFORM_SCHOOL_ID = 'platform-school-00000000'
const PLATFORM_PRINCIPAL_USER_ID = 'platform-principal-user-placeholder'
const PLATFORM_MEMBERSHIP_ID = 'platform-principal-membership-placeholder'
let cleanupTableList = ''

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
