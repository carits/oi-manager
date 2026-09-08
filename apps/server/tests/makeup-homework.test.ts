import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { createAuthenticatedRequest, createTestApp } from './helpers/testRequest'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestSchoolWithPrincipal, createTestTeam, createTestUser } from './helpers/testUser'

const app = createTestApp()

describe('补题作业使用独立 Assignment', () => {
  let owner: Awaited<ReturnType<typeof createTestUser>>
  let admin: Awaited<ReturnType<typeof createTestUser>>
  let student: Awaited<ReturnType<typeof createTestUser>>
  let outsider: Awaited<ReturnType<typeof createTestUser>>
  let ownerToken: string
  let adminToken: string
  let studentToken: string
  let outsiderToken: string
  let finishedTraining: any
  let ongoingTraining: any
  let team: Awaited<ReturnType<typeof createTestTeam>>
  let revisionId: string

  beforeEach(async () => {
    const school = await createTestSchoolWithPrincipal()
    owner = await createTestUser({ role: 'teacher', schoolId: school.school.id })
    admin = await createTestUser({ role: 'teacher', schoolId: school.school.id })
    student = await createTestUser({ role: 'student', schoolId: school.school.id })
    outsider = await createTestUser({ role: 'teacher', schoolId: school.school.id })
    ownerToken = generateTokenFromUser(owner.user)
    adminToken = generateTokenFromUser(admin.user)
    studentToken = generateTokenFromUser(student.user)
    outsiderToken = generateTokenFromUser(outsider.user)
    team = await createTestTeam({ schoolId: school.school.id, ownerId: owner.user.id })
    await prisma.teamMember.createMany({ data: [
      { id: crypto.randomUUID(), teamId: team.id, userId: admin.user.id, userType: 'teacher', role: 'admin', status: 'active', joinedAt: new Date() },
      { id: crypto.randomUUID(), teamId: team.id, userId: student.user.id, userType: 'student', role: 'member', status: 'active', joinedAt: new Date() },
    ] })
    const problem = await prisma.problem.create({ data: {
      id: crypto.randomUUID(), platform: 'carits', problemId: String(Date.now()), title: '补题题目', ownerId: owner.user.id,
      visibility: 'public', libraryScope: 'platform', libraryKey: 'platform', status: 'published', publishedAt: new Date(),
    } })
    revisionId = crypto.randomUUID()
    await prisma.problemTestSetRevision.create({ data: {
      id: revisionId, problemId: problem.id, revisionNumber: 1, mode: 'acm', source: 'initial',
      judgeConfig: '{"mode":"acm","cases":[]}', judgeConfigHash: 'makeup-config', graphHash: 'makeup-graph', createdBy: owner.user.id,
    } })
    await prisma.problem.update({ where: { id: problem.id }, data: { latestTestSetRevisionId: revisionId } })
    const now = Date.now()
    finishedTraining = await prisma.training.create({ data: {
      teamId: team.id, organizationId: team.organizationId, title: '已结束比赛', format: 'ioi', type: 'contest',
      startTime: new Date(now - 3 * 86_400_000), endTime: new Date(now - 86_400_000), status: 'finished', createdBy: owner.user.id,
    } })
    await prisma.trainingProblem.create({ data: {
      id: crypto.randomUUID(), trainingId: finishedTraining.id, problemId: problem.id, alias: 'A', orderIndex: 0, points: 100,
      titleSnapshot: problem.title, judgeConfigSnapshot: '{"mode":"acm","cases":[]}', testSetRevisionId: revisionId,
    } })
    ongoingTraining = await prisma.training.create({ data: {
      teamId: team.id, organizationId: team.organizationId, title: '进行中比赛', format: 'ioi', type: 'contest',
      startTime: new Date(now - 3_600_000), endTime: new Date(now + 3_600_000), status: 'ongoing', createdBy: owner.user.id,
    } })
  })

  it('团队管理员创建带固定 Revision 的独立补题作业草稿', async () => {
    for (const token of [ownerToken, adminToken]) {
      const response = await createAuthenticatedRequest(app, token)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({ title: '补题草稿', endTime: new Date(Date.now() + 86_400_000).toISOString() })
      expect(response.status).toBe(200)
      expect(response.body.data.type).toBe('assignment')
      expect(response.body.data.sourceTrainingId).toBe(finishedTraining.id)
      const assignment = await prisma.assignment.findUnique({ where: { id: response.body.data.id }, include: { Problems: true, Events: true } })
      expect(assignment?.status).toBe('DRAFT')
      expect(assignment?.rosterMode).toBe('DYNAMIC')
      expect(assignment?.Problems).toHaveLength(1)
      expect(assignment?.Problems[0].testSetRevisionId).toBe(revisionId)
      expect(assignment?.Events[0].type).toBe('assignment.created_from_activity')
    }
  })

  it('学生和非团队管理员不能创建补题作业', async () => {
    for (const token of [studentToken, outsiderToken]) {
      const response = await createAuthenticatedRequest(app, token)
        .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
        .send({ endTime: new Date(Date.now() + 86_400_000).toISOString() })
      expect(response.status).toBe(403)
    }
  })

  it('仅允许已结束活动且要求合法时间范围', async () => {
    const active = await createAuthenticatedRequest(app, ownerToken)
      .post(`/api/trainings/${ongoingTraining.id}/create-makeup-homework`)
      .send({ endTime: new Date(Date.now() + 86_400_000).toISOString() })
    expect(active.status).toBe(400)
    expect(active.body.code).toBe('TRAINING_NOT_FINISHED')
    const missing = await createAuthenticatedRequest(app, ownerToken)
      .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`).send({})
    expect(missing.status).toBe(400)
    const invalid = await createAuthenticatedRequest(app, ownerToken)
      .post(`/api/trainings/${finishedTraining.id}/create-makeup-homework`)
      .send({ startTime: new Date(Date.now() + 86_400_000).toISOString(), endTime: new Date().toISOString() })
    expect(invalid.status).toBe(400)
  })
})
