import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { ensureInitialTestSetRevision } from '../src/modules/problem/problem.testset-revision.service'
import { getCoachDashboard, getTrainingReport, listTrainingSessionTemplates, resolveTrainingPermission } from '../src/modules/training-engine/training-engine.service'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestTeam, createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'

const app = createTestApp()
const directories: string[] = []

async function configuredProblem(ownerId: string) {
  const id = crypto.randomUUID()
  const root = path.join(process.cwd(), 'testdata', id)
  directories.push(root)
  await fs.promises.mkdir(root, { recursive: true })
  await fs.promises.writeFile(path.join(root, '1.in'), '1 2\n')
  await fs.promises.writeFile(path.join(root, '1.out'), '3\n')
  const problem = await prisma.problem.create({ data: {
    id, platform: 'carits', problemId: `TE-${id.slice(0, 8)}`, title: '训练引擎题目', ownerId,
    visibility: 'public', libraryScope: 'platform', libraryKey: 'platform', status: 'published',
    judgeConfig: 'mode: acm\ncases:\n  - input: 1.in\n    output: 1.out\n',
  } })
  for (const [filename, content] of [['1.in', '1 2\n'], ['1.out', '3\n']]) {
    await prisma.testdataFile.create({ data: {
      id: crypto.randomUUID(), problemId: id, filename, size: Buffer.byteLength(content),
      md5: crypto.createHash('md5').update(content).digest('hex'),
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    } })
  }
  await ensureInitialTestSetRevision(id, ownerId)
  return problem
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.promises.rm(directory, { recursive: true, force: true })))
})

