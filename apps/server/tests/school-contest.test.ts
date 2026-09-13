import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import {
  canAccessTraining,
  canManageTraining,
  isOrganizationContestAdmin,
  isOrganizationMember,
} from '../src/modules/training/training.helpers'
import { createTestApp } from './helpers/testRequest'
import { generateTestToken } from './helpers/testToken'
import { createTestSchoolContest, createTestSubmission } from './helpers/school-contest-helpers'
import { createTestSchoolWithPrincipal, createTestTeam, createTestUser } from './helpers/testUser'
import { ensureContestAggregateTx, syncContestProblemAggregateTx } from '../src/modules/contest/contest-aggregate.service'

const app = createTestApp()

type TestUser = Awaited<ReturnType<typeof createTestUser>>

function tokenFor(user: TestUser) {
  return generateTestToken({
    userId: user.user.id,
    username: user.user.username,
    role: user.user.role,
    schoolId: user.schoolId,
    teacherId: user.teacherId,
    studentId: user.studentId,
    adminId: user.adminId,
  })
}

function organizationRequest(
  method: 'get' | 'post' | 'put' | 'delete',
  url: string,
  token: string,
  organizationId?: string,
) {
  const call = request(app)[method](url).set('Authorization', `Bearer ${token}`)
  return organizationId ? call.set('x-oi-organization-id', organizationId) : call
}

