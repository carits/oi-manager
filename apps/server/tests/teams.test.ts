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
      const { user: teacher, userId: teacherId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })

      const token = generateTestToken({ userId: teacher.id, username: teacher.username, accountRole: 'user' })

      const res = await request(app)
        .post('/api/teams')
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)
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
      const { user: teacher, userId: teacherId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })

      const token = generateTestToken({ userId: teacher.id, username: teacher.username, accountRole: 'user' })

      const res = await request(app)
        .post('/api/teams')
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)
        .send({
          schoolId: school.id
        })

      expect(res.status).toBe(422)
    })
  })

  describe('Team Member Management', () => {
    it('should add teacher member to team', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, userId: ownerId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const { user: newMember, userId: newMemberId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })

      const team = await createTestTeam({ organizationId: school.organizationId!, ownerId })

      const token = generateTestToken({ userId: owner.id, username: owner.username, accountRole: 'user' })

      const res = await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)
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
      const { user: owner, userId: ownerId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const { user: newMember, userId: newMemberId } = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId! } })

      const team = await createTestTeam({ organizationId: school.organizationId!, ownerId })

      const token = generateTestToken({ userId: owner.id, username: owner.username, accountRole: 'user' })

      const res = await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)
        .send({
          members: [{ userId: newMemberId, userType: 'student' }],
          role: 'member'
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should remove member from team', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, userId: ownerId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const { user: member, userId: memberId } = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId! } })

      const team = await createTestTeam({ organizationId: school.organizationId!, ownerId })

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

      const token = generateTestToken({ userId: owner.id, username: owner.username, accountRole: 'user' })

      const res = await request(app)
        .delete(`/api/teams/${team.id}/members/${memberId}?memberType=student`)
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)

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
      const { user: owner, userId: ownerId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const { user: regularMember, userId: regularMemberId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const { userId: newMemberId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })

      const team = await createTestTeam({ organizationId: school.organizationId!, ownerId })

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

      const token = generateTestToken({ userId: regularMember.id, username: regularMember.username, accountRole: 'user' })

      const res = await request(app)
        .post(`/api/teams/${team.id}/members`)
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)
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
      const { user: owner, userId: ownerId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const { user: member, userId: memberId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })

      const team = await createTestTeam({ organizationId: school.organizationId!, ownerId })

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

      const token = generateTestToken({ userId: owner.id, username: owner.username, accountRole: 'user' })

      const res = await request(app)
        .post(`/api/teams/${team.id}/admins`)
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)
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
      const { user: owner, userId: ownerId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const { user: newOwner, userId: newOwnerId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })

      const team = await createTestTeam({ organizationId: school.organizationId!, ownerId })

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

      const token = generateTestToken({ userId: owner.id, username: owner.username, accountRole: 'user' })

      const res = await request(app)
        .post(`/api/teams/${team.id}/transfer`)
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)
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
      const owner = await createTestUser({ organization: { role: 'teacher' } })
      const nextOwner = await createTestUser({ accountRole: 'platform_admin' })
      await prisma.personalProfile.createMany({
        data: [{ userId: owner.user.id }, { userId: nextOwner.user.id }],
        skipDuplicates: true
      })
      const team = await createTestTeam({
        organizationId: null,
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
      const token = generateTestToken({ userId: owner.user.id, username: owner.user.username, workspaceMode: 'personal', accountRole: 'user' })

      const response = await request(app)
        .post(`/api/teams/${team.id}/transfer`)
        .set('Cookie', `oi_session=${token}`)
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
      const { user: teacher, userId: teacherId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })

      // Create multiple teams
      await createTestTeam({ organizationId: school.organizationId!, ownerId: teacherId, name: 'Team 1' })
      await createTestTeam({ organizationId: school.organizationId!, ownerId: teacherId, name: 'Team 2' })

      const token = generateTestToken({ userId: teacher.id, username: teacher.username, accountRole: 'user' })

      const res = await request(app)
        .get(`/api/teams/organization/${school.organizationId}`)
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.length).toBeGreaterThanOrEqual(2)
    })

    it('should list teams for a student', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacher, userId: teacherId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const { user: student, userId: studentId } = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId! } })

      const team = await createTestTeam({ organizationId: school.organizationId!, ownerId: teacherId })

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

      const token = generateTestToken({ userId: student.id, username: student.username, accountRole: 'user' })

      const res = await request(app)
        .get('/api/teams/mine')
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  describe('Team Detail', () => {
    it('should get team details', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, userId: ownerId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })

      const team = await createTestTeam({ organizationId: school.organizationId!, ownerId, name: 'Test Team' })

      const token = generateTestToken({ userId: owner.id, username: owner.username, accountRole: 'user' })

      const res = await request(app)
        .get(`/api/teams/${team.id}`)
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.name).toBe('Test Team')
    })
  })

  describe('Team Deletion', () => {
    it('should delete team as owner', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: owner, userId: ownerId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })

      const team = await createTestTeam({ organizationId: school.organizationId!, ownerId })

      const token = generateTestToken({ userId: owner.id, username: owner.username, accountRole: 'user' })

      const res = await request(app)
        .delete(`/api/teams/${team.id}`)
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)

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
      const { user: owner, userId: ownerId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })
      const { user: admin, userId: adminId } = await createTestUser({ organization: { role: 'teacher', organizationId: school.organizationId! } })

      const team = await createTestTeam({ organizationId: school.organizationId!, ownerId })

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

      const token = generateTestToken({ userId: admin.id, username: admin.username, accountRole: 'user' })

      const res = await request(app)
        .delete(`/api/teams/${team.id}`)
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)

      expect(res.status).toBe(403)
    })
  })

  describe('Multi-organization team isolation', () => {
    it('keeps mine and invitations inside the active organization context', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal()
      const { school: schoolB } = await createTestSchoolWithPrincipal()
      const teacher = await createTestUser({ organization: { role: 'teacher', organizationId: schoolA.organizationId! } })
      const ownerA = await createTestUser({ organization: { role: 'teacher', organizationId: schoolA.organizationId! } })
      const ownerB = await createTestUser({ organization: { role: 'teacher', organizationId: schoolB.organizationId! } })

      const membershipBId = crypto.randomUUID()
      await prisma.organizationMembership.create({
        data: {
          id: membershipBId,
          organizationId: schoolB.organizationId!,
          userId: teacher.user.id,
          memberRole: 'teacher',
          relationType: 'employee',
          status: 'active',
          joinedAt: new Date(),
          RoleAssignments: { create: { id: crypto.randomUUID(), roleKey: 'teacher', source: 'test_fixture' } },
        },
      })
      await prisma.organizationTeacherProfile.create({
        data: { id: crypto.randomUUID(), membershipId: membershipBId, name: '跨校教师', status: 'active' },
      })

      const teamA = await createTestTeam({ organizationId: schoolA.organizationId!, ownerId: ownerA.user.id, ownerType: 'teacher', name: '学校A团队' })
      const teamB = await createTestTeam({ organizationId: schoolB.organizationId!, ownerId: ownerB.user.id, ownerType: 'teacher', name: '学校B团队' })
      const inviteTeamB = await createTestTeam({ organizationId: schoolB.organizationId!, ownerId: ownerB.user.id, ownerType: 'teacher', name: '学校B邀请团队' })

      await prisma.teamMember.createMany({
        data: [
          { id: crypto.randomUUID(), teamId: teamA.id, userId: teacher.user.id, userType: 'teacher', role: 'member', status: 'active', joinedAt: new Date() },
          { id: crypto.randomUUID(), teamId: teamB.id, userId: teacher.user.id, userType: 'teacher', role: 'member', status: 'active', joinedAt: new Date() },
        ],
      })
      const invitationB = await prisma.teamMember.create({
        data: {
          id: crypto.randomUUID(),
          teamId: inviteTeamB.id,
          userId: teacher.user.id,
          userType: 'teacher',
          role: 'admin',
          status: 'pending',
          invitedBy: ownerB.user.id,
          joinedAt: new Date(),
        },
      })

      const token = generateTestToken({ userId: teacher.user.id, username: teacher.user.username, accountRole: 'user' })

      const mineA = await request(app)
        .get('/api/teams/mine')
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', schoolA.organizationId!)

      expect(mineA.status).toBe(200)
      const mineIds = mineA.body.data.joined.map((team: any) => team.id)
      expect(mineIds).toContain(teamA.id)
      expect(mineIds).not.toContain(teamB.id)

      const invitationsA = await request(app)
        .get('/api/teams/invitations')
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', schoolA.organizationId!)

      expect(invitationsA.status).toBe(200)
      expect(invitationsA.body.data.map((item: any) => item.id)).not.toContain(invitationB.id)

      const invitationsB = await request(app)
        .get('/api/teams/invitations')
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', schoolB.organizationId!)

      expect(invitationsB.status).toBe(200)
      expect(invitationsB.body.data.map((item: any) => item.id)).toContain(invitationB.id)
    })
  })

  describe('Campus and personal scope isolation', () => {
    it('creates personal teams and keeps both team scopes isolated', async () => {
      const { school: schoolA } = await createTestSchoolWithPrincipal()
      const { school: schoolB } = await createTestSchoolWithPrincipal()
      const { user, userId: studentId } = await createTestUser({ organization: { role: 'student', organizationId: schoolA.organizationId! }, username: `personal_${shortId()}` })
      const { user: otherUser } = await createTestUser({ organization: { role: 'student', organizationId: schoolB.organizationId! } })
      await prisma.personalProfile.createMany({
        data: [{ userId: user.id }, { userId: otherUser.id }],
        skipDuplicates: true
      })

      const campusTeam = await createTestTeam({
        organizationId: schoolA.organizationId!,
        ownerId: studentId,
        ownerType: 'student',
        scope: 'campus',
        name: 'Campus only'
      })
      const otherPersonalTeam = await createTestTeam({
        organizationId: null,
        ownerId: otherUser.id,
        ownerType: 'user',
        scope: 'personal',
        name: 'Personal global'
      })

      const personalToken = generateTestToken({ userId: user.id, username: user.username, workspaceMode: 'personal', accountRole: 'user' })
      const campusToken = generateTestToken({ userId: user.id, username: user.username, workspaceMode: 'work', accountRole: 'user' })

      const createResponse = await request(app)
        .post('/api/teams')
        .set('Cookie', `oi_session=${personalToken}`)
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
        .set('Cookie', `oi_session=${personalToken}`)

      expect(personalList.status).toBe(200)
      expect(personalList.body.data.summary.memberCount).toBeGreaterThanOrEqual(1)
      expect(personalList.body.data.data.map((team: any) => team.id)).toContain(otherPersonalTeam.id)
      expect(personalList.body.data.data.map((team: any) => team.id)).not.toContain(campusTeam.id)
      expect(personalList.body.data.data[0].school).toBeUndefined()
      expect(personalList.body.data.data[0].schoolId).toBeUndefined()

      const campusDetail = await request(app)
        .get(`/api/teams/${createResponse.body.data.id}`)
        .set('Cookie', `oi_session=${campusToken}`)
        .set('x-oi-organization-id', schoolA.organizationId!)

      expect(campusDetail.status).toBe(403)
    })

    it('uses usernames for personal teams instead of real names', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const username = `display_${shortId()}`
      const { user, userId: studentId } = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId! }, username })
      await prisma.personalProfile.create({ data: { userId: user.id } })
      const team = await createTestTeam({
        organizationId: null,
        ownerId: user.id,
        ownerType: 'user',
        scope: 'personal'
      })
      const token = generateTestToken({ userId: user.id, username, workspaceMode: 'personal', accountRole: 'user' })

      const response = await request(app)
        .get(`/api/teams/${team.id}`)
        .set('Cookie', `oi_session=${token}`)

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
      const studentA = await createTestUser({ organization: { role: 'student', organizationId: schoolA.organizationId!, rating: 1600 }, username: usernameA })
      const studentB = await createTestUser({ organization: { role: 'student', organizationId: schoolB.organizationId!, rating: 1500 }, username: usernameB })
      await prisma.personalProfile.createMany({
        data: [
          { userId: studentA.user.id, rating: 1600 },
          { userId: studentB.user.id, rating: 1500 }
        ],
        skipDuplicates: true
      })
      const personalToken = generateTestToken({ userId: studentA.user.id, username: usernameA, workspaceMode: 'personal', accountRole: 'user' })

      const response = await request(app)
        .get('/api/rankings/personal/rating?pageSize=200')
        .set('Cookie', `oi_session=${personalToken}`)

      expect(response.status).toBe(200)
      const rows = response.body.data.items.filter((row: any) =>
        row.username === usernameA || row.username === usernameB
      )
      expect(rows).toHaveLength(2)
      expect(rows.every((row: any) => !('name' in row))).toBe(true)

      const schoolResponse = await request(app)
        .get(`/api/rankings/organizations/${schoolA.organizationId}/rating`)
        .set('Cookie', `oi_session=${personalToken}`)
      expect(schoolResponse.status).toBe(403)
    })

    it('rejects the personal ranking in campus mode', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const student = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId! } })
      const token = generateTestToken({ userId: student.user.id, username: student.user.username, workspaceMode: 'work', accountRole: 'user' })

      const response = await request(app)
        .get('/api/rankings/personal/rating')
        .set('Cookie', `oi_session=${token}`)
        .set('x-oi-organization-id', school.organizationId!)

      expect(response.status).toBe(403)
    })
  })
})