describe('Stage-driven Training Engine', () => {
  let coach: Awaited<ReturnType<typeof createTestUser>>
  let student: Awaited<ReturnType<typeof createTestUser>>
  let team: Awaited<ReturnType<typeof createTestTeam>>
  let problem: Awaited<ReturnType<typeof configuredProblem>>

  beforeEach(async () => {
    coach = await createTestUser({ role: 'teacher' })
    student = await createTestUser({ role: 'student', schoolId: coach.schoolId })
    team = await createTestTeam({ schoolId: null, scope: 'personal', ownerId: coach.user.id, ownerType: 'user' })
    await prisma.teamMember.create({ data: { id: crypto.randomUUID(), teamId: team.id, userId: student.user.id, userType: 'student', role: 'member', status: 'active', joinedAt: new Date() } })
    problem = await configuredProblem(coach.user.id)
  })

  async function createSession(extraStage: Record<string, unknown> = {}) {
    const response = await createAuthenticatedRequest(app, generateTokenFromUser(coach.user)).post('/api/training-sessions').send({
      title: 'Stage 驱动训练', teamId: team.id, participantUserIds: [student.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [{
        name: '训练', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL',
        accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED',
        problems: [{ problemId: problem.id }], ...extraStage,
      }],
    })
    expect(response.status).toBe(201)
    return response.body.data
  }

  it('creates Stage plans, pins the revision and reports missing progress as NOT_STARTED', async () => {
    const created = await createSession()
    const session = await prisma.trainingSession.findUniqueOrThrow({ where: { id: created.id }, include: {
      Stages: { include: { Problems: { include: { Plans: true } }, ParticipantAssignments: true } },
    } })
    expect(session.Stages[0].Problems[0].testSetRevisionId).toBeTruthy()
    expect(session.Stages[0].Problems[0].Plans).toHaveLength(1)
    expect(session.Stages[0].ParticipantAssignments).toHaveLength(1)

    await prisma.trainingSession.update({ where: { id: session.id }, data: { status: 'RUNNING', startedAt: new Date(), runningSince: new Date(), currentStageId: session.Stages[0].id } })
    await prisma.trainingSessionStage.update({ where: { id: session.Stages[0].id }, data: { lifecycle: 'RUNNING', runningSince: new Date() } })
    await prisma.trainingSessionParticipant.update({ where: { sessionId_userId: { sessionId: session.id, userId: student.user.id } }, data: { currentStageId: session.Stages[0].id } })

    const dashboard = await getCoachDashboard(coach.user.id, session.id)
    expect(dashboard.summary.completed).toBe(0)
    expect(dashboard.participants[0]).toMatchObject({ requiredCount: 1, completedCount: 0, completed: false })
    const report = await getTrainingReport(coach.user.id, session.id)
    expect(report.participants[0].problems[0]).toMatchObject({ status: 'NOT_STARTED', requirement: 'CURRENT_REQUIREMENT', attemptCount: 0 })
  })

  it('enforces an explicit single-problem time policy instead of a hard-coded switch rule', async () => {
    const created = await createSession({ problems: [{ problemId: problem.id, timePolicy: { mode: 'HARD', limitSeconds: 60 }, stuckPolicy: { minActiveSeconds: 300, minAttempts: 2, noImprovementSeconds: 180 } }] })
    const session = await prisma.trainingSession.findUniqueOrThrow({ where: { id: created.id }, include: { Stages: { include: { Problems: true } }, Participants: true } })
    const stage = session.Stages[0]
    const stageProblem = stage.Problems[0]
    const participant = session.Participants[0]
    await prisma.trainingSession.update({ where: { id: session.id }, data: { status: 'RUNNING', startedAt: new Date(), runningSince: new Date(), currentStageId: stage.id } })
    await prisma.trainingSessionStage.update({ where: { id: stage.id }, data: { lifecycle: 'RUNNING', runningSince: new Date() } })
    await prisma.trainingSessionParticipant.update({ where: { id: participant.id }, data: { currentStageId: stage.id, currentProblemId: stageProblem.id } })
    await prisma.trainingSessionProblemProgress.create({ data: { participantId: participant.id, stageProblemId: stageProblem.id, status: 'WORKING', activeSeconds: 60, continuousActiveSeconds: 60 } })
    expect(await resolveTrainingPermission(student.user.id, session.id, stageProblem.id)).toMatchObject({ canSubmit: false, reason: 'PROBLEM_TIME_LIMIT_REACHED' })
  })

  it('saves a design as a scoped skeleton template and can create another Session from it', async () => {
    const created = await createSession({
      audienceMode: 'GROUPED', problems: [],
      groups: [{ clientKey: 'foundation', name: '基础组', accessPolicy: 'SEQUENTIAL', submissionMode: 'ENABLED', participantIds: [student.user.id], problems: [{ problemId: problem.id }] }],
    })
    const token = generateTokenFromUser(coach.user)
    const saved = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/templates`).send({ name: '我的分层模板', scope: 'personal' })
    expect(saved.status).toBe(201)
    expect(saved.body.data).toMatchObject({ name: '我的分层模板', source: 'personal', stages: [{ audienceMode: 'GROUPED', groups: [{ name: '基础组' }] }] })
    expect((await listTrainingSessionTemplates(coach.user.id, {})).some(item => item.key === saved.body.data.key)).toBe(true)

    const reused = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({ title: '复用模板', teamId: team.id, templateKey: saved.body.data.key })
    expect(reused.status).toBe(201)
    const reusedSession = await prisma.trainingSession.findUniqueOrThrow({ where: { id: reused.body.data.id }, include: { Stages: { include: { Groups: true } } } })
    expect(reusedSession.Stages[0].audienceMode).toBe('GROUPED')
    expect(reusedSession.Stages[0].Groups.map(item => item.name)).toEqual(['基础组'])

    const retired = await createAuthenticatedRequest(app, token).delete(`/api/training-session-templates/${saved.body.data.key.replace('database:', '')}`)
    expect(retired.status).toBe(200)
    expect((await listTrainingSessionTemplates(coach.user.id, {})).some(item => item.key === saved.body.data.key)).toBe(false)
  })

  it('rejects the removed rollback transition at the runtime contract boundary', async () => {
    const created = await createSession()
    const stage = await prisma.trainingSessionStage.findFirstOrThrow({ where: { sessionId: created.id } })
    const response = await createAuthenticatedRequest(app, generateTokenFromUser(coach.user)).post(`/api/training-sessions/${created.id}/stage-transitions`).send({ expectedRevision: 0, action: 'back', stageId: stage.id })
    expect(response.status).toBe(422)
  })

  it('runs the immutable Stage timeline through start, extension, advance and end', async () => {
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({
      title: '生命周期训练', teamId: team.id, participantUserIds: [student.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [
        { name: '热身', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [{ problemId: problem.id }] },
        { name: '讲评', kind: 'REVIEW', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'TEACHER_CONTROLLED', submissionMode: 'DISABLED', problems: [] },
      ],
    })
    expect(created.status).toBe(201)
    const sessionId = created.body.data.id as string
    const stages = await prisma.trainingSessionStage.findMany({ where: { sessionId }, orderBy: { orderIndex: 'asc' } })

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: stages[0].id })).status).toBe(200)
    expect(await prisma.trainingSessionStageRuntimeSnapshot.count({ where: { stageId: stages[0].id } })).toBe(1)

    const extended = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/stages/${stages[0].id}/time-extensions`).send({ expectedRevision: 2, seconds: 600, reason: '课堂讨论需要更多时间' })
    expect(extended.status).toBe(200)
    expect(await prisma.trainingSessionStageTimeAdjustment.findFirst({ where: { stageId: stages[0].id }, select: { seconds: true, reason: true } })).toEqual({ seconds: 600, reason: '课堂讨论需要更多时间' })

    const advanced = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/stage-transitions`).send({ expectedRevision: 3, action: 'advance', stageId: stages[0].id, outcome: 'completed' })
    expect(advanced.status).toBe(200)
    const afterAdvance = await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId }, include: { Stages: { orderBy: { orderIndex: 'asc' }, include: { RuntimeSnapshot: true } } } })
    expect(afterAdvance.currentStageId).toBe(stages[1].id)
    expect(afterAdvance.Stages.map(item => item.lifecycle)).toEqual(['COMPLETED', 'RUNNING'])
    expect(afterAdvance.Stages[1].RuntimeSnapshot).not.toBeNull()

    const stale = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/stage-transitions`).send({ expectedRevision: 3, action: 'end_session', stageId: stages[1].id, outcome: 'completed' })
    expect(stale.status).toBe(409)
    const ended = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/stage-transitions`).send({ expectedRevision: 4, action: 'end_session', stageId: stages[1].id, outcome: 'completed', reason: '课堂目标完成' })
    expect(ended.status).toBe(200)
    expect(await prisma.trainingSession.findUnique({ where: { id: sessionId }, select: { status: true } })).toEqual({ status: 'ENDED' })
    expect((await prisma.trainingSessionStage.findUniqueOrThrow({ where: { id: stages[1].id } })).lifecycle).toBe('COMPLETED')
  })

  it('previews explainable grouping and applies next-Stage changes only on transition', async () => {
    const peer = await createTestUser({ role: 'student', schoolId: coach.schoolId })
    await prisma.teamMember.create({ data: { id: crypto.randomUUID(), teamId: team.id, userId: peer.user.id, userType: 'student', role: 'member', status: 'active', joinedAt: new Date() } })
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({
      title: '动态分组训练', teamId: team.id, participantUserIds: [student.user.id, peer.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [
        { name: '全班热身', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [{ problemId: problem.id }] },
        { name: '分层训练', kind: 'TRAINING', audienceMode: 'GROUPED', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [], groups: [
          { clientKey: 'foundation', name: '基础组', participantIds: [student.user.id], problems: [{ problemId: problem.id }] },
          { clientKey: 'advanced', name: '提高组', participantIds: [peer.user.id], problems: [{ problemId: problem.id }] },
        ] },
      ],
    })
    expect(created.status).toBe(201)
    const sessionId = created.body.data.id as string
    const session = await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId }, include: { Stages: { orderBy: { orderIndex: 'asc' }, include: { Groups: true } }, Participants: true } })
    const [warmup, grouped] = session.Stages

    const suggestions = await createAuthenticatedRequest(app, token).get(`/api/training-sessions/${sessionId}/stages/${grouped.id}/group-suggestions`)
    expect(suggestions.status).toBe(200)
    expect(suggestions.body.data.suggestions).toHaveLength(2)
    expect(suggestions.body.data.suggestions.every((item: { reason: string }) => item.reason.length > 0)).toBe(true)
    expect(await prisma.trainingSessionStageGroupChange.count({ where: { sessionId } })).toBe(0)

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: warmup.id })).status).toBe(200)
    const participant = session.Participants.find(item => item.userId === student.user.id)!
    const targetGroup = grouped.Groups.find(item => item.name === '提高组')!
    const changed = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/stages/${warmup.id}/group-changes`).send({ expectedRevision: 2, participantId: participant.id, toGroupId: targetGroup.id, effectiveMode: 'next_stage', targetStageId: grouped.id, reason: '根据热身表现调整' })
    expect(changed.status).toBe(200)
    const pendingChange = await prisma.trainingSessionStageGroupChange.findFirstOrThrow({ where: { sessionId, participantId: participant.id } })
    expect(pendingChange.effectiveAt).toBeNull()

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/stage-transitions`).send({ expectedRevision: 3, action: 'advance', stageId: warmup.id, outcome: 'completed' })).status).toBe(200)
    expect((await prisma.trainingSessionStageGroupChange.findUniqueOrThrow({ where: { id: pendingChange.id } })).effectiveAt).not.toBeNull()
    expect(await prisma.trainingSessionStageParticipantAssignment.findUnique({ where: { stageId_participantId: { stageId: grouped.id, participantId: participant.id } }, select: { groupId: true } })).toEqual({ groupId: targetGroup.id })
  })
})