describe('organization contest contract', () => {
  let schoolA: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>['school']
  let schoolB: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>['school']
  let principal: TestUser
  let teacher: TestUser
  let otherTeacher: TestUser
  let student: TestUser
  let remoteTeacher: TestUser
  let superAdmin: TestUser
  let platformAdmin: TestUser

  const contestsUrl = () => `/api/organizations/${schoolA.organizationId}/members/activities/contests`

  beforeEach(async () => {
    schoolA = (await createTestSchoolWithPrincipal('Contest School A')).school
    schoolB = (await createTestSchoolWithPrincipal('Contest School B')).school
    principal = await createTestUser({ role: 'school_principal', schoolId: schoolA.id })
    teacher = await createTestUser({ role: 'teacher', schoolId: schoolA.id })
    otherTeacher = await createTestUser({ role: 'teacher', schoolId: schoolA.id })
    student = await createTestUser({ role: 'student', schoolId: schoolA.id })
    remoteTeacher = await createTestUser({ role: 'teacher', schoolId: schoolB.id })
    superAdmin = await createTestUser({ role: 'super_admin' })
    platformAdmin = await createTestUser({ role: 'platform_admin' })
  })

  describe('GET /api/organizations/:organizationId/members/activities/contests', () => {
    it.each(['student', 'teacher', 'principal'] as const)('allows an active local %s', async role => {
      const actor = role === 'student' ? student : role === 'teacher' ? teacher : principal
      const response = await organizationRequest('get', contestsUrl(), tokenFor(actor), schoolA.organizationId!)
      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ success: true, data: [] })
    })

    it('rejects anonymous, cross-organization and global-admin workspace access', async () => {
      expect((await request(app).get(contestsUrl())).status).toBe(401)
      expect((await organizationRequest('get', contestsUrl(), tokenFor(remoteTeacher), schoolB.organizationId!)).status).toBe(403)
      expect((await organizationRequest('get', contestsUrl(), tokenFor(superAdmin))).status).toBe(403)
      expect((await organizationRequest('get', contestsUrl(), tokenFor(platformAdmin))).status).toBe(403)
    })

    it('returns school contests and only team contests visible through active membership', async () => {
      const schoolContest = await createTestSchoolContest({ schoolId: schoolA.id, createdBy: teacher.user.id, title: 'School contest' })
      const visibleTeam = await createTestTeam({ schoolId: schoolA.id, ownerId: student.user.id, ownerType: 'student' })
      const hiddenTeam = await createTestTeam({ schoolId: schoolA.id })
      const visibleTeamContest = await prisma.training.create({
        data: {
          title: 'Visible team contest', format: 'icpc', type: 'contest', scope: 'campus',
          organizationId: schoolA.organizationId, teamId: visibleTeam.id,
          startTime: new Date(Date.now() - 60_000), endTime: new Date(Date.now() + 60_000),
          status: 'ongoing', createdBy: student.user.id,
        },
      })
      await prisma.$transaction(async tx => {
        await ensureContestAggregateTx(tx, schoolContest.id)
        await ensureContestAggregateTx(tx, visibleTeamContest.id)
      })
      await prisma.training.create({
        data: {
          title: 'Hidden team contest', format: 'icpc', type: 'contest', scope: 'campus',
          organizationId: schoolA.organizationId, teamId: hiddenTeam.id,
          startTime: new Date(Date.now() - 60_000), endTime: new Date(Date.now() + 60_000),
          status: 'ongoing', createdBy: teacher.user.id,
        },
      })
      await prisma.training.create({
        data: {
          title: 'Homework', format: 'oi', type: 'homework', scope: 'campus',
          organizationId: schoolA.organizationId, teamId: visibleTeam.id,
          startTime: new Date(Date.now() - 60_000), endTime: new Date(Date.now() + 60_000),
          status: 'ongoing', createdBy: teacher.user.id,
        },
      })

      const response = await organizationRequest('get', contestsUrl(), tokenFor(student), schoolA.organizationId!)
      expect(response.status).toBe(200)
      expect(response.body.data.map((item: { id: number }) => item.id)).toEqual(expect.arrayContaining([schoolContest.id, visibleTeamContest.id]))
      expect(response.body.data.map((item: { title: string }) => item.title)).not.toContain('Hidden team contest')
      expect(response.body.data.map((item: { title: string }) => item.title)).not.toContain('Homework')
      expect(response.body.data.find((item: { id: number }) => item.id === schoolContest.id).source).toBe('school')
      expect(response.body.data.find((item: { id: number }) => item.id === visibleTeamContest.id).source).toBe('team')
    })

    it('computes status from timestamps instead of trusting the stored status', async () => {
      const contest = await createTestSchoolContest({
        schoolId: schoolA.id,
        createdBy: teacher.user.id,
        status: 'upcoming',
        startTime: new Date(Date.now() - 60_000),
        endTime: new Date(Date.now() + 60_000),
      })
      const response = await organizationRequest('get', contestsUrl(), tokenFor(teacher), schoolA.organizationId!)
      expect(response.body.data.find((item: { id: number }) => item.id === contest.id).status).toBe('ongoing')
    })
  })

  describe('POST /api/organizations/:organizationId/members/activities/contests', () => {
    const validBody = () => ({
      title: '  Current organization contest  ',
      format: 'icpc',
      startTime: new Date(Date.now() + 60_000).toISOString(),
      endTime: new Date(Date.now() + 120_000).toISOString(),
    })

    it.each(['teacher', 'principal'] as const)('allows a local %s and fixes the organization scope', async role => {
      const actor = role === 'teacher' ? teacher : principal
      const response = await organizationRequest('post', contestsUrl(), tokenFor(actor), schoolA.organizationId!).send(validBody())
      expect(response.status).toBe(201)
      expect(response.body.data).toMatchObject({
        title: 'Current organization contest',
        type: 'contest',
        scope: 'campus',
        organizationId: schoolA.organizationId,
        teamId: null,
        createdBy: actor.user.id,
      })
    })

    it('rejects students, remote organizations and global admin workspaces', async () => {
      expect((await organizationRequest('post', contestsUrl(), tokenFor(student), schoolA.organizationId!).send(validBody())).status).toBe(403)
      expect((await organizationRequest('post', contestsUrl(), tokenFor(remoteTeacher), schoolB.organizationId!).send(validBody())).status).toBe(403)
      expect((await organizationRequest('post', contestsUrl(), tokenFor(superAdmin)).send(validBody())).status).toBe(403)
    })

    it.each([
      {},
      { title: 'Missing times' },
      { title: 'Bad range', startTime: '2026-08-24T10:00:00Z', endTime: '2026-08-24T09:00:00Z' },
    ])('rejects invalid input %#', async body => {
      const response = await organizationRequest('post', contestsUrl(), tokenFor(teacher), schoolA.organizationId!).send(body)
      expect(response.status).toBe(400)
    })
  })

  describe('current training access and management helpers', () => {
    it('requires active organization membership for ordinary users', async () => {
      expect(await isOrganizationMember(student.user.id, schoolA.organizationId!)).toBe(true)
      expect(await isOrganizationMember(remoteTeacher.user.id, schoolA.organizationId!)).toBe(false)
      await prisma.organizationMembership.updateMany({
        where: { organizationId: schoolA.organizationId!, userId: student.user.id },
        data: { status: 'removed' },
      })
      expect(await isOrganizationMember(student.user.id, schoolA.organizationId!)).toBe(false)
    })

    it('keeps the explicit global read compatibility but only super admin has global management', async () => {
      expect(await isOrganizationMember(superAdmin.user.id, schoolA.organizationId!)).toBe(true)
      expect(await isOrganizationMember(platformAdmin.user.id, schoolA.organizationId!)).toBe(true)
      expect(await isOrganizationContestAdmin(superAdmin.user.id, schoolA.organizationId!)).toBe(true)
      expect(await isOrganizationContestAdmin(platformAdmin.user.id, schoolA.organizationId!)).toBe(false)
    })

    it('allows principals and creators to manage, but rejects other local teachers', async () => {
      expect(await isOrganizationContestAdmin(principal.user.id, schoolA.organizationId!, 'other')).toBe(true)
      expect(await isOrganizationContestAdmin(teacher.user.id, schoolA.organizationId!, teacher.user.id)).toBe(true)
      expect(await isOrganizationContestAdmin(otherTeacher.user.id, schoolA.organizationId!, teacher.user.id)).toBe(false)
    })

    it('uses organizationId as the only organization training ownership key', async () => {
      const training = { teamId: null, organizationId: schoolA.organizationId! }
      expect(await canAccessTraining(student.user.id, training)).toBe(true)
      expect(await canAccessTraining(remoteTeacher.user.id, training)).toBe(false)
      expect(await canAccessTraining(student.user.id, { teamId: null, organizationId: null })).toBe(false)
      expect(await canManageTraining(principal.user.id, { ...training, createdBy: teacher.user.id })).toBe(true)
      expect(await canManageTraining(teacher.user.id, { ...training, createdBy: teacher.user.id })).toBe(true)
      expect(await canManageTraining(otherTeacher.user.id, { ...training, createdBy: teacher.user.id })).toBe(false)
    })
  })

  describe('contest submission visibility', () => {
    it('hides an ongoing OI result from the participant and exposes it to the manager', async () => {
      const contest = await createTestSchoolContest({ schoolId: schoolA.id, createdBy: teacher.user.id, format: 'oi' })
      const problem = await prisma.problem.create({
        data: {
          id: crypto.randomUUID(), platform: 'carits', problemId: `ORG_${Date.now()}`, title: 'OI problem',
          ownerId: teacher.user.id, visibility: 'public', libraryScope: 'platform', libraryKey: 'platform',
          status: 'published', publishedAt: new Date(),
        },
      })
      const trainingProblem = await prisma.trainingProblem.create({
        data: { id: crypto.randomUUID(), trainingId: contest.id, problemId: problem.id, alias: 'A', orderIndex: 1, points: 100 },
      })
      await prisma.$transaction(tx => syncContestProblemAggregateTx(tx, trainingProblem.id))
      await createTestSubmission({
        userId: student.user.id,
        trainingId: contest.id,
        problemId: problem.problemId,
        trainingProblemId: trainingProblem.id,
        result: 'accepted',
      })

      const studentResponse = await organizationRequest('get', `/api/trainings/${contest.id}/submissions`, tokenFor(student), schoolA.organizationId!)
      expect(studentResponse.status).toBe(200)
      expect(studentResponse.body.data.submissions[0].result).toBe('submitted')

      const managerResponse = await organizationRequest('get', `/api/trainings/${contest.id}/submissions`, tokenFor(teacher), schoolA.organizationId!)
      expect(managerResponse.status).toBe(200)
      expect(managerResponse.body.data.submissions[0].result).toBe('accepted')
    })
  })
})
