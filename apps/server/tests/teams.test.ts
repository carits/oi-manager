import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers/testRequest'
import { createTestUser, createTestSchoolWithPrincipal, createTestTeam } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { prisma } from '../src/prisma'

const app = createTestApp()
const shortId = () => Math.random().toString(36).slice(2, 8)

describe('Team Operations', () => {
  describe('Team Creation', () => {
    it('should create a new team successfully', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacher, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const token = generateTestToken({
        userId: teacher.id,
        role: 'teacher',
        username: teacher.username,
        teacherId,
        schoolId: school.id
      })

      const res = await request(app)
        .post('/api/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({
          id: `team_${shortId()}`,
          name: `测试团队_${Date.now()}`,
          schoolId: school.id,
          isPublic: true
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.name).toBeDefined()
    })

    it('should require authentication to create team', async () => {
      const { school } = await createTestSchoolWithPrincipal()

      const res = await request(app)
        .post('/api/teams')
        .send({
          name: '测试团队',
          schoolId: school.id
        })

      expect(res.status).toBe(401)
    })

    it('should not create team without name', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacher, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const token = generateTestToken({
        userId: teacher.id,
        role: 'teacher',
        username: teacher.username,
        teacherId,
        schoolId: school.id
      })

      const res = await request(app)
        .post('/api/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({
          schoolId: school.id
        })

      expect(res.status).toBe(400)
    })
  })

  describe('Team Member Management', () => {
    it('should add teacher member to team', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, teacherId: ownerId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { user: newMember, teacherId: newMemberId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const team = await createTestTeam({ schoolId: school.id, ownerId })

      const token = generateTestToken({
        userId: owner.id,
        role: 'teacher',
        username: owner.username,
        teacherId: ownerId,
        schoolId: school.id
      })

      const res = await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          members: [{ userId: newMemberId, userType: 'teacher' }],
          role: 'member'
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify member was added
      const member = await prisma.teamMember.findFirst({
        where: { teamId: team.id, userId: newMemberId, userType: 'teacher' }
      })
      expect(member).not.toBeNull()
    })

    it('should add student member to team', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, teacherId: ownerId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { user: newMember, studentId: newMemberId } = await createTestUser({ role: 'student', schoolId: school.id })

      const team = await createTestTeam({ schoolId: school.id, ownerId })

      const token = generateTestToken({
        userId: owner.id,
        role: 'teacher',
        username: owner.username,
        teacherId: ownerId,
        schoolId: school.id
      })

      const res = await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          members: [{ userId: newMemberId, userType: 'student' }],
          role: 'member'
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should remove member from team', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, teacherId: ownerId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { user: member, studentId: memberId } = await createTestUser({ role: 'student', schoolId: school.id })

      const team = await createTestTeam({ schoolId: school.id, ownerId })

      // Add member first
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: memberId!,
          userType: 'student',
          role: 'member',
          status: 'active',
          joinedAt: new Date()
        }
      })

      const token = generateTestToken({
        userId: owner.id,
        role: 'teacher',
        username: owner.username,
        teacherId: ownerId,
        schoolId: school.id
      })

      const res = await request(app)
        .delete(`/api/teams/${team.id}/members/${memberId}?memberType=student`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify member was removed
      const removedMember = await prisma.teamMember.findFirst({
        where: { teamId: team.id, userId: memberId, userType: 'student' }
      })
      expect(removedMember).toBeNull()
    })

    it('should deny non-admin from adding members', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, teacherId: ownerId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { user: regularMember, teacherId: regularMemberId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { teacherId: newMemberId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const team = await createTestTeam({ schoolId: school.id, ownerId })

      // Add regular member (not admin)
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: regularMemberId!,
          userType: 'teacher',
          role: 'member',
          status: 'active',
          joinedAt: new Date()
        }
      })

      const token = generateTestToken({
        userId: regularMember.id,
        role: 'teacher',
        username: regularMember.username,
        teacherId: regularMemberId,
        schoolId: school.id
      })

      const res = await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          members: [{ userId: newMemberId, userType: 'teacher' }],
          role: 'member'
        })

      expect(res.status).toBe(403)
    })
  })

  describe('Team Role Management', () => {
    it('should change member role to admin', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, teacherId: ownerId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { user: member, teacherId: memberId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const team = await createTestTeam({ schoolId: school.id, ownerId })

      // Add member first
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: memberId!,
          userType: 'teacher',
          role: 'member',
          status: 'active',
          joinedAt: new Date()
        }
      })

      const token = generateTestToken({
        userId: owner.id,
        role: 'teacher',
        username: owner.username,
        teacherId: ownerId,
        schoolId: school.id
      })

      const res = await request(app)
        .post(`/api/teams/${team.id}/admins`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          memberId: memberId,
          memberType: 'teacher'
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify role was changed
      const updatedMember = await prisma.teamMember.findFirst({
        where: { teamId: team.id, userId: memberId, userType: 'teacher' }
      })
      expect(updatedMember!.role).toBe('admin')
    })
  })

  describe('Team Ownership Transfer', () => {
    it('should transfer ownership to another member', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, teacherId: ownerId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { user: newOwner, teacherId: newOwnerId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const team = await createTestTeam({ schoolId: school.id, ownerId })

      // Add new owner as member first
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: newOwnerId!,
          userType: 'teacher',
          role: 'member',
          status: 'active',
          joinedAt: new Date()
        }
      })

      const token = generateTestToken({
        userId: owner.id,
        role: 'teacher',
        username: owner.username,
        teacherId: ownerId,
        schoolId: school.id
      })

      const res = await request(app)
        .post(`/api/teams/${team.id}/transfer`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          newOwnerId: newOwnerId,
          newOwnerType: 'teacher'
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify ownership was transferred
      const newOwnerMember = await prisma.teamMember.findFirst({
        where: { teamId: team.id, userId: newOwnerId, userType: 'teacher' }
      })
      expect(newOwnerMember!.role).toBe('owner')

      const oldOwnerMember = await prisma.teamMember.findFirst({
        where: { teamId: team.id, userId: ownerId, userType: 'teacher' }
      })
      expect(oldOwnerMember!.role).toBe('admin')
    })
  })

  describe('Team Listing', () => {
    it('should list teams for a school', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacher, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      // Create multiple teams
      await createTestTeam({ schoolId: school.id, ownerId: teacherId, name: 'Team 1' })
      await createTestTeam({ schoolId: school.id, ownerId: teacherId, name: 'Team 2' })

      const token = generateTestToken({
        userId: teacher.id,
        role: 'teacher',
        username: teacher.username,
        teacherId,
        schoolId: school.id
      })

      const res = await request(app)
        .get(`/api/teams/school/${school.id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.length).toBeGreaterThanOrEqual(2)
    })

    it('should list teams for a student', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacher, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { user: student, studentId } = await createTestUser({ role: 'student', schoolId: school.id })

      const team = await createTestTeam({ schoolId: school.id, ownerId: teacherId })

      // Add student to team
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

      const token = generateTestToken({
        userId: student.id,
        role: 'student',
        username: student.username,
        studentId,
        schoolId: school.id
      })

      const res = await request(app)
        .get(`/api/teams/student/${studentId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  describe('Team Detail', () => {
    it('should get team details', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, teacherId: ownerId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const team = await createTestTeam({ schoolId: school.id, ownerId, name: 'Test Team' })

      const token = generateTestToken({
        userId: owner.id,
        role: 'teacher',
        username: owner.username,
        teacherId: ownerId,
        schoolId: school.id
      })

      const res = await request(app)
        .get(`/api/teams/${team.id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.name).toBe('Test Team')
    })
  })

  describe('Team Deletion', () => {
    it('should delete team as owner', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, teacherId: ownerId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const team = await createTestTeam({ schoolId: school.id, ownerId })

      const token = generateTestToken({
        userId: owner.id,
        role: 'teacher',
        username: owner.username,
        teacherId: ownerId,
        schoolId: school.id
      })

      const res = await request(app)
        .delete(`/api/teams/${team.id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify team was deleted
      const deletedTeam = await prisma.team.findUnique({
        where: { id: team.id }
      })
      expect(deletedTeam).toBeNull()
    })

    it('should deny non-owner from deleting team', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, teacherId: ownerId } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { user: admin, teacherId: adminId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const team = await createTestTeam({ schoolId: school.id, ownerId })

      // Add admin
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: adminId!,
          userType: 'teacher',
          role: 'admin',
          status: 'active',
          joinedAt: new Date()
        }
      })

      const token = generateTestToken({
        userId: admin.id,
        role: 'teacher',
        username: admin.username,
        teacherId: adminId,
        schoolId: school.id
      })

      const res = await request(app)
        .delete(`/api/teams/${team.id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(403)
    })
  })
})