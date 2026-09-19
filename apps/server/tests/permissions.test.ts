import { describe, expect, it } from 'vitest'
import {
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
      const viewer = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId! } })
      const other = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId! } })
      const req = createMockAuthRequest(viewer.user.id, 'student', school.organizationId)

      await expect(canViewStudent(req, viewer.organization!.studentProfileId!)).resolves.toBe(true)
      await expect(canViewStudent(req, other.organization!.studentProfileId!)).resolves.toBe(false)
    })

    it('allows teachers to view same-organization students but not cross-organization profiles', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal('School A')
      const { school: schoolB } = await createTestSchoolWithPrincipal('School B')
      const teacher = await createTestUser({ organization: { role: 'teacher', organizationId: schoolA.organizationId! } })
      const localStudent = await createTestUser({ organization: { role: 'student', organizationId: schoolA.organizationId! } })
      const remoteStudent = await createTestUser({ organization: { role: 'student', organizationId: schoolB.organizationId! } })
      const req = createMockAuthRequest(teacher.user.id, 'teacher', schoolA.organizationId)

      await expect(canViewStudent(req, localStudent.organization!.studentProfileId!)).resolves.toBe(true)
      await expect(canViewStudent(req, remoteStudent.organization!.studentProfileId!)).resolves.toBe(false)
    })

    it('allows principals to manage local students and teachers only their assigned students', async () => {
      const { school, principal } = await createTestSchoolWithPrincipal()
      const teacher = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const assigned = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId!, headTeacherMembershipId: teacher.organization!.membershipId } })
      const unassigned = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId! } })

      const principalReq = createMockAuthRequest(principal.userId, 'school_principal', school.organizationId)
      const teacherReq = createMockAuthRequest(teacher.user.id, 'teacher', school.organizationId)
      await expect(canManageStudent(principalReq, assigned.organization!.studentProfileId!)).resolves.toBe(true)
      await expect(canManageStudent(teacherReq, assigned.organization!.studentProfileId!)).resolves.toBe(true)
      await expect(canManageStudent(teacherReq, unassigned.organization!.studentProfileId!)).resolves.toBe(false)
    })

    it('keeps global administrators out of personal-context profile management', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const student = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId! } })
      const admin = await createTestUser({ accountRole: 'super_admin' })
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

      await expect(canManageStudent(workReq, student.organization!.studentProfileId!)).resolves.toBe(true)
      await expect(canManageStudent(personalReq, student.organization!.studentProfileId!)).resolves.toBe(false)
    })
  })

  describe('teacher profiles', () => {
    it('allows campus members to view only teachers in the active organization', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal('School A')
      const { school: schoolB } = await createTestSchoolWithPrincipal('School B')
      const student = await createTestUser({ organization: { role: 'student', organizationId: schoolA.organizationId! } })
      const localTeacher = await createTestUser({ organization: { role: 'teacher', organizationId: schoolA.organizationId! } })
      const remoteTeacher = await createTestUser({ organization: { role: 'teacher', organizationId: schoolB.organizationId! } })
      const req = createMockAuthRequest(student.user.id, 'student', schoolA.organizationId)

      await expect(canViewTeacher(req, localTeacher.organization!.teacherProfileId!)).resolves.toBe(true)
      await expect(canViewTeacher(req, remoteTeacher.organization!.teacherProfileId!)).resolves.toBe(false)
    })

    it('allows a principal to manage another local teacher but not themselves', async () => {
      const { school, principal } = await createTestSchoolWithPrincipal()
      const teacher = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const req = createMockAuthRequest(principal.userId, 'school_principal', school.organizationId)

      await expect(canManageTeacher(req, teacher.organization!.teacherProfileId!)).resolves.toBe(true)
      await expect(canManageTeacher(req, principal.teacherProfileId)).resolves.toBe(false)
    })

    it('does not grant ordinary teachers teacher-management permission', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const viewer = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const target = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const req = createMockAuthRequest(viewer.user.id, 'teacher', school.organizationId)

      await expect(canManageTeacher(req, target.organization!.teacherProfileId!)).resolves.toBe(false)
    })
  })

  describe('team scope and membership', () => {
    it('allows same-organization users to view public campus teams and rejects cross-organization access', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal('School A')
      const { school: schoolB } = await createTestSchoolWithPrincipal('School B')
      const local = await createTestUser({ organization: { role: 'student', organizationId: schoolA.organizationId! } })
      const remote = await createTestUser({ organization: { role: 'student', organizationId: schoolB.organizationId! } })
      const team = await createTestTeam({ organizationId: schoolA.organizationId!, isPublic: true })

      await expect(canViewTeam(createMockAuthRequest(local.user.id, 'student', schoolA.organizationId), team.id)).resolves.toBe(true)
      await expect(canViewTeam(createMockAuthRequest(remote.user.id, 'student', schoolB.organizationId), team.id)).resolves.toBe(false)
    })

    it('requires active membership for private teams', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const member = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId! } })
      const outsider = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId! } })
      const team = await createTestTeam({ organizationId: school.organizationId!, isPublic: false })
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
      const user = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const team = await createTestTeam({ organizationId: school.organizationId! })
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
      const user = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const admin = await createTestUser({ accountRole: 'super_admin' })
      const team = await createTestTeam({ organizationId: school.organizationId! })
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

})
