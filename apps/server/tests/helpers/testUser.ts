import { prisma } from '../../src/prisma'
import bcrypt from 'bcryptjs'
import type { UserRole } from '../../../../packages/shared/src'

const PLATFORM_SCHOOL_ID = 'platform-school-00000000'
const TEST_BCRYPT_ROUNDS = 4

interface CreateTestUserOptions {
  role?: UserRole
  username?: string
  password?: string
  schoolId?: string
  status?: 'active' | 'disabled'
  headTeacherId?: string
  rating?: number
}

interface CreatedTestUser {
  user: {
    id: string
    username: string
    passwordHash: string
    role: UserRole
    status: string
    teacherId?: string
    studentId?: string
    adminId?: string
    schoolId?: string
  }
  password: string
  teacherId?: string
  studentId?: string
  adminId?: string
  schoolId?: string
}

async function organizationIdForSchool(schoolId: string): Promise<string> {
  const school = await prisma.school.findUnique({ where: { id: schoolId } })
  if (!school) throw new Error(`Test school ${schoolId} does not exist`)
  if (school.organizationId) return school.organizationId

  const organizationId = `org-${crypto.randomUUID()}`
  await prisma.$transaction([
    prisma.organization.create({
      data: { id: organizationId, name: school.name, type: 'school', status: 'active' },
    }),
    prisma.school.update({ where: { id: school.id }, data: { organizationId } }),
  ])
  return organizationId
}

export async function createTestUser(options: CreateTestUserOptions = {}): Promise<CreatedTestUser> {
  const {
    role = 'student',
    username,
    password = 'test123456',
    status = 'active',
    headTeacherId,
    rating = 1200,
  } = options
  let schoolId = options.schoolId
  if (!schoolId && role !== 'super_admin' && role !== 'platform_admin') {
    schoolId = (await createTestSchool()).id
  }
  if (!schoolId && (role === 'super_admin' || role === 'platform_admin')) schoolId = PLATFORM_SCHOOL_ID

  const userId = crypto.randomUUID()
  const passwordHash = await bcrypt.hash(password, TEST_BCRYPT_ROUNDS)
  const user = await prisma.user.create({
    data: {
      id: userId,
      username: username || `t_${Math.random().toString(36).slice(2, 8)}`,
      passwordHash,
      role,
      status,
    },
  })

  let teacherId: string | undefined
  let studentId: string | undefined
  let adminId: string | undefined
  if (role === 'super_admin' || role === 'platform_admin') {
    adminId = user.id
  } else if (schoolId) {
    const organizationId = await organizationIdForSchool(schoolId)
    const membershipId = crypto.randomUUID()
    const memberRole = role === 'school_principal' ? 'school_principal' : role
    await prisma.organizationMembership.create({
      data: {
        id: membershipId,
        organizationId,
        userId: user.id,
        memberRole,
        relationType: role === 'student' ? 'student' : 'employee',
        status: 'active',
        joinedAt: new Date(),
      },
    })

    if (role === 'student') {
      const headTeacherMembership = headTeacherId
        ? await prisma.organizationMembership.findFirst({
            where: { organizationId, userId: headTeacherId, status: 'active' },
            select: { id: true },
          })
        : null
      await prisma.organizationStudentProfile.create({
        data: {
          id: crypto.randomUUID(),
          membershipId,
          name: 'Test student',
          rating,
          headTeacherMembershipId: headTeacherMembership?.id || null,
          status: 'active',
        },
      })
      studentId = user.id
    } else {
      await prisma.organizationTeacherProfile.create({
        data: {
          id: crypto.randomUUID(),
          membershipId,
          name: `Test ${role}`,
          status: 'active',
        },
      })
      teacherId = user.id
      if (role === 'school_principal') {
        await prisma.school.update({ where: { id: schoolId }, data: { currentPrincipalMembershipId: membershipId } })
      }
    }
  }

  return {
    user: {
      id: user.id,
      username: user.username,
      passwordHash,
      role: user.role as UserRole,
      status: user.status,
      teacherId,
      studentId,
      adminId,
      schoolId,
    },
    password,
    teacherId,
    studentId,
    adminId,
    schoolId,
  }
}

export async function createTestSchool(options: { name?: string; principalTeacherId?: string } = {}) {
  const idSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const organizationId = `org-test-${idSuffix}`
  const schoolId = `school-test-${idSuffix}`
  const name = options.name || `测试学校_${idSuffix}`

  await prisma.organization.create({
    data: { id: organizationId, name, type: 'school', status: 'active' },
  })
  const school = await prisma.school.create({
    data: { id: schoolId, name, organizationId, status: 'active' },
  })

  if (options.principalTeacherId) {
    const membership = await prisma.organizationMembership.findFirst({
      where: { organizationId, userId: options.principalTeacherId, status: 'active' },
      select: { id: true },
    })
    if (membership) {
      return prisma.school.update({
        where: { id: school.id },
        data: { currentPrincipalMembershipId: membership.id },
      })
    }
  }
  return school
}

export async function createTestSchoolWithPrincipal(schoolName?: string) {
  const school = await createTestSchool({ name: schoolName })
  const principalUser = await createTestUser({ role: 'school_principal', schoolId: school.id })
  return {
    school,
    principal: {
      userId: principalUser.user.id,
      teacherId: principalUser.teacherId!,
      username: principalUser.user.username,
    },
  }
}

export async function createTestTeam(options: {
  name?: string
  schoolId: string | null
  ownerId?: string
  ownerType?: 'teacher' | 'student' | 'user'
  isPublic?: boolean
  scope?: 'campus' | 'personal'
} = { schoolId: '' }) {
  const {
    name,
    schoolId,
    ownerId,
    ownerType = 'teacher',
    isPublic = true,
    scope = 'campus',
  } = options
  const organizationId = schoolId ? await organizationIdForSchool(schoolId) : null
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
