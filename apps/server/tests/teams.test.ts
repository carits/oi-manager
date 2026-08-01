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
          id: crypto.randomUUID(),
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
          id: crypto.randomUUID(),
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
          id: crypto.randomUUID(),
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
          id: crypto.randomUUID(),
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

    it('transfers a personal team between generic user identities', async () => {
      const owner = await createTestUser({ role: 'teacher' })
      const nextOwner = await createTestUser({ role: 'platform_admin' })
      await prisma.personalProfile.createMany({
        data: [{ userId: owner.user.id }, { userId: nextOwner.user.id }],
        skipDuplicates: true
      })
      const team = await createTestTeam({
        schoolId: null,
        ownerId: owner.user.id,
        ownerType: 'user',
        scope: 'personal'
      })
      await prisma.teamMember.create({
        data: {
          id: crypto.randomUUID(),
          teamId: team.id,
          userId: nextOwner.user.id,
          userType: 'user',
          role: 'member',
          status: 'active'
        }
      })
      const token = generateTestToken({
        userId: owner.user.id,
        role: 'teacher',
        username: owner.user.username,
        teacherId: owner.teacherId,
        schoolId: owner.schoolId,
        workspaceMode: 'personal'
      })

      const response = await request(app)
        .post(`/api/teams/${team.id}/transfer`)
        .set('Authorization', `Bearer ${token}`)
        .send({ newOwnerId: nextOwner.user.id, newOwnerType: 'user' })

      expect(response.status).toBe(200)
      const transferred = await prisma.teamMember.findUnique({
        where: {
          teamId_userId_userType: {
            teamId: team.id,
            userId: nextOwner.user.id,
            userType: 'user'
          }
        }
      })
      expect(transferred?.role).toBe('owner')
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
          id: crypto.randomUUID(),
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
          id: crypto.randomUUID(),
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

  describe('Campus and personal scope isolation', () => {
    it('creates personal teams and keeps both team scopes isolated', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal()
      const { school: schoolB } = await createTestSchoolWithPrincipal()
      const { user, studentId } = await createTestUser({
        role: 'student',
        schoolId: schoolA.id,
        username: `personal_${shortId()}`
      })
      const { user: otherUser } = await createTestUser({
        role: 'student',
        schoolId: schoolB.id
      })
      await prisma.personalProfile.createMany({
        data: [{ userId: user.id }, { userId: otherUser.id }],
        skipDuplicates: true
      })

      const campusTeam = await createTestTeam({
        schoolId: schoolA.id,
        ownerId: studentId,
        ownerType: 'student',
        scope: 'campus',
        name: 'Campus only'
      })
      const otherPersonalTeam = await createTestTeam({
        schoolId: null,
        ownerId: otherUser.id,
        ownerType: 'user',
        scope: 'personal',
        name: 'Personal global'
      })

      const personalToken = generateTestToken({
        userId: user.id,
        role: 'student',
        username: user.username,
        studentId,
        schoolId: schoolA.id,
        workspaceMode: 'personal'
      })
      const campusToken = generateTestToken({
        userId: user.id,
        role: 'student',
        username: user.username,
        studentId,
        schoolId: schoolA.id,
        workspaceMode: 'work'
      })

      const createResponse = await request(app)
        .post('/api/teams')
        .set('Authorization', `Bearer ${personalToken}`)
        .send({
          id: `personal_team_${shortId()}`,
          name: 'My personal team',
          isPublic: true
        })

      expect(createResponse.status).toBe(200)
      const createdTeam = await prisma.team.findUnique({
        where: { id: createResponse.body.data.id }
      })
      expect(createdTeam?.scope).toBe('personal')

      const personalList = await request(app)
        .get('/api/teams?view=all')
        .set('Authorization', `Bearer ${personalToken}`)

      expect(personalList.status).toBe(200)
      expect(personalList.body.data.data.map((team: any) => team.id)).toContain(otherPersonalTeam.id)
      expect(personalList.body.data.data.map((team: any) => team.id)).not.toContain(campusTeam.id)
      expect(personalList.body.data.data[0].school).toBeUndefined()
      expect(personalList.body.data.data[0].schoolId).toBeUndefined()

      const campusDetail = await request(app)
        .get(`/api/teams/${createResponse.body.data.id}`)
        .set('Authorization', `Bearer ${campusToken}`)

      expect(campusDetail.status).toBe(403)
    })

    it('uses usernames for personal teams instead of real names', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const username = `display_${shortId()}`
      const { user, studentId } = await createTestUser({
        role: 'student',
        schoolId: school.id,
        username
      })
      await prisma.personalProfile.create({ data: { userId: user.id } })
      const team = await createTestTeam({
        schoolId: null,
        ownerId: user.id,
        ownerType: 'user',
        scope: 'personal'
      })
      const token = generateTestToken({
        userId: user.id,
        role: 'student',
        username,
        studentId,
        schoolId: school.id,
        workspaceMode: 'personal'
      })

      const response = await request(app)
        .get(`/api/teams/${team.id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(200)
      expect(response.body.data.owner.name).toBe(username)
      expect(response.body.data.owner.name).not.toBe('Test student')
    })
  })

  describe('Personal rankings', () => {
    it('returns a platform ranking with usernames only', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal()
      const { school: schoolB } = await createTestSchoolWithPrincipal()
      const usernameA = `rank_a_${shortId()}`
      const usernameB = `rank_b_${shortId()}`
      const studentA = await createTestUser({
        role: 'student',
        schoolId: schoolA.id,
        username: usernameA,
        rating: 1600
      })
      const studentB = await createTestUser({
        role: 'student',
        schoolId: schoolB.id,
        username: usernameB,
        rating: 1500
      })
      await prisma.personalProfile.createMany({
        data: [
          { userId: studentA.user.id, rating: 1600 },
          { userId: studentB.user.id, rating: 1500 }
        ],
        skipDuplicates: true
      })
      const personalToken = generateTestToken({
        userId: studentA.user.id,
        role: 'student',
        username: usernameA,
        studentId: studentA.studentId,
        schoolId: schoolA.id,
        workspaceMode: 'personal'
      })

      const response = await request(app)
        .get('/api/rankings/personal/rating?pageSize=200')
        .set('Authorization', `Bearer ${personalToken}`)

      expect(response.status).toBe(200)
      const rows = response.body.data.filter((row: any) =>
        row.username === usernameA || row.username === usernameB
      )
      expect(rows).toHaveLength(2)
      expect(rows.every((row: any) => !('name' in row))).toBe(true)

      const schoolResponse = await request(app)
        .get(`/api/schools/${schoolA.id}/student-rankings`)
        .set('Authorization', `Bearer ${personalToken}`)
      expect(schoolResponse.status).toBe(403)
    })

    it('rejects the personal ranking in campus mode', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const student = await createTestUser({ role: 'student', schoolId: school.id })
      const token = generateTestToken({
        userId: student.user.id,
        role: 'student',
        username: student.user.username,
        studentId: student.studentId,
        schoolId: school.id,
        workspaceMode: 'work'
      })

      const response = await request(app)
        .get('/api/rankings/personal/rating')
        .set('Authorization', `Bearer ${token}`)

      expect(response.status).toBe(403)
    })
  })
})
