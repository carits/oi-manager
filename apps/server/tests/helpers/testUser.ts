import bcrypt from 'bcryptjs'
import type { AccountRole, OrganizationMembershipRole } from '../../../../packages/contracts/src'
import { prisma } from '../../src/prisma'

const TEST_BCRYPT_ROUNDS = 4

interface TestOrganizationMembershipOptions {
  role: OrganizationMembershipRole
  organizationId?: string
  headTeacherMembershipId?: string
  rating?: number
}

interface CreateTestUserOptions {
  accountRole?: AccountRole
  username?: string
  password?: string
  status?: 'active' | 'disabled'
  organization?: TestOrganizationMembershipOptions
}

interface CreatedTestUser {
  user: {
    id: string
    username: string
    passwordHash: string
    accountRole: AccountRole
    status: string
  }
  userId: string
  password: string
  accountRole: AccountRole
  organization: {
    organizationId: string
    membershipId: string
    role: OrganizationMembershipRole
    teacherProfileId?: string
    studentProfileId?: string
  } | null
}

export async function createTestUser(options: CreateTestUserOptions = {}): Promise<CreatedTestUser> {
  const {
    accountRole = 'user',
    username,
    password = 'test123456',
    status = 'active',
    organization,
  } = options

  const userId = crypto.randomUUID()
  const passwordHash = await bcrypt.hash(password, TEST_BCRYPT_ROUNDS)
  const user = await prisma.user.create({
    data: {
      id: userId,
      username: username || `t_${Math.random().toString(36).slice(2, 8)}`,
      passwordHash,
      role: accountRole,
      status,
    },
  })

  let organizationFixture: CreatedTestUser['organization'] = null
  if (organization) {
    const organizationId = organization.organizationId || (await createTestSchool()).organizationId!
    const membershipId = crypto.randomUUID()
    await prisma.organizationMembership.create({
      data: {
        id: membershipId,
        organizationId,
        userId: user.id,
        memberRole: organization.role,
        relationType: organization.role === 'student' ? 'enrolled' : 'employee',
        status: 'active',
        joinedAt: new Date(),
        RoleAssignments: {
          create: { id: crypto.randomUUID(), roleKey: organization.role, source: 'test_fixture' },
        },
      },
    })

    let teacherProfileId: string | undefined
    let studentProfileId: string | undefined
    if (organization.role === 'student') {
      const profile = await prisma.organizationStudentProfile.create({
        data: {
          id: crypto.randomUUID(),
          membershipId,
          name: 'Test student',
          rating: organization.rating ?? 1200,
          headTeacherMembershipId: organization.headTeacherMembershipId || null,
          status: 'active',
        },
      })
      studentProfileId = profile.id
    } else {
      const profile = await prisma.organizationTeacherProfile.create({
        data: {
          id: crypto.randomUUID(),
          membershipId,
          name: `Test ${organization.role}`,
          status: 'active',
        },
      })
      teacherProfileId = profile.id
      if (organization.role === 'school_principal') {
        await prisma.school.update({
          where: { organizationId },
          data: { currentPrincipalMembershipId: membershipId },
        })
      }
    }

    organizationFixture = {
      organizationId,
      membershipId,
      role: organization.role,
      teacherProfileId,
      studentProfileId,
    }
  }

  return {
    user: {
      id: user.id,
      username: user.username,
      passwordHash,
      accountRole: user.role as AccountRole,
      status: user.status,
    },
    userId: user.id,
    password,
    accountRole,
    organization: organizationFixture,
  }
}

export async function createTestSchool(options: { name?: string; principalMembershipId?: string } = {}) {
  const idSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const organizationId = `org-test-${idSuffix}`
  const schoolId = `school-test-${idSuffix}`
  const name = options.name || `测试学校_${idSuffix}`

  await prisma.organization.create({
    data: { id: organizationId, name, type: 'school', status: 'active' },
  })
  const school = await prisma.school.create({
    data: { id: schoolId, name, organizationId, status: 'active', directoryStatus: 'verified' },
  })

  if (options.principalMembershipId) {
    return prisma.school.update({
      where: { id: school.id },
      data: { currentPrincipalMembershipId: options.principalMembershipId },
    })
  }
  return school
}

export async function createTestSchoolWithPrincipal(schoolName?: string) {
  const school = await createTestSchool({ name: schoolName })
  const principalUser = await createTestUser({
    organization: { role: 'school_principal', organizationId: school.organizationId! },
  })
  return {
    school,
    principal: {
      userId: principalUser.userId,
      membershipId: principalUser.organization!.membershipId,
      teacherProfileId: principalUser.organization!.teacherProfileId!,
      username: principalUser.user.username,
    },
  }
}

export async function createTestTeam(options: {
  name?: string
  organizationId: string | null
  ownerId?: string
  ownerType?: 'teacher' | 'student' | 'user'
  isPublic?: boolean
  scope?: 'campus' | 'personal'
} = { organizationId: null }) {
  const {
    name,
    organizationId,
    ownerId,
    ownerType = 'teacher',
    isPublic = true,
    scope = 'campus',
  } = options
  const team = await prisma.team.create({
    data: {
      id: `team_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name || `测试团队_${Date.now()}`,
      organizationId,
      scope,
      isPublic,
    },
  })

  if (ownerId) {
    await prisma.teamMember.create({
      data: {
        id: crypto.randomUUID(),
        teamId: team.id,
        userId: ownerId,
        userType: ownerType,
        role: 'owner',
        status: 'active',
        joinedAt: new Date(),
      },
    })
  }
  return team
}
