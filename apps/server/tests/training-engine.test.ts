import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { ensureInitialTestSetRevision } from '../src/modules/problem/problem.testset-revision.service'
import { getCoachDashboard, getTrainingReport, listTrainingSessionTemplates, resolveTrainingPermission, syncTrainingEngineSubmission } from '../src/modules/training-engine/training-engine.service'
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
    coach = await createTestUser({ organization: { role: 'teacher' } })
    student = await createTestUser({ organization: { role: 'student', organizationId: coach.organization!.organizationId } })
    team = await createTestTeam({ organizationId: null, scope: 'personal', ownerId: coach.user.id, ownerType: 'user' })
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

  async function createTwoStageSession(title = '双阶段训练') {
    const response = await createAuthenticatedRequest(app, generateTokenFromUser(coach.user)).post('/api/training-sessions').send({
      title, teamId: team.id, participantUserIds: [student.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [
        { name: '阶段一', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [{ problemId: problem.id }] },
        { name: '阶段二', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [{ problemId: problem.id }] },
      ],
    })
    expect(response.status).toBe(201)
    return response.body.data
  }

  it('emits canonical domain events for lifecycle and runtime interventions', async () => {
    const created = await createSession()
    const token = generateTokenFromUser(coach.user)
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.id },
      include: { Stages: { include: { Problems: true } }, Participants: true },
    })
    const stage = session.Stages[0]
    const stageProblem = stage.Problems[0]

    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/publish`)
      .send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/stage-transitions`)
      .send({ expectedRevision: 1, action: 'start', stageId: stage.id })).status).toBe(200)

    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/commands`)
      .send({ expectedRevision: 2, type: 'PAUSE_SESSION', targetType: 'ALL', payload: { mode: 'SOFT' } })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/commands`)
      .send({ expectedRevision: 3, type: 'RESUME_SESSION', targetType: 'ALL', payload: {} })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/commands`)
      .send({ expectedRevision: 4, type: 'SHOW_MESSAGE', targetType: 'ALL', payload: { message: '请关注当前题目' } })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/commands`)
      .send({
        expectedRevision: 5,
        type: 'UNLOCK_FOR_USER',
        targetType: 'USER',
        targetId: student.user.id,
        payload: { stageProblemId: stageProblem.id },
      })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/commands`)
      .send({
        expectedRevision: 6,
        type: 'SKIP_FOR_USER',
        targetType: 'USER',
        targetId: student.user.id,
        payload: { stageProblemId: stageProblem.id },
      })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/stage-transitions`)
      .send({ expectedRevision: 7, action: 'end_session', stageId: stage.id, outcome: 'completed' })).status).toBe(200)

    const events = await prisma.trainingSessionEvent.findMany({
      where: { sessionId: session.id },
      orderBy: { seq: 'asc' },
      select: { type: true },
    })
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining([
      'training.session.scheduled',
      'training.session.started',
      'training.stage.started',
      'training.session.paused',
      'training.session.resumed',
      'training.message.shown',
      'training.problem.unlocked',
      'training.problem.skipped',
      'training.stage.ended',
      'training.session.ended',
    ]))
  })

  it('supports a read-only rollout switch without interrupting existing runtime sessions', async () => {
    const existing = await createSession()
    const token = generateTokenFromUser(coach.user)
    const stage = await prisma.trainingSessionStage.findFirstOrThrow({ where: { sessionId: existing.id } })
    const previous = process.env.TRAINING_STAGE_ENGINE_ROLLOUT
    process.env.TRAINING_STAGE_ENGINE_ROLLOUT = 'read_only'
    try {
      const blocked = await createAuthenticatedRequest(app, token)
        .post('/api/training-sessions')
        .send({
          title: '只读发布保护',
          teamId: team.id,
          participantUserIds: [student.user.id],
          settings: { participantTarget: 'custom_students' },
          stages: [{
            name: '训练',
            kind: 'TRAINING',
            audienceMode: 'ALL',
            endPolicy: 'MANUAL',
            accessPolicy: 'ALL_AT_ONCE',
            accessScope: 'CURRENT_STAGE',
            submissionMode: 'ENABLED',
            problems: [{ problemId: problem.id }],
          }],
        })
      expect(blocked.status).toBe(503)
      expect(blocked.body.error?.code || blocked.body.code).toBe('TRAINING_STAGE_ENGINE_READ_ONLY')

      expect((await createAuthenticatedRequest(app, token)
        .post(`/api/training-sessions/${existing.id}/publish`)
        .send({ expectedRevision: 0 })).status).toBe(200)
      expect((await createAuthenticatedRequest(app, token)
        .post(`/api/training-sessions/${existing.id}/stage-transitions`)
        .send({ expectedRevision: 1, action: 'start', stageId: stage.id })).status).toBe(200)
    } finally {
      if (previous === undefined) delete process.env.TRAINING_STAGE_ENGINE_ROLLOUT
      else process.env.TRAINING_STAGE_ENGINE_ROLLOUT = previous
    }
  })

  it('keeps currentStageId empty after publish and enters the first stage only on start', async () => {
    const created = await createTwoStageSession('发布不提前进入阶段')
    const token = generateTokenFromUser(coach.user)
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.id },
      include: { Stages: { orderBy: { orderIndex: 'asc' } }, Participants: true },
    })
    const first = session.Stages[0]

    const published = await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/publish`)
      .send({ expectedRevision: 0 })
    expect(published.status).toBe(200)

    const scheduled = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { Participants: true },
    })
    expect(scheduled.status).toBe('SCHEDULED')
    expect(scheduled.currentStageId).toBeNull()
    expect(scheduled.Participants.every(participant => participant.currentStageId === null)).toBe(true)

    const started = await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/stage-transitions`)
      .send({ expectedRevision: 1, action: 'start', stageId: first.id })
    expect(started.status).toBe(200)

    const running = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { Participants: true },
    })
    expect(running.currentStageId).toBe(first.id)
    expect(running.Participants.every(participant => participant.currentStageId === first.id)).toBe(true)
  })

  it('creates a multi-stage draft with independent grouping skeletons before problem assignment', async () => {
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token)
      .post('/api/training-sessions')
      .send({
        title: '创建时多阶段分组骨架',
        teamId: team.id,
        participantUserIds: [student.user.id],
        settings: { participantTarget: 'custom_students' },
        stages: [
          {
            name: '热身',
            kind: 'TRAINING',
            audienceMode: 'ALL',
            endPolicy: 'MANUAL',
            accessPolicy: 'ALL_AT_ONCE',
            accessScope: 'CURRENT_STAGE',
            submissionMode: 'ENABLED',
            problems: [],
            groups: [],
          },
          {
            name: '分层训练',
            kind: 'TRAINING',
            audienceMode: 'GROUPED',
            endPolicy: 'MANUAL',
            accessPolicy: 'ALL_AT_ONCE',
            accessScope: 'CURRENT_STAGE',
            submissionMode: 'ENABLED',
            problems: [],
            groups: [
              { clientKey: 'foundation', name: '基础组', participantIds: [], problems: [] },
              { clientKey: 'advanced', name: '提高组', participantIds: [], problems: [] },
            ],
          },
          {
            name: '统一讲解',
            kind: 'TEACHING',
            audienceMode: 'ALL',
            endPolicy: 'MANUAL',
            accessPolicy: 'TEACHER_CONTROLLED',
            accessScope: 'CURRENT_STAGE',
            submissionMode: 'DISABLED',
            problems: [],
            groups: [],
          },
        ],
      })

    expect(created.status).toBe(201)
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: {
        Stages: {
          orderBy: { orderIndex: 'asc' },
          include: {
            Groups: { orderBy: { orderIndex: 'asc' } },
            ParticipantAssignments: true,
          },
        },
      },
    })

    expect(session.status).toBe('DRAFT')
    expect(session.Stages.map(stage => [stage.name, stage.audienceMode])).toEqual([
      ['热身', 'ALL'],
      ['分层训练', 'GROUPED'],
      ['统一讲解', 'ALL'],
    ])
    expect(session.Stages[1].Groups.map(group => group.name)).toEqual(['基础组', '提高组'])
    expect(session.Stages[1].ParticipantAssignments).toHaveLength(1)
    expect(session.Stages[1].ParticipantAssignments[0].groupId).toBeNull()
  })

  it('ends the current stage through the explicit stage endpoint and advances to the next stage', async () => {
    const created = await createTwoStageSession('显式结束阶段')
    const token = generateTokenFromUser(coach.user)
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.id },
      include: { Stages: { orderBy: { orderIndex: 'asc' } } },
    })
    const [first, second] = session.Stages

    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/publish`)
      .send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/stage-transitions`)
      .send({ expectedRevision: 1, action: 'start', stageId: first.id })).status).toBe(200)

    const ended = await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/stages/${first.id}/end`)
      .send({ expectedRevision: 2, outcome: 'ended_early', reason: '课堂提前完成' })
    expect(ended.status).toBe(200)
    expect(ended.body.data.session).toMatchObject({ status: 'RUNNING', currentStageId: second.id })

    expect(await prisma.trainingSessionStage.findUniqueOrThrow({ where: { id: first.id } }))
      .toMatchObject({ lifecycle: 'ENDED', endReason: 'TEACHER_ENDED_EARLY', endNote: '课堂提前完成' })
    expect(await prisma.trainingSessionStage.findUniqueOrThrow({ where: { id: second.id } }))
      .toMatchObject({ lifecycle: 'RUNNING' })
  })

  it('clones only stage definition with new ids and resets all runtime state', async () => {
    const secondProblem = await configuredProblem(coach.user.id)
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({
      title: '阶段复制', teamId: team.id, participantUserIds: [student.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [{
        name: '分层训练', kind: 'TRAINING', audienceMode: 'GROUPED', endPolicy: 'MANUAL',
        accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [],
        groups: [
          { clientKey: 'foundation', name: '基础组', participantIds: [student.user.id], problems: [{ problemId: problem.id }] },
          { clientKey: 'advanced', name: '提高组', participantIds: [], problems: [{ problemId: secondProblem.id }] },
        ],
      }],
    })
    expect(created.status).toBe(201)
    const source = await prisma.trainingSessionStage.findFirstOrThrow({
      where: { sessionId: created.body.data.id },
      include: {
        Problems: { include: { Hints: true } },
        Groups: true,
        ProblemPlans: true,
        ParticipantAssignments: true,
      },
    })
    await prisma.trainingSessionHint.create({
      data: {
        sessionId: created.body.data.id,
        stageProblemId: source.Problems[0].id,
        level: 1,
        title: '提示 1',
        content: '先观察样例',
        createdBy: coach.user.id,
      },
    })

    const cloned = await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${created.body.data.id}/stages/${source.id}/clone`)
      .send({ expectedRevision: 0, name: '分层训练（第二轮）' })
    expect(cloned.status).toBe(200)
    expect(cloned.body.data.statusRevision).toBe(1)

    const stages = await prisma.trainingSessionStage.findMany({
      where: { sessionId: created.body.data.id },
      orderBy: { orderIndex: 'asc' },
      include: {
        Problems: { include: { Hints: true, Progress: true } },
        Groups: true,
        ProblemPlans: true,
        ParticipantAssignments: true,
        RuntimeSnapshot: true,
        TimeAdjustments: true,
      },
    })
    expect(stages).toHaveLength(2)
    const copy = stages[1]
    expect(copy).toMatchObject({
      name: '分层训练（第二轮）',
      lifecycle: 'PENDING',
      runningSince: null,
      activeElapsedSeconds: 0,
      startedAt: null,
      endedAt: null,
      endReason: null,
      RuntimeSnapshot: null,
      TimeAdjustments: [],
    })
    expect(new Set(copy.Problems.map(item => item.id))).not.toEqual(new Set(source.Problems.map(item => item.id)))
    expect(copy.Problems.map(item => item.problemId).sort()).toEqual(source.Problems.map(item => item.problemId).sort())
    expect(copy.Groups.map(item => item.name).sort()).toEqual(source.Groups.map(item => item.name).sort())
    expect(copy.Groups.every(item => !source.Groups.some(sourceGroup => sourceGroup.id === item.id))).toBe(true)
    expect(copy.ProblemPlans).toHaveLength(source.ProblemPlans.length)
    expect(copy.ParticipantAssignments).toHaveLength(source.ParticipantAssignments.length)
    expect(copy.Problems.flatMap(item => item.Progress)).toHaveLength(0)
    expect(copy.Problems.flatMap(item => item.Hints).map(item => item.content)).toContain('先观察样例')
    expect(copy.Problems.flatMap(item => item.Hints).every(item => item.globallyOpenedAt === null)).toBe(true)
  })

  it('moves a participant through the explicit stage move endpoint', async () => {
    const secondProblem = await configuredProblem(coach.user.id)
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({
      title: '显式换组', teamId: team.id, participantUserIds: [student.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [{
        name: '分层训练', kind: 'TRAINING', audienceMode: 'GROUPED', endPolicy: 'MANUAL',
        accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [],
        groups: [
          { clientKey: 'foundation', name: '基础组', participantIds: [student.user.id], problems: [{ problemId: problem.id }] },
          { clientKey: 'advanced', name: '提高组', participantIds: [], problems: [{ problemId: secondProblem.id }] },
        ],
      }],
    })
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: { Stages: { include: { Groups: true } }, Participants: true },
    })
    const stage = session.Stages[0]
    const advanced = stage.Groups.find(group => group.name === '提高组')!

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: stage.id })).status).toBe(200)

    const moved = await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/stages/${stage.id}/move-participant`)
      .send({
        expectedRevision: 2,
        participantId: session.Participants[0].id,
        toGroupId: advanced.id,
        effectiveMode: 'immediate',
        reason: '显式 API 换组',
      })
    expect(moved.status).toBe(200)
    expect(moved.body.data.participant.currentGroupId).toBe(advanced.id)
  })

  it('fails fast before starting a grouped stage with an unassigned active participant', async () => {
    const secondProblem = await configuredProblem(coach.user.id)
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({
      title: '分组启动校验', teamId: team.id, participantUserIds: [student.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [{
        name: '分层训练', kind: 'TRAINING', audienceMode: 'GROUPED', endPolicy: 'MANUAL',
        accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [],
        groups: [
          { clientKey: 'foundation', name: '基础组', participantIds: [student.user.id], problems: [{ problemId: problem.id }] },
          { clientKey: 'advanced', name: '提高组', participantIds: [], problems: [{ problemId: secondProblem.id }] },
        ],
      }],
    })
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: { Stages: true, Participants: true },
    })
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    await prisma.trainingSessionStageParticipantAssignment.delete({
      where: { stageId_participantId: { stageId: session.Stages[0].id, participantId: session.Participants[0].id } },
    })

    const started = await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/stage-transitions`)
      .send({ expectedRevision: 1, action: 'start', stageId: session.Stages[0].id })
    expect(started.status).toBe(422)
    expect(started.body.code || started.body.error?.code).toBe('TRAINING_GROUP_ASSIGNMENT_INCOMPLETE')
  })

  it('keeps dashboard current-stage state empty after publish and before start', async () => {
    const created = await createSession()
    const token = generateTokenFromUser(coach.user)

    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${created.id}/publish`)
      .send({ expectedRevision: 0 })).status).toBe(200)

    const published = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.id },
      select: { currentStageId: true, status: true },
    })
    expect(published).toEqual({ currentStageId: null, status: 'SCHEDULED' })

    const dashboard = await getCoachDashboard(coach.user.id, created.id)
    expect(dashboard.session.currentStageId).toBeNull()
    expect(dashboard.summary).toEqual({ total: 1, working: 0, stuck: 0, completed: 0 })
    expect(dashboard.participants[0]).toMatchObject({
      currentStageId: null,
      currentGroupId: null,
      requiredCount: 0,
      completedCount: 0,
      completed: false,
      working: false,
      stuck: false,
    })
  })

  it('serializes concurrent Stage transitions with advisory lock and revision CAS', async () => {
    const created = await createSession()
    const token = generateTokenFromUser(coach.user)
    const stage = await prisma.trainingSessionStage.findFirstOrThrow({ where: { sessionId: created.id } })

    const published = await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${created.id}/publish`)
      .send({ expectedRevision: 0 })
    expect(published.status).toBe(200)

    const [first, second] = await Promise.all([
      createAuthenticatedRequest(app, token)
        .post(`/api/training-sessions/${created.id}/stage-transitions`)
        .send({ expectedRevision: 1, action: 'start', stageId: stage.id }),
      createAuthenticatedRequest(app, token)
        .post(`/api/training-sessions/${created.id}/stage-transitions`)
        .send({ expectedRevision: 1, action: 'start', stageId: stage.id }),
    ])

    expect([first.status, second.status].sort()).toEqual([200, 409])
    const persisted = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.id },
      include: { Stages: { where: { lifecycle: 'RUNNING' } } },
    })
    expect(persisted.status).toBe('RUNNING')
    expect(persisted.Stages).toHaveLength(1)
    expect(persisted.currentStageId).toBe(stage.id)
  })

  it('freezes the running Stage definition while allowing future Stage edits', async () => {
    const created = await createTwoStageSession('运行中结构冻结')
    const token = generateTokenFromUser(coach.user)
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.id },
      include: { Stages: { orderBy: { orderIndex: 'asc' } } },
    })
    const [currentStage, futureStage] = session.Stages

    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/publish`)
      .send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/stage-transitions`)
      .send({ expectedRevision: 1, action: 'start', stageId: currentStage.id })).status).toBe(200)

    const designResponse = await createAuthenticatedRequest(app, token)
      .get(`/api/training-sessions/${session.id}/design`)
    expect(designResponse.status).toBe(200)
    const design = designResponse.body.data
    const current = design.stages.find((stage: any) => stage.id === currentStage.id)
    const future = design.stages.find((stage: any) => stage.id === futureStage.id)

    const response = await createAuthenticatedRequest(app, token)
      .put(`/api/training-sessions/${session.id}/structure`)
      .send({
        expectedRevision: design.statusRevision,
        title: design.session.title,
        description: design.session.description,
        stages: [
          ...design.stages.map((stage: any) => ({
            id: stage.id,
            clientKey: stage.clientKey,
            name: stage.id === currentStage.id ? '不应写入的当前阶段新名称' : stage.id === futureStage.id ? '允许修改的未来阶段新名称' : stage.name,
            description: stage.description,
            kind: stage.kind,
            audienceMode: stage.audienceMode,
            endPolicy: stage.endPolicy,
            accessPolicy: stage.accessPolicy,
            accessScope: stage.accessScope || 'CURRENT_STAGE',
            submissionMode: stage.submissionMode,
            plannedDurationSeconds: stage.plannedDurationSeconds,
            defaultTargetScore: stage.defaultTargetScore,
            completionThreshold: stage.completionThreshold,
            minDurationSeconds: stage.minDurationSeconds,
            rules: stage.rules,
            problems: stage.Problems.map((problem: any) => ({
              assignmentId: problem.assignmentId,
              clientKey: problem.clientKey,
              problemId: problem.problemId,
              testSetRevisionId: problem.testSetRevisionId,
              alias: problem.alias,
              unlockPolicy: problem.unlockPolicy,
              targetScore: problem.targetScore,
              scoreGoals: problem.scoreGoals,
              timePolicy: problem.timePolicy,
              stuckPolicy: problem.stuckPolicy,
              allowedSubtaskIds: problem.allowedSubtaskIds,
              strategyIntervalSeconds: problem.strategyIntervalSeconds,
            })),
            groups: stage.Groups.map((group: any) => ({
              id: group.id,
              clientKey: group.clientKey,
              name: group.name,
              accessPolicy: group.accessPolicy,
              submissionMode: group.submissionMode,
              rules: group.rules,
              participantIds: group.participantIds,
              problems: group.Problems.map((problem: any) => ({
                assignmentId: problem.assignmentId,
                clientKey: problem.clientKey,
                problemId: problem.problemId,
                testSetRevisionId: problem.testSetRevisionId,
                alias: problem.alias,
                unlockPolicy: problem.unlockPolicy,
                targetScore: problem.targetScore,
                scoreGoals: problem.scoreGoals,
                timePolicy: problem.timePolicy,
                stuckPolicy: problem.stuckPolicy,
                allowedSubtaskIds: problem.allowedSubtaskIds,
                strategyIntervalSeconds: problem.strategyIntervalSeconds,
              })),
            })),
          })),
          {
            clientKey: 'runtime-added-review-stage',
            name: '运行中新增的未来复盘阶段',
            description: '课堂运行中追加',
            kind: 'REVIEW',
            audienceMode: 'ALL',
            endPolicy: 'MANUAL',
            accessPolicy: 'ALL_AT_ONCE',
            accessScope: 'CURRENT_STAGE',
            submissionMode: 'DISABLED',
            rules: {},
            problems: [],
            groups: [],
          },
        ],
      })
    expect(response.status).toBe(200)

    const persisted = await prisma.trainingSessionStage.findMany({
      where: { sessionId: session.id },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, name: true, lifecycle: true },
    })
    expect(persisted).toHaveLength(3)
    expect(persisted[0]).toMatchObject({ id: currentStage.id, name: current.name, lifecycle: 'RUNNING' })
    expect(persisted[1]).toMatchObject({ id: futureStage.id, name: '允许修改的未来阶段新名称', lifecycle: 'PENDING' })
    expect(persisted[2]).toMatchObject({ name: '运行中新增的未来复盘阶段', lifecycle: 'PENDING' })
    expect((await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id }, select: { currentStageId: true } })).currentStageId).toBe(currentStage.id)
  })

  it('limits participant reports to the requesting student while managers see the full roster', async () => {
    const peer = await createTestUser({ organization: { role: 'student', organizationId: coach.organization!.organizationId } })
    await prisma.teamMember.create({
      data: {
        id: crypto.randomUUID(),
        teamId: team.id,
        userId: peer.user.id,
        userType: 'student',
        role: 'member',
        status: 'active',
        joinedAt: new Date(),
      },
    })
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({
      title: '报告隐私边界',
      teamId: team.id,
      participantUserIds: [student.user.id, peer.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [{
        name: '训练',
        kind: 'TRAINING',
        audienceMode: 'ALL',
        endPolicy: 'MANUAL',
        accessPolicy: 'ALL_AT_ONCE',
        submissionMode: 'ENABLED',
        problems: [{ problemId: problem.id }],
      }],
    })
    expect(created.status).toBe(201)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${created.body.data.id}/publish`)
      .send({ expectedRevision: 0 })).status).toBe(200)

    const managerReport = await getTrainingReport(coach.user.id, created.body.data.id)
    expect(managerReport.participants.map(item => item.user.id).sort()).toEqual([student.user.id, peer.user.id].sort())
    expect(managerReport.sessionSummary.participantCount).toBe(2)

    const studentReport = await getTrainingReport(student.user.id, created.body.data.id)
    expect(studentReport.participants).toHaveLength(1)
    expect(studentReport.participants[0].user.id).toBe(student.user.id)
    expect(studentReport.sessionSummary.participantCount).toBe(1)
    expect(studentReport.groupSummaries).toEqual([])
    expect(studentReport.problemSummaries).toEqual([])
    expect(studentReport.groupChanges.every(change => change.participantId === studentReport.participants[0].id)).toBe(true)
  })

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
    expect(report.participants[0].problems[0]).toMatchObject({ status: 'NOT_STARTED', requirementState: 'REQUIRED', attemptCount: 0 })
  })

  it('enforces an explicit single-problem time policy instead of a hard-coded switch rule', async () => {
    const created = await createSession({ problems: [{ problemId: problem.id, timePolicy: { mode: 'LOCK_SUBMISSION', action: 'LOCK_SUBMISSION', limitSeconds: 60 }, stuckPolicy: { minActiveSeconds: 300, minAttempts: 2, noImprovementSeconds: 180 } }] })
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

  it('supports AC, score, time, attempts and teacher unlock sequential prerequisites', async () => {
    const secondProblem = await configuredProblem(coach.user.id)
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({
      title: '顺序解锁条件全集', teamId: team.id, participantUserIds: [student.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [{
        name: '顺序训练', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL',
        accessPolicy: 'SEQUENTIAL', submissionMode: 'ENABLED',
        problems: [
          { problemId: problem.id },
          { problemId: secondProblem.id, unlockPolicy: { mode: 'ALL', conditions: [{ type: 'AC' }] } },
        ],
      }],
    })
    expect(created.status).toBe(201)
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: {
        Stages: { include: { Problems: { orderBy: { orderIndex: 'asc' }, include: { Plans: true } } } },
        Participants: true,
      },
    })
    const stage = session.Stages[0]
    const [first, second] = stage.Problems
    const secondPlan = second.Plans[0]
    const participant = session.Participants[0]

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: stage.id })).status).toBe(200)

    await prisma.trainingSessionProblemProgress.create({
      data: {
        participantId: participant.id,
        stageProblemId: first.id,
        status: 'WORKING',
        activeSeconds: 0,
        attemptCount: 0,
        bestScore: 0,
      },
    })

    const assertGate = async (
      condition: Record<string, unknown>,
      progress: { acAt?: Date | null; bestVerdict?: string | null; bestScore?: number | null; activeSeconds?: number; attemptCount?: number },
    ) => {
      await prisma.trainingSessionStageProblemPlan.update({
        where: { id: secondPlan.id },
        data: { unlockPolicy: { mode: 'ALL', conditions: [condition] } },
      })
      await prisma.trainingSessionProblemProgress.update({
        where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: first.id } },
        data: {
          status: 'WORKING',
          acAt: progress.acAt ?? null,
          bestVerdict: progress.bestVerdict ?? null,
          bestScore: progress.bestScore ?? 0,
          activeSeconds: progress.activeSeconds ?? 0,
          attemptCount: progress.attemptCount ?? 0,
        },
      })
      expect(await resolveTrainingPermission(student.user.id, session.id, second.id)).toMatchObject({
        canView: true,
        canSubmit: true,
        reason: 'ALLOWED',
      })
    }

    await assertGate({ type: 'AC' }, { acAt: new Date(), bestVerdict: 'Accepted' })
    await assertGate({ type: 'SCORE', value: 60 }, { bestScore: 60 })
    await assertGate({ type: 'TIME', value: 120 }, { activeSeconds: 120 })
    await assertGate({ type: 'ATTEMPTS', value: 3 }, { attemptCount: 3 })

    await prisma.trainingSessionStageProblemPlan.update({
      where: { id: secondPlan.id },
      data: { unlockPolicy: { mode: 'ALL', conditions: [{ type: 'TEACHER' }] } },
    })
    await prisma.trainingSessionProblemProgress.update({
      where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: first.id } },
      data: { status: 'WORKING', acAt: null, bestVerdict: null, bestScore: 0, activeSeconds: 0, attemptCount: 0 },
    })
    expect(await resolveTrainingPermission(student.user.id, session.id, second.id)).toMatchObject({ canView: false, reason: 'SEQUENTIAL_LOCK' })

    const unlocked = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/commands`).send({
      expectedRevision: 2,
      type: 'UNLOCK_FOR_USER',
      targetType: 'USER',
      targetId: student.user.id,
      payload: { stageProblemId: second.id },
    })
    expect(unlocked.status).toBe(200)
    expect(await resolveTrainingPermission(student.user.id, session.id, second.id)).toMatchObject({ canView: true, canSubmit: true, reason: 'ALLOWED' })
  })

  it('emits canonical domain events for lifecycle and runtime interventions', async () => {
    const created = await createSession()
    const token = generateTokenFromUser(coach.user)
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.id },
      include: { Stages: { include: { Problems: true } } },
    })
    const stage = session.Stages[0]
    const stageProblem = stage.Problems[0]

    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/publish`)
      .send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/stage-transitions`)
      .send({ expectedRevision: 1, action: 'start', stageId: stage.id })).status).toBe(200)

    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/commands`)
      .send({ expectedRevision: 2, type: 'PAUSE_SESSION', targetType: 'ALL', payload: { mode: 'SOFT' } })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/commands`)
      .send({ expectedRevision: 3, type: 'RESUME_SESSION', targetType: 'ALL', payload: {} })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/commands`)
      .send({ expectedRevision: 4, type: 'SHOW_MESSAGE', targetType: 'ALL', payload: { message: '进入下一轮', messageType: 'INSTRUCTION' } })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token)
      .post(`/api/training-sessions/${session.id}/commands`)
      .send({
        expectedRevision: 5,
        type: 'UNLOCK_FOR_USER',
        targetType: 'USER',
        targetId: student.user.id,
        payload: { stageProblemId: stageProblem.id },
      })).status).toBe(200)

    const events = await prisma.trainingSessionEvent.findMany({
      where: { sessionId: session.id },
      orderBy: { seq: 'asc' },
      select: { type: true },
    })
    const types = events.map(event => event.type)
    expect(types).toEqual(expect.arrayContaining([
      'training.session.scheduled',
      'training.session.started',
      'training.stage.started',
      'training.session.paused',
      'training.session.resumed',
      'training.message.shown',
      'training.problem.unlocked',
    ]))
  })

  it('does not count paused wall-clock time toward Session or Stage active time', async () => {
    const created = await createSession()
    const token = generateTokenFromUser(coach.user)
    const stage = await prisma.trainingSessionStage.findFirstOrThrow({ where: { sessionId: created.id } })

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: stage.id })).status).toBe(200)

    const twoMinutesAgo = new Date(Date.now() - 120_000)
    await prisma.trainingSession.update({ where: { id: created.id }, data: { runningSince: twoMinutesAgo, activeElapsedSeconds: 0 } })
    await prisma.trainingSessionStage.update({ where: { id: stage.id }, data: { runningSince: twoMinutesAgo, activeElapsedSeconds: 0 } })

    const paused = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/commands`).send({
      expectedRevision: 2,
      type: 'PAUSE_SESSION',
      targetType: 'ALL',
      payload: { mode: 'SOFT' },
    })
    expect(paused.status).toBe(200)
    const afterPauseSession = await prisma.trainingSession.findUniqueOrThrow({ where: { id: created.id } })
    const afterPauseStage = await prisma.trainingSessionStage.findUniqueOrThrow({ where: { id: stage.id } })
    expect(afterPauseSession.activeElapsedSeconds).toBeGreaterThanOrEqual(119)
    expect(afterPauseSession.activeElapsedSeconds).toBeLessThanOrEqual(121)
    expect(afterPauseStage.activeElapsedSeconds).toBeGreaterThanOrEqual(119)
    expect(afterPauseStage.activeElapsedSeconds).toBeLessThanOrEqual(121)

    await prisma.trainingSession.update({ where: { id: created.id }, data: { pausedAt: new Date(Date.now() - 600_000) } })
    const resumed = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/commands`).send({
      expectedRevision: 3,
      type: 'RESUME_SESSION',
      targetType: 'ALL',
      payload: {},
    })
    expect(resumed.status).toBe(200)
    const afterResumeSession = await prisma.trainingSession.findUniqueOrThrow({ where: { id: created.id } })
    const afterResumeStage = await prisma.trainingSessionStage.findUniqueOrThrow({ where: { id: stage.id } })
    expect(afterResumeSession.activeElapsedSeconds).toBe(afterPauseSession.activeElapsedSeconds)
    expect(afterResumeStage.activeElapsedSeconds).toBe(afterPauseStage.activeElapsedSeconds)
  })

  it('treats teacher SKIP as a sequential prerequisite bypass', async () => {
    const secondProblem = await configuredProblem(coach.user.id)
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({
      title: '顺序跳题训练', teamId: team.id, participantUserIds: [student.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [{
        name: '顺序训练', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL',
        accessPolicy: 'SEQUENTIAL', submissionMode: 'ENABLED',
        problems: [{ problemId: problem.id }, { problemId: secondProblem.id, unlockPolicy: { mode: 'ALL', conditions: [{ type: 'TEACHER' }] } }],
      }],
    })
    expect(created.status).toBe(201)
    const session = await prisma.trainingSession.findUniqueOrThrow({ where: { id: created.body.data.id }, include: { Stages: { include: { Problems: { orderBy: { orderIndex: 'asc' } } } } } })
    const stage = session.Stages[0]
    const [first, second] = stage.Problems

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: stage.id })).status).toBe(200)
    expect(await resolveTrainingPermission(student.user.id, session.id, second.id)).toMatchObject({ canView: false, reason: 'SEQUENTIAL_LOCK' })

    const skipped = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/commands`).send({
      expectedRevision: 2,
      type: 'SKIP_FOR_USER',
      targetType: 'USER',
      targetId: student.user.id,
      payload: { stageProblemId: first.id },
    })
    expect(skipped.status).toBe(200)
    expect(await resolveTrainingPermission(student.user.id, session.id, second.id)).toMatchObject({ canView: true, canSubmit: true, reason: 'ALLOWED' })
  })

  it('advances progressive score targets without completing before the final target', async () => {
    const created = await createSession({
      problems: [{ problemId: problem.id, scoreGoals: [{ score: 30 }, { score: 60 }, { score: 100 }] }],
    })
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.id },
      include: { Stages: { include: { Problems: true } }, Participants: true },
    })
    const stageProblem = session.Stages[0].Problems[0]
    const participant = session.Participants[0]

    for (const score of [30, 60, 100]) {
      const submission = await prisma.submission.create({ data: {
        userId: student.user.id,
        oj: 'carits',
        problemId: problem.problemId,
        language: 'cpp17',
        code: 'int main(){}',
        codeLength: 12,
        submitMethod: 'local',
        submitScope: 'training_engine',
        trainingSessionId: session.id,
        trainingStageProblemId: stageProblem.id,
      } })
      await syncTrainingEngineSubmission({
        id: submission.id,
        userId: student.user.id,
        trainingSessionId: session.id,
        trainingStageProblemId: stageProblem.id,
        result: score === 100 ? 'Accepted' : 'Partial Accepted',
        score,
        trainingScoreGoalSnapshot: { score },
      })
      const progress = await prisma.trainingSessionProblemProgress.findUniqueOrThrow({
        where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: stageProblem.id } },
      })
      expect(progress.bestScore).toBe(score)
      expect(progress.status).toBe(score === 100 ? 'COMPLETED' : 'WORKING')
    }

    const events = await prisma.trainingSessionScoreEvent.findMany({
      where: { sessionId: session.id, stageProblemId: stageProblem.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(events.map(event => event.score)).toEqual([30, 60, 100])
  })

  it('keeps STUCK after an ordinary non-improving submission', async () => {
    const created = await createSession()
    const session = await prisma.trainingSession.findUniqueOrThrow({ where: { id: created.id }, include: { Stages: { include: { Problems: true } }, Participants: true } })
    const stageProblem = session.Stages[0].Problems[0]
    const participant = session.Participants[0]
    await prisma.trainingSessionProblemProgress.create({ data: {
      participantId: participant.id,
      stageProblemId: stageProblem.id,
      status: 'STUCK',
      bestScore: 20,
      attemptCount: 2,
      stuckDetectedAt: new Date(),
      lastProgressAt: new Date(),
    } })
    const submission = await prisma.submission.create({ data: {
      userId: student.user.id,
      oj: 'carits',
      problemId: problem.problemId,
      language: 'cpp17',
      code: 'int main(){}',
      codeLength: 12,
      submitMethod: 'local',
      submitScope: 'training_engine',
      trainingSessionId: session.id,
      trainingStageProblemId: stageProblem.id,
    } })
    await syncTrainingEngineSubmission({
      id: submission.id,
      userId: student.user.id,
      trainingSessionId: session.id,
      trainingStageProblemId: stageProblem.id,
      result: 'Wrong Answer',
      score: 10,
    })
    expect(await prisma.trainingSessionProblemProgress.findUniqueOrThrow({
      where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: stageProblem.id } },
      select: { status: true, bestScore: true, stuckDetectedAt: true },
    })).toMatchObject({ status: 'STUCK', bestScore: 20, stuckDetectedAt: expect.any(Date) })
  })

  it('marks old group requirements retired after an immediate group move', async () => {
    const secondProblem = await configuredProblem(coach.user.id)
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({
      title: '换组 Requirement 训练', teamId: team.id, participantUserIds: [student.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [{
        name: '分层训练', kind: 'TRAINING', audienceMode: 'GROUPED', endPolicy: 'MANUAL',
        accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [],
        groups: [
          { clientKey: 'foundation', name: '基础组', participantIds: [student.user.id], problems: [{ problemId: problem.id }] },
          { clientKey: 'advanced', name: '提高组', participantIds: [], problems: [{ problemId: secondProblem.id }] },
        ],
      }],
    })
    expect(created.status).toBe(201)
    const session = await prisma.trainingSession.findUniqueOrThrow({ where: { id: created.body.data.id }, include: {
      Stages: { include: { Groups: true, Problems: true } },
      Participants: true,
    } })
    const stage = session.Stages[0]
    const foundation = stage.Groups.find(item => item.name === '基础组')!
    const advanced = stage.Groups.find(item => item.name === '提高组')!
    const firstProblem = stage.Problems.find(item => item.problemId === problem.id)!
    const participant = session.Participants[0]

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: stage.id })).status).toBe(200)
    await prisma.trainingSessionProblemProgress.create({ data: { participantId: participant.id, stageProblemId: firstProblem.id, status: 'WORKING', lastProgressAt: new Date() } })

    const moved = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/stages/${stage.id}/group-changes`).send({
      expectedRevision: 2,
      participantId: participant.id,
      toGroupId: advanced.id,
      effectiveMode: 'immediate',
      reason: '当前表现适合提高组',
    })
    expect(moved.status).toBe(200)
    await prisma.problem.update({ where: { id: problem.id }, data: { title: '题库后来改名，不应污染历史报告' } })
    const report = await getTrainingReport(coach.user.id, session.id)
    const entries = report.participants[0].problems
    expect(entries.find(item => item.problemId === problem.problemId)).toMatchObject({ requirementState: 'RETIRED', status: 'WORKING' })
    expect(entries.find(item => item.problemId === secondProblem.problemId)).toMatchObject({ requirementState: 'REQUIRED', status: 'NOT_STARTED' })
    expect(await prisma.trainingSessionStageGroupChange.findFirst({ where: { sessionId: session.id, participantId: participant.id } })).toMatchObject({
      fromGroupId: foundation.id,
      toGroupId: advanced.id,
      effectiveMode: 'IMMEDIATE',
    })
    expect(report.groupSummaries.find(item => item.groupId === foundation.id)).toMatchObject({ initialParticipantCount: 1, finalParticipantCount: 0 })
    expect(report.groupSummaries.find(item => item.groupId === advanced.id)).toMatchObject({ initialParticipantCount: 0, finalParticipantCount: 1 })
    expect(report.problemSummaries.some(item => item.title === '训练引擎题目')).toBe(true)
    expect(report.problemSummaries.some(item => item.title === '题库后来改名，不应污染历史报告')).toBe(false)
  })

  it('dispatches MOVE_GROUP as a Runtime Command without changing Stage Definition', async () => {
    const secondProblem = await configuredProblem(coach.user.id)
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({
      title: 'Runtime MOVE_GROUP', teamId: team.id, participantUserIds: [student.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [{
        name: '分层训练', kind: 'TRAINING', audienceMode: 'GROUPED', endPolicy: 'MANUAL',
        accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [],
        groups: [
          { clientKey: 'foundation', name: '基础组', participantIds: [student.user.id], problems: [{ problemId: problem.id }] },
          { clientKey: 'advanced', name: '提高组', participantIds: [], problems: [{ problemId: secondProblem.id }] },
        ],
      }],
    })
    expect(created.status).toBe(201)
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: { Stages: { include: { Groups: true } } },
    })
    const stage = session.Stages[0]
    const advanced = stage.Groups.find(item => item.name === '提高组')!
    const definitionRevisionBefore = stage.definitionRevision

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: stage.id })).status).toBe(200)

    const moved = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/commands`).send({
      expectedRevision: 2,
      type: 'MOVE_GROUP',
      targetType: 'USER',
      targetId: student.user.id,
      payload: {
        stageId: stage.id,
        toGroupId: advanced.id,
        effectiveMode: 'IMMEDIATE',
        reason: 'Runtime command group move',
      },
    })
    expect(moved.status).toBe(200)
    expect(moved.body.data.participant).toMatchObject({ currentGroupId: advanced.id })

    const persistedStage = await prisma.trainingSessionStage.findUniqueOrThrow({ where: { id: stage.id } })
    expect(persistedStage.definitionRevision).toBe(definitionRevisionBefore)
    expect(await prisma.trainingSessionStageGroupChange.findFirst({
      where: { sessionId: session.id, toGroupId: advanced.id },
    })).toMatchObject({ effectiveMode: 'IMMEDIATE', reason: 'Runtime command group move' })
  })

  it('binds Training Engine list, create, direct-id and templates to the active organization context', async () => {
    const otherSchool = await createTestUser({ organization: { role: 'teacher' } })
    const otherOrganizationId = otherSchool.organization!.organizationId
    const membershipId = crypto.randomUUID()
    await prisma.organizationMembership.create({
      data: {
        id: membershipId,
        organizationId: otherOrganizationId,
        userId: coach.user.id,
        memberRole: 'teacher',
        relationType: 'employee',
        status: 'active',
        joinedAt: new Date(),
        RoleAssignments: { create: { id: crypto.randomUUID(), roleKey: 'teacher', source: 'test_fixture' } },
      },
    })
    await prisma.organizationTeacherProfile.create({
      data: { id: crypto.randomUUID(), membershipId, name: '跨校训练教师', status: 'active' },
    })
    const studentB = await createTestUser({ organization: { role: 'student', organizationId: otherOrganizationId } })
    const token = generateTokenFromUser(coach.user)
    const currentOrganizationId = coach.organization!.organizationId

    const personalCreated = await createSession()
    const requestB = createAuthenticatedRequest(app, token, { organizationId: otherOrganizationId })
    const createdB = await requestB.post('/api/training-sessions').send({
      title: '学校B训练',
      organizationId: otherOrganizationId,
      participantUserIds: [studentB.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [{
        name: '训练', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL',
        accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED',
        problems: [{ problemId: problem.id }],
      }],
    })
    expect(createdB.status).toBe(201)
    const sessionId = createdB.body.data.id as string

    const personalList = await createAuthenticatedRequest(app, token).get('/api/training-sessions?page=1&pageSize=100')
    expect(personalList.status).toBe(200)
    expect(personalList.body.data.items.map((item: any) => item.id)).toContain(personalCreated.id)
    expect(personalList.body.data.items.map((item: any) => item.id)).not.toContain(sessionId)

    const implicitBList = await requestB.get('/api/training-sessions?page=1&pageSize=100')
    expect(implicitBList.status).toBe(200)
    expect(implicitBList.body.data.items.map((item: any) => item.id)).toContain(sessionId)
    expect(implicitBList.body.data.items.map((item: any) => item.id)).not.toContain(personalCreated.id)

    const requestA = createAuthenticatedRequest(app, token, { organizationId: currentOrganizationId })
    const crossList = await requestA.get(`/api/training-sessions?organizationId=${otherOrganizationId}`)
    expect(crossList.status).toBe(403)
    expect(crossList.body.code).toBe('TRAINING_SCOPE_CONTEXT_MISMATCH')

    const crossCreate = await requestA.post('/api/training-sessions').send({
      title: '不应创建到学校B',
      organizationId: otherOrganizationId,
      participantUserIds: [studentB.user.id],
      settings: { participantTarget: 'custom_students' },
      stages: [{
        name: '训练', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL',
        accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED',
        problems: [{ problemId: problem.id }],
      }],
    })
    expect(crossCreate.status).toBe(403)

    const crossDirect = await requestA.get(`/api/training-sessions/${sessionId}`)
    expect(crossDirect.status).toBe(404)

    const correctDirect = await requestB.get(`/api/training-sessions/${sessionId}`)
    expect(correctDirect.status).toBe(200)

    const savedTemplate = await requestB
      .post(`/api/training-sessions/${sessionId}/templates`)
      .send({ name: '学校B训练模板', scope: 'organization' })
    expect(savedTemplate.status).toBe(201)
    const templateId = String(savedTemplate.body.data.key).replace('database:', '')

    const crossDeleteTemplate = await requestA.delete(`/api/training-session-templates/${templateId}`)
    expect(crossDeleteTemplate.status).toBe(404)

    const correctDeleteTemplate = await requestB.delete(`/api/training-session-templates/${templateId}`)
    expect(correctDeleteTemplate.status).toBe(200)
  })

  it('loads design problem metadata through the declared :problemId route parameter', async () => {
    const created = await createSession()
    const response = await createAuthenticatedRequest(app, generateTokenFromUser(coach.user))
      .get(`/api/training-sessions/${created.id}/design-problems/${problem.id}`)
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      id: problem.id,
      problemId: problem.problemId,
      title: '训练引擎题目',
    })
  })

  it('rejects the retired FROM_BEGINNING join mode at the create contract boundary', async () => {
    const response = await createAuthenticatedRequest(app, generateTokenFromUser(coach.user)).post('/api/training-sessions').send({
      title: '非法迟到加入模式', teamId: team.id, participantUserIds: [student.user.id],
      settings: { participantTarget: 'custom_students' },
      joinMode: 'FROM_BEGINNING',
      stages: [{ name: '训练', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [{ problemId: problem.id }] }],
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(await prisma.trainingSession.count({ where: { title: '非法迟到加入模式' } })).toBe(0)
  })

  it('serves immutable statement snapshots and redacts future Stage metadata for students', async () => {
    await prisma.problemStatement.create({ data: {
      id: crypto.randomUUID(), problemId: problem.id, type: 'statement', format: 'markdown',
      language: 'zh-CN', content: '最初题面内容', isVisible: true,
    } })
    const created = await createTwoStageSession('题面快照与未来题脱敏')
    const token = generateTokenFromUser(coach.user)
    const session = await prisma.trainingSession.findUniqueOrThrow({ where: { id: created.id }, include: { Stages: { orderBy: { orderIndex: 'asc' }, include: { Problems: true } } } })
    const [currentStage, futureStage] = session.Stages

    await prisma.problem.update({ where: { id: problem.id }, data: { title: '后来修改的题名' } })
    await prisma.problemStatement.updateMany({ where: { problemId: problem.id }, data: { content: '后来修改的题面' } })

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: currentStage.id })).status).toBe(200)

    const workspace = await createAuthenticatedRequest(app, generateTokenFromUser(student.user)).get(`/api/training-sessions/${created.id}`)
    expect(workspace.status).toBe(200)
    const stages = workspace.body.data.session.Stages
    expect(stages[0].Problems[0].Problem.title).toBe('训练引擎题目')
    expect(stages[0].Problems[0].Statements).toEqual(expect.arrayContaining([expect.objectContaining({ content: '最初题面内容' })]))
    expect(stages[1].Problems[0].Problem).toMatchObject({ title: '未开放题目', platform: '', problemId: '' })
    expect(stages[1].Problems[0].Statements).toEqual([])
    expect(workspace.body.data.permissions[futureStage.Problems[0].id]).toMatchObject({ canView: false, canSeeMetadata: false, reason: 'FUTURE_STAGE' })
  })

  it('keeps future Stage metadata redacted while scheduled and paused', async () => {
    const created = await createTwoStageSession('计划与暂停状态脱敏')
    const coachToken = generateTokenFromUser(coach.user)
    const studentToken = generateTokenFromUser(student.user)
    const session = await prisma.trainingSession.findUniqueOrThrow({ where: { id: created.id }, include: { Stages: { orderBy: { orderIndex: 'asc' }, include: { Problems: true } } } })
    const [currentStage, futureStage] = session.Stages

    expect((await createAuthenticatedRequest(app, coachToken).post(`/api/training-sessions/${created.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    const scheduled = await createAuthenticatedRequest(app, studentToken).get(`/api/training-sessions/${created.id}`)
    expect(scheduled.status).toBe(200)
    expect(scheduled.body.data.session.Stages[1].Problems[0].Problem).toMatchObject({ title: '未开放题目', platform: '', problemId: '' })
    expect(scheduled.body.data.permissions[futureStage.Problems[0].id]).toMatchObject({ canSeeMetadata: false })

    expect((await createAuthenticatedRequest(app, coachToken).post(`/api/training-sessions/${created.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: currentStage.id })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, coachToken).post(`/api/training-sessions/${created.id}/commands`).send({ expectedRevision: 2, type: 'PAUSE_SESSION', targetType: 'ALL', payload: { mode: 'SOFT' } })).status).toBe(200)

    const paused = await createAuthenticatedRequest(app, studentToken).get(`/api/training-sessions/${created.id}`)
    expect(paused.status).toBe(200)
    expect(paused.body.data.session.Stages[1].Problems[0].Problem).toMatchObject({ title: '未开放题目', platform: '', problemId: '' })
    expect(paused.body.data.permissions[futureStage.Problems[0].id]).toMatchObject({ canSeeMetadata: false, reason: 'FUTURE_STAGE' })
  })

  it('normalizes TEAM commands to the current session team', async () => {
    const created = await createSession()
    const token = generateTokenFromUser(coach.user)
    const stage = await prisma.trainingSessionStage.findFirstOrThrow({ where: { sessionId: created.id } })
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: stage.id })).status).toBe(200)

    const response = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/commands`).send({
      expectedRevision: 2,
      type: 'SHOW_MESSAGE',
      targetType: 'TEAM',
      targetId: team.id,
      payload: { message: '团队提示', messageType: 'INFO' },
    })
    expect(response.status).toBe(200)
    expect(await prisma.trainingSessionOverlay.findFirst({ where: { sessionId: created.id, type: 'MESSAGE' }, select: { targetType: true, targetId: true } })).toEqual({ targetType: 'TEAM', targetId: team.id })
  })

  it('rejects runtime focus commands that target a non-current Stage', async () => {
    const created = await createTwoStageSession('跨阶段指令拒绝')
    const token = generateTokenFromUser(coach.user)
    const session = await prisma.trainingSession.findUniqueOrThrow({ where: { id: created.id }, include: { Stages: { orderBy: { orderIndex: 'asc' }, include: { Problems: true } } } })
    const [currentStage, futureStage] = session.Stages

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: currentStage.id })).status).toBe(200)

    const response = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/commands`).send({
      expectedRevision: 2,
      type: 'FOCUS_PROBLEM',
      targetType: 'ALL',
      payload: { stageProblemId: futureStage.Problems[0].id, mode: 'LOCKED_FOCUS' },
    })
    expect(response.status).toBe(422)
    expect(await prisma.trainingSessionOverlay.count({ where: { sessionId: created.id, stageProblemId: futureStage.Problems[0].id } })).toBe(0)
  })

  it('keeps the code draft after submitting the same StageProblem', async () => {
    const created = await createSession()
    const coachToken = generateTokenFromUser(coach.user)
    const studentToken = generateTokenFromUser(student.user)
    const stage = await prisma.trainingSessionStage.findFirstOrThrow({
      where: { sessionId: created.id },
      include: { Problems: true },
    })
    const stageProblem = stage.Problems[0]

    expect((await createAuthenticatedRequest(app, coachToken)
      .post(`/api/training-sessions/${created.id}/publish`)
      .send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, coachToken)
      .post(`/api/training-sessions/${created.id}/stage-transitions`)
      .send({ expectedRevision: 1, action: 'start', stageId: stage.id })).status).toBe(200)

    const source = '#include <bits/stdc++.h>\nint main(){return 0;}'
    const saved = await createAuthenticatedRequest(app, studentToken)
      .put(`/api/training-sessions/${created.id}/drafts/${stageProblem.id}`)
      .send({ language: 'cpp17', code: source })
    expect(saved.status).toBe(200)
    const revision = saved.body.data.revision

    const submitted = await createAuthenticatedRequest(app, studentToken)
      .post(`/api/training-sessions/${created.id}/submit`)
      .send({ stageProblemId: stageProblem.id, language: 'cpp17', code: source })
    expect(submitted.status).toBe(201)

    const draft = await createAuthenticatedRequest(app, studentToken)
      .get(`/api/training-sessions/${created.id}/drafts/${stageProblem.id}`)
    expect(draft.status).toBe(200)
    expect(draft.body.data).toMatchObject({
      stageProblemId: stageProblem.id,
      language: 'cpp17',
      code: source,
      revision,
    })
  })

  it('isolates drafts when the same Problem appears in different Stages', async () => {
    const created = await createTwoStageSession('跨阶段草稿隔离')
    const coachToken = generateTokenFromUser(coach.user)
    const studentToken = generateTokenFromUser(student.user)
    const session = await prisma.trainingSession.findUniqueOrThrow({ where: { id: created.id }, include: { Stages: { orderBy: { orderIndex: 'asc' }, include: { Problems: true } } } })
    const [firstStage, secondStage] = session.Stages
    const firstProblem = firstStage.Problems[0]
    const secondProblem = secondStage.Problems[0]

    expect((await createAuthenticatedRequest(app, coachToken).post(`/api/training-sessions/${created.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, coachToken).post(`/api/training-sessions/${created.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: firstStage.id })).status).toBe(200)

    const firstSave = await createAuthenticatedRequest(app, studentToken).put(`/api/training-sessions/${created.id}/drafts/${firstProblem.id}`).send({ language: 'cpp17', code: '// stage one' })
    expect(firstSave.status).toBe(200)

    expect((await createAuthenticatedRequest(app, coachToken).post(`/api/training-sessions/${created.id}/stage-transitions`).send({ expectedRevision: 2, action: 'advance', stageId: firstStage.id, outcome: 'completed' })).status).toBe(200)
    const secondSave = await createAuthenticatedRequest(app, studentToken).put(`/api/training-sessions/${created.id}/drafts/${secondProblem.id}`).send({ language: 'cpp17', code: '// stage two' })
    expect(secondSave.status).toBe(200)

    const drafts = await prisma.trainingSessionProblemDraft.findMany({ where: { sessionId: created.id, userId: student.user.id }, orderBy: { createdAt: 'asc' } })
    expect(drafts).toHaveLength(2)
    expect(new Set(drafts.map(item => item.stageProblemId))).toEqual(new Set([firstProblem.id, secondProblem.id]))
    expect(new Set(drafts.map(item => item.code))).toEqual(new Set(['// stage one', '// stage two']))
  })

  it('freezes hint definitions after the owning Stage starts', async () => {
    const created = await createSession()
    const token = generateTokenFromUser(coach.user)
    const stage = await prisma.trainingSessionStage.findFirstOrThrow({ where: { sessionId: created.id }, include: { Problems: true } })
    const stageProblem = stage.Problems[0]

    const createdHint = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/hints`).send({
      stageProblemId: stageProblem.id, level: 1, title: '一级提示', content: '先观察输入输出关系', openMode: 'MANUAL',
    })
    expect(createdHint.status).toBe(201)
    const hintId = createdHint.body.data.id as string

    const updatedHint = await createAuthenticatedRequest(app, token).patch(`/api/training-sessions/${created.id}/hints/${hintId}`).send({
      level: 1, title: '一级提示（修订）', content: '先观察样例中的输入输出关系', openMode: 'MANUAL',
    })
    expect(updatedHint.status).toBe(200)

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: stage.id })).status).toBe(200)

    const createAfterStart = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${created.id}/hints`).send({
      stageProblemId: stageProblem.id, level: 2, content: '运行后不应允许新增', openMode: 'MANUAL',
    })
    expect(createAfterStart.status).toBe(409)

    const updateAfterStart = await createAuthenticatedRequest(app, token).patch(`/api/training-sessions/${created.id}/hints/${hintId}`).send({
      level: 1, title: '不应成功', content: '运行后不应允许修改', openMode: 'MANUAL',
    })
    expect(updateAfterStart.status).toBe(409)

    const deleteAfterStart = await createAuthenticatedRequest(app, token).delete(`/api/training-sessions/${created.id}/hints/${hintId}`)
    expect(deleteAfterStart.status).toBe(409)
    expect(await prisma.trainingSessionHint.findUnique({ where: { id: hintId }, select: { title: true } })).toEqual({ title: '一级提示（修订）' })
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
    expect(afterAdvance.Stages.map(item => item.lifecycle)).toEqual(['ENDED', 'RUNNING'])
    expect(afterAdvance.Stages[0]).toMatchObject({ endReason: 'TEACHER_ENDED', endNote: null })
    expect(afterAdvance.Stages[1].RuntimeSnapshot).not.toBeNull()

    const stale = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/stage-transitions`).send({ expectedRevision: 3, action: 'end_session', stageId: stages[1].id, outcome: 'completed' })
    expect(stale.status).toBe(409)
    const ended = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/stage-transitions`).send({ expectedRevision: 4, action: 'end_session', stageId: stages[1].id, outcome: 'completed', reason: '课堂目标完成' })
    expect(ended.status).toBe(200)
    expect(await prisma.trainingSession.findUnique({ where: { id: sessionId }, select: { status: true } })).toEqual({ status: 'ENDED' })
    expect(await prisma.trainingSessionStage.findUniqueOrThrow({ where: { id: stages[1].id } })).toMatchObject({ lifecycle: 'ENDED', endReason: 'SESSION_ENDED', endNote: '课堂目标完成' })
    const report = await getTrainingReport(coach.user.id, sessionId)
    expect(report.sessionSummary).toMatchObject({ id: sessionId, status: 'ENDED', stageCount: 2, participantCount: 1 })
    expect(report.timeline[0]).toMatchObject({ lifecycle: 'ENDED', runtimeExtensionSeconds: 600, extensionSeconds: 600, endReason: 'TEACHER_ENDED' })
    expect(report.timeline[0].actualDurationSeconds).toBeGreaterThanOrEqual(0)
    expect(report.timeline[0].snapshotHash).toBeTruthy()
    expect(report.timeline[1]).toMatchObject({ lifecycle: 'ENDED', endReason: 'SESSION_ENDED', endNote: '课堂目标完成' })
    const rejectedAfterEnd = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/commands`).send({
      expectedRevision: 5,
      type: 'CLEAR_MESSAGE',
      targetType: 'ALL',
      payload: {},
    })
    expect(rejectedAfterEnd.status).toBe(409)
  })

  it('keeps V2 group assignments stable across different Stages', async () => {
    const secondProblem = await configuredProblem(coach.user.id)
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({
      title: '跨 Stage 分组隔离', teamId: team.id, participantUserIds: [student.user.id],
      settings: { participantTarget: 'custom_students' },
      grouping: { groups: [
        { clientKey: 'a', name: 'A组', participantIds: [student.user.id] },
        { clientKey: 'b', name: 'B组', participantIds: [] },
      ] },
      stages: [
        { name: 'Stage 1', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [{ problemId: problem.id }] },
        { name: 'Stage 2', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [{ problemId: secondProblem.id }] },
      ],
    })
    expect(created.status).toBe(201)
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: { Stages: { orderBy: { orderIndex: 'asc' }, include: { Groups: true, Problems: true } }, Participants: true },
    })
    const participant = session.Participants[0]
    const [stage1, stage2] = session.Stages
    const stage1Assignment = await prisma.trainingSessionStageParticipantAssignment.findUnique({ where: { stageId_participantId: { stageId: stage1.id, participantId: participant.id } }, select: { groupId: true } })
    const stage2Assignment = await prisma.trainingSessionStageParticipantAssignment.findUnique({ where: { stageId_participantId: { stageId: stage2.id, participantId: participant.id } }, select: { groupId: true } })
    expect(stage1Assignment?.groupId).toBeTruthy()
    expect(stage2Assignment).toEqual(stage1Assignment)

  })

  it('keeps historical STUCK and WORKING progress out of the current Stage dashboard', async () => {
    const created = await createTwoStageSession('Dashboard 当前 Stage 隔离')
    const token = generateTokenFromUser(coach.user)
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        Stages: { orderBy: { orderIndex: 'asc' }, include: { Problems: true } },
        Participants: true,
      },
    })
    const [stage1, stage2] = session.Stages
    const participant = session.Participants[0]

    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/publish`).send({ expectedRevision: 0 })).status).toBe(200)
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/stage-transitions`).send({ expectedRevision: 1, action: 'start', stageId: stage1.id })).status).toBe(200)

    await prisma.trainingSessionProblemProgress.create({
      data: {
        participantId: participant.id,
        stageProblemId: stage1.Problems[0].id,
        status: 'STUCK',
        attemptCount: 4,
        activeSeconds: 1800,
        stuckDetectedAt: new Date(),
        lastProgressAt: new Date(),
      },
    })
    expect((await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${session.id}/stage-transitions`).send({ expectedRevision: 2, action: 'advance', stageId: stage1.id, outcome: 'completed' })).status).toBe(200)

    const dashboard = await getCoachDashboard(coach.user.id, session.id)
    expect(dashboard.session.currentStageId).toBe(stage2.id)
    expect(dashboard.summary).toMatchObject({ working: 0, stuck: 0, completed: 0 })
    expect(dashboard.participants[0]).toMatchObject({ working: false, stuck: false, completed: false })
    expect(dashboard.participants[0].progress).toEqual(expect.arrayContaining([
      expect.objectContaining({ stageProblemId: stage1.Problems[0].id, status: 'STUCK' }),
    ]))
  })

  it('previews explainable grouping and applies next-Stage changes only on transition', async () => {
    const peer = await createTestUser({ organization: { role: 'student', organizationId: coach.organization!.organizationId } })
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
