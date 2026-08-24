import { describe, expect, it } from 'vitest'
import {
  canAccessProblemBank,
  canManageStudent,
  canManageTeacher,
  canManageTeam,
  canViewStudent,
  canViewTeacher,
  canViewTeam,
} from '../src/middleware/permissions'
import { prisma } from '../src/prisma'
import type { AuthRequest } from '../src/middleware/auth'
import { createTestSchoolWithPrincipal, createTestTeam, createTestUser } from './helpers/testUser'

function createMockAuthRequest(
  userId: string,
  role: string,
  organizationId?: string | null,
  workspaceMode: 'work' | 'personal' = organizationId ? 'work' : 'personal',
): AuthRequest {
  return {
    user: {
      userId,
      role,
      username: 'test',
      workspaceMode,
      ...(organizationId ? { organizationId } : {}),
    },
    headers: {},
    get: () => '',
    header: () => '',
  } as unknown as AuthRequest
}

describe('current organization permission model', () => {
  describe('student profiles', () => {
    it('allows a student to view only their own profile in the active organization', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const viewer = await createTestUser({ role: 'student', schoolId: school.id })
      const other = await createTestUser({ role: 'student', schoolId: school.id })
      const req = createMockAuthRequest(viewer.user.id, 'student', school.organizationId)

      await expect(canViewStudent(req, viewer.studentProfileId!)).resolves.toBe(true)
      await expect(canViewStudent(req, other.studentProfileId!)).resolves.toBe(false)
    })

    it('allows teachers to view same-organization students but not cross-organization profiles', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal('School A')
      const { school: schoolB } = await createTestSchoolWithPrincipal('School B')
      const teacher = await createTestUser({ role: 'teacher', schoolId: schoolA.id })
      const localStudent = await createTestUser({ role: 'student', schoolId: schoolA.id })
      const remoteStudent = await createTestUser({ role: 'student', schoolId: schoolB.id })
      const req = createMockAuthRequest(teacher.user.id, 'teacher', schoolA.organizationId)

      await expect(canViewStudent(req, localStudent.studentProfileId!)).resolves.toBe(true)
      await expect(canViewStudent(req, remoteStudent.studentProfileId!)).resolves.toBe(false)
    })

    it('allows principals to manage local students and teachers only their assigned students', async () => {
      const { school, principal } = await createTestSchoolWithPrincipal()
      const teacher = await createTestUser({ role: 'teacher', schoolId: school.id })
      const assigned = await createTestUser({ role: 'student', schoolId: school.id, headTeacherId: teacher.user.id })
      const unassigned = await createTestUser({ role: 'student', schoolId: school.id })

      const principalReq = createMockAuthRequest(principal.userId, 'school_principal', school.organizationId)
      const teacherReq = createMockAuthRequest(teacher.user.id, 'teacher', school.organizationId)
      await expect(canManageStudent(principalReq, assigned.studentProfileId!)).resolves.toBe(true)
      await expect(canManageStudent(teacherReq, assigned.studentProfileId!)).resolves.toBe(true)
      await expect(canManageStudent(teacherReq, unassigned.studentProfileId!)).resolves.toBe(false)
    })

    it('keeps global administrators out of personal-context profile management', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const student = await createTestUser({ role: 'student', schoolId: school.id })
      const admin = await createTestUser({ role: 'super_admin' })
      await prisma.organizationMembership.create({
        data: {
          id: crypto.randomUUID(),
          organizationId: school.organizationId!,
          userId: admin.user.id,
          memberRole: 'teacher',
          relationType: 'employee',
          status: 'active',
          joinedAt: new Date(),
        },
      })
      const workReq = createMockAuthRequest(admin.user.id, 'super_admin', school.organizationId)
      const personalReq = createMockAuthRequest(admin.user.id, 'super_admin', null, 'personal')

      await expect(canManageStudent(workReq, student.studentProfileId!)).resolves.toBe(true)
      await expect(canManageStudent(personalReq, student.studentProfileId!)).resolves.toBe(false)
    })
  })

  describe('teacher profiles', () => {
    it('allows campus members to view only teachers in the active organization', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal('School A')
      const { school: schoolB } = await createTestSchoolWithPrincipal('School B')
      const student = await createTestUser({ role: 'student', schoolId: schoolA.id })
      const localTeacher = await createTestUser({ role: 'teacher', schoolId: schoolA.id })
      const remoteTeacher = await createTestUser({ role: 'teacher', schoolId: schoolB.id })
      const req = createMockAuthRequest(student.user.id, 'student', schoolA.organizationId)

      await expect(canViewTeacher(req, localTeacher.teacherProfileId!)).resolves.toBe(true)
      await expect(canViewTeacher(req, remoteTeacher.teacherProfileId!)).resolves.toBe(false)
    })

    it('allows a principal to manage another local teacher but not themselves', async () => {
      const { school, principal } = await createTestSchoolWithPrincipal()
      const teacher = await createTestUser({ role: 'teacher', schoolId: school.id })
      const req = createMockAuthRequest(principal.userId, 'school_principal', school.organizationId)

      await expect(canManageTeacher(req, teacher.teacherProfileId!)).resolves.toBe(true)
      await expect(canManageTeacher(req, principal.teacherProfileId)).resolves.toBe(false)
    })

    it('does not grant ordinary teachers teacher-management permission', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const viewer = await createTestUser({ role: 'teacher', schoolId: school.id })
      const target = await createTestUser({ role: 'teacher', schoolId: school.id })
      const req = createMockAuthRequest(viewer.user.id, 'teacher', school.organizationId)

      await expect(canManageTeacher(req, target.teacherProfileId!)).resolves.toBe(false)
    })
  })

  describe('team scope and membership', () => {
    it('allows same-organization users to view public campus teams and rejects cross-organization access', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal('School A')
      const { school: schoolB } = await createTestSchoolWithPrincipal('School B')
      const local = await createTestUser({ role: 'student', schoolId: schoolA.id })
      const remote = await createTestUser({ role: 'student', schoolId: schoolB.id })
      const team = await createTestTeam({ schoolId: schoolA.id, isPublic: true })

      await expect(canViewTeam(createMockAuthRequest(local.user.id, 'student', schoolA.organizationId), team.id)).resolves.toBe(true)
      await expect(canViewTeam(createMockAuthRequest(remote.user.id, 'student', schoolB.organizationId), team.id)).resolves.toBe(false)
    })

    it('requires active membership for private teams', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const member = await createTestUser({ role: 'student', schoolId: school.id })
      const outsider = await createTestUser({ role: 'student', schoolId: school.id })
      const team = await createTestTeam({ schoolId: school.id, isPublic: false })
      await prisma.teamMember.create({
        data: {
          id: crypto.randomUUID(),
          teamId: team.id,
          userId: member.user.id,
          userType: 'student',
          role: 'member',
          status: 'active',
          joinedAt: new Date(),
        },
      })

      await expect(canViewTeam(createMockAuthRequest(member.user.id, 'student', school.organizationId), team.id)).resolves.toBe(true)
      await expect(canViewTeam(createMockAuthRequest(outsider.user.id, 'student', school.organizationId), team.id)).resolves.toBe(false)
    })

    it.each(['owner', 'admin'] as const)('allows a team %s to manage the campus team', async role => {
      const { school } = await createTestSchoolWithPrincipal()
      const user = await createTestUser({ role: 'teacher', schoolId: school.id })
      const team = await createTestTeam({ schoolId: school.id })
      await prisma.teamMember.create({
        data: {
          id: crypto.randomUUID(),
          teamId: team.id,
          userId: user.user.id,
          userType: 'teacher',
          role,
          status: 'active',
          joinedAt: new Date(),
        },
      })

      await expect(canManageTeam(createMockAuthRequest(user.user.id, 'teacher', school.organizationId), team.id)).resolves.toBe(true)
    })

    it('rejects regular members, personal contexts and organization-less administrators', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const user = await createTestUser({ role: 'teacher', schoolId: school.id })
      const admin = await createTestUser({ role: 'super_admin' })
      const team = await createTestTeam({ schoolId: school.id })
      await prisma.teamMember.create({
        data: {
          id: crypto.randomUUID(),
          teamId: team.id,
          userId: user.user.id,
          userType: 'teacher',
          role: 'member',
          status: 'active',
          joinedAt: new Date(),
        },
      })

      await expect(canManageTeam(createMockAuthRequest(user.user.id, 'teacher', school.organizationId), team.id)).resolves.toBe(false)
      await expect(canViewTeam(createMockAuthRequest(user.user.id, 'teacher', null, 'personal'), team.id)).resolves.toBe(false)
      await expect(canManageTeam(createMockAuthRequest(admin.user.id, 'super_admin', null, 'work'), team.id)).resolves.toBe(false)
    })
  })

  it('keeps students out of the problem bank while allowing staff and administrators', () => {
    expect(canAccessProblemBank('student')).toBe(false)
    expect(canAccessProblemBank('teacher')).toBe(true)
    expect(canAccessProblemBank('school_principal')).toBe(true)
    expect(canAccessProblemBank('platform_admin')).toBe(true)
    expect(canAccessProblemBank('super_admin')).toBe(true)
  })
})
