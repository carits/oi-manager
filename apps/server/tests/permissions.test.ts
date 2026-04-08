import { describe, it, expect, beforeEach } from 'vitest'
import {
  canAccessSchool,
  canManageSchool,
  canViewStudent,
  canManageStudent,
  canViewTeacher,
  canManageTeacher,
  canViewTeam,
  canManageTeam
} from '../src/middleware/permissions'
import { createTestUser, createTestSchoolWithPrincipal, createTestTeam } from './helpers/testUser'
import { prisma } from '../src/prisma'
import type { AuthRequest } from '../src/middleware/auth'

// 创建模拟的 AuthRequest
function createMockAuthRequest(userId: string, role: string): AuthRequest {
  return {
    user: { userId, role: role as any, username: 'test' },
    headers: {},
    get: () => '',
    header: () => ''
  } as unknown as AuthRequest
}

describe('Permissions Module', () => {
  describe('canAccessSchool', () => {
    it('should allow super_admin to access any school', async () => {
      const { user } = await createTestUser({ role: 'super_admin' })
      const { school } = await createTestSchoolWithPrincipal()

      const req = createMockAuthRequest(user.id, 'super_admin')
      const result = await canAccessSchool(req, school.id)

      expect(result).toBe(true)
    })

    it('should allow platform_admin to access any school', async () => {
      const { user } = await createTestUser({ role: 'platform_admin' })
      const { school } = await createTestSchoolWithPrincipal()

      const req = createMockAuthRequest(user.id, 'platform_admin')
      const result = await canAccessSchool(req, school.id)

      expect(result).toBe(true)
    })

    it('should allow school_principal to access their own school', async () => {
      const { school, principal } = await createTestSchoolWithPrincipal()

      const req = createMockAuthRequest(principal.userId, 'school_principal')
      const result = await canAccessSchool(req, school.id)

      expect(result).toBe(true)
    })

    it('should deny school_principal from accessing other school', async () => {
      const { principal } = await createTestSchoolWithPrincipal('School A')
      const { school: otherSchool } = await createTestSchoolWithPrincipal('School B')

      const req = createMockAuthRequest(principal.userId, 'school_principal')
      const result = await canAccessSchool(req, otherSchool.id)

      expect(result).toBe(false)
    })

    it('should allow teacher to access their own school', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const req = createMockAuthRequest(user.id, 'teacher')
      const result = await canAccessSchool(req, school.id)

      expect(result).toBe(true)
    })

    it('should deny teacher from accessing other school', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal('School A')
      const { school: schoolB } = await createTestSchoolWithPrincipal('School B')
      const { user } = await createTestUser({ role: 'teacher', schoolId: schoolA.id })

      const req = createMockAuthRequest(user.id, 'teacher')
      const result = await canAccessSchool(req, schoolB.id)

      expect(result).toBe(false)
    })
  })

  describe('canManageSchool', () => {
    it('should allow super_admin to manage any school', async () => {
      const { user } = await createTestUser({ role: 'super_admin' })
      const { school } = await createTestSchoolWithPrincipal()

      const req = createMockAuthRequest(user.id, 'super_admin')
      const result = await canManageSchool(req, school.id)

      expect(result).toBe(true)
    })

    it('should allow school_principal to manage their own school', async () => {
      const { school, principal } = await createTestSchoolWithPrincipal()

      const req = createMockAuthRequest(principal.userId, 'school_principal')
      const result = await canManageSchool(req, school.id)

      expect(result).toBe(true)
    })

    it('should deny school_principal from managing other school', async () => {
      const { principal } = await createTestSchoolWithPrincipal('School A')
      const { school: otherSchool } = await createTestSchoolWithPrincipal('School B')

      const req = createMockAuthRequest(principal.userId, 'school_principal')
      const result = await canManageSchool(req, otherSchool.id)

      expect(result).toBe(false)
    })

    it('should deny teacher from managing any school', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const req = createMockAuthRequest(user.id, 'teacher')
      const result = await canManageSchool(req, school.id)

      expect(result).toBe(false)
    })

    it('should deny student from managing any school', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user } = await createTestUser({ role: 'student', schoolId: school.id })

      const req = createMockAuthRequest(user.id, 'student')
      const result = await canManageSchool(req, school.id)

      expect(result).toBe(false)
    })
  })

  describe('canViewStudent', () => {
    it('should allow super_admin to view any student', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const { school } = await createTestSchoolWithPrincipal()
      const { user: studentUser, studentId } = await createTestUser({ role: 'student', schoolId: school.id })

      const req = createMockAuthRequest(admin.id, 'super_admin')
      const result = await canViewStudent(req, studentId!)

      expect(result).toBe(true)
    })

    it('should allow student to view themselves', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user, studentId } = await createTestUser({ role: 'student', schoolId: school.id })

      const req = createMockAuthRequest(user.id, 'student')
      const result = await canViewStudent(req, studentId!)

      expect(result).toBe(true)
    })

    it('should deny student from viewing other student', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: viewer } = await createTestUser({ role: 'student', schoolId: school.id })
      const { studentId } = await createTestUser({ role: 'student', schoolId: school.id })

      const req = createMockAuthRequest(viewer.id, 'student')
      const result = await canViewStudent(req, studentId!)

      expect(result).toBe(false)
    })

    it('should allow teacher to view student from same school', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacherUser } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { studentId } = await createTestUser({ role: 'student', schoolId: school.id })

      const req = createMockAuthRequest(teacherUser.id, 'teacher')
      const result = await canViewStudent(req, studentId!)

      expect(result).toBe(true)
    })

    it('should deny teacher from viewing student from other school', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal('School A')
      const { school: schoolB } = await createTestSchoolWithPrincipal('School B')
      const { user: teacherUser } = await createTestUser({ role: 'teacher', schoolId: schoolA.id })
      const { studentId } = await createTestUser({ role: 'student', schoolId: schoolB.id })

      const req = createMockAuthRequest(teacherUser.id, 'teacher')
      const result = await canViewStudent(req, studentId!)

      expect(result).toBe(false)
    })
  })

  describe('canManageStudent', () => {
    it('should allow super_admin to manage any student', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const { school } = await createTestSchoolWithPrincipal()
      const { studentId } = await createTestUser({ role: 'student', schoolId: school.id })

      const req = createMockAuthRequest(admin.id, 'super_admin')
      const result = await canManageStudent(req, studentId!)

      expect(result).toBe(true)
    })

    it('should deny student from managing other student', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: viewer } = await createTestUser({ role: 'student', schoolId: school.id })
      const { studentId } = await createTestUser({ role: 'student', schoolId: school.id })

      const req = createMockAuthRequest(viewer.id, 'student')
      const result = await canManageStudent(req, studentId!)

      expect(result).toBe(false)
    })

    it('should allow school_principal to manage student from same school', async () => {
      const { school, principal } = await createTestSchoolWithPrincipal()
      const { studentId } = await createTestUser({ role: 'student', schoolId: school.id })

      const req = createMockAuthRequest(principal.userId, 'school_principal')
      const result = await canManageStudent(req, studentId!)

      expect(result).toBe(true)
    })

    it('should allow teacher to manage student from same school', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacherUser, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { studentId } = await createTestUser({ role: 'student', schoolId: school.id, headTeacherId: teacherId })

      const req = createMockAuthRequest(teacherUser.id, 'teacher')
      const result = await canManageStudent(req, studentId!)

      expect(result).toBe(true)
    })
  })

  describe('canViewTeacher', () => {
    it('should allow super_admin to view any teacher', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacherUser, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const req = createMockAuthRequest(admin.id, 'super_admin')
      const result = await canViewTeacher(req, teacherId!)

      expect(result).toBe(true)
    })

    it('should allow teacher to view teacher from same school', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: viewer } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const req = createMockAuthRequest(viewer.id, 'teacher')
      const result = await canViewTeacher(req, teacherId!)

      expect(result).toBe(true)
    })

    it('should deny teacher from viewing teacher from other school', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal('School A')
      const { school: schoolB } = await createTestSchoolWithPrincipal('School B')
      const { user: viewer } = await createTestUser({ role: 'teacher', schoolId: schoolA.id })
      const { teacherId } = await createTestUser({ role: 'teacher', schoolId: schoolB.id })

      const req = createMockAuthRequest(viewer.id, 'teacher')
      const result = await canViewTeacher(req, teacherId!)

      expect(result).toBe(false)
    })
  })

  describe('canManageTeacher', () => {
    it('should allow super_admin to manage any teacher', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacherUser, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const req = createMockAuthRequest(admin.id, 'super_admin')
      const result = await canManageTeacher(req, teacherId!)

      expect(result).toBe(true)
    })

    it('should allow school_principal to manage teacher from same school', async () => {
      const { school, principal } = await createTestSchoolWithPrincipal()
      const { teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const req = createMockAuthRequest(principal.userId, 'school_principal')
      const result = await canManageTeacher(req, teacherId!)

      expect(result).toBe(true)
    })

    it('should deny school_principal from managing themselves', async () => {
      const { principal } = await createTestSchoolWithPrincipal()

      const req = createMockAuthRequest(principal.userId, 'school_principal')
      const result = await canManageTeacher(req, principal.teacherId)

      expect(result).toBe(false)
    })

    it('should deny teacher from managing other teacher', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: viewer } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const req = createMockAuthRequest(viewer.id, 'teacher')
      const result = await canManageTeacher(req, teacherId!)

      expect(result).toBe(false)
    })
  })

  describe('canViewTeam', () => {
    it('should allow super_admin to view any team', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const { school } = await createTestSchoolWithPrincipal()
      const team = await createTestTeam({ schoolId: school.id, isPublic: false })

      const req = createMockAuthRequest(admin.id, 'super_admin')
      const result = await canViewTeam(req, team.id)

      expect(result).toBe(true)
    })

    it('should allow school user to view public team', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user } = await createTestUser({ role: 'student', schoolId: school.id })
      const team = await createTestTeam({ schoolId: school.id, isPublic: true })

      const req = createMockAuthRequest(user.id, 'student')
      const result = await canViewTeam(req, team.id)

      expect(result).toBe(true)
    })

    it('should deny non-member from viewing private team', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user } = await createTestUser({ role: 'student', schoolId: school.id })
      const team = await createTestTeam({ schoolId: school.id, isPublic: false })

      const req = createMockAuthRequest(user.id, 'student')
      const result = await canViewTeam(req, team.id)

      expect(result).toBe(false)
    })

    it('should allow member to view private team', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user, studentId } = await createTestUser({ role: 'student', schoolId: school.id })
      const team = await createTestTeam({ schoolId: school.id, isPublic: false })

      // Add user as team member
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: studentId!,
          userType: 'student',
          role: 'member',
          status: 'active',
          joinedAt: new Date()
        }
      })

      const req = createMockAuthRequest(user.id, 'student')
      const result = await canViewTeam(req, team.id)

      expect(result).toBe(true)
    })
  })

  describe('canManageTeam', () => {
    it('should allow super_admin to manage any team', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const { school } = await createTestSchoolWithPrincipal()
      const team = await createTestTeam({ schoolId: school.id })

      const req = createMockAuthRequest(admin.id, 'super_admin')
      const result = await canManageTeam(req, team.id)

      expect(result).toBe(true)
    })

    it('should allow team owner to manage team', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const team = await createTestTeam({ schoolId: school.id })

      // Add user as team owner
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: teacherId!,
          userType: 'teacher',
          role: 'owner',
          status: 'active',
          joinedAt: new Date()
        }
      })

      const req = createMockAuthRequest(user.id, 'teacher')
      const result = await canManageTeam(req, team.id)

      expect(result).toBe(true)
    })

    it('should allow team admin to manage team', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const team = await createTestTeam({ schoolId: school.id })

      // Add user as team admin
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: teacherId!,
          userType: 'teacher',
          role: 'admin',
          status: 'active',
          joinedAt: new Date()
        }
      })

      const req = createMockAuthRequest(user.id, 'teacher')
      const result = await canManageTeam(req, team.id)

      expect(result).toBe(true)
    })

    it('should deny regular member from managing team', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const team = await createTestTeam({ schoolId: school.id })

      // Add user as regular member
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: teacherId!,
          userType: 'teacher',
          role: 'member',
          status: 'active',
          joinedAt: new Date()
        }
      })

      const req = createMockAuthRequest(user.id, 'teacher')
      const result = await canManageTeam(req, team.id)

      expect(result).toBe(false)
    })
  })
})