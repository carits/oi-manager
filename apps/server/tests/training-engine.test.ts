import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { ensureInitialTestSetRevision } from '../src/modules/problem/problem.testset-revision.service'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestTeam, createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'
import { processDueTrainingSessions, resolveTrainingPermission, syncTrainingEngineSubmission } from '../src/modules/training-engine/training-engine.service'

const app = createTestApp()
const directories: string[] = []

async function configuredProblem(ownerId: string) {
  const id = crypto.randomUUID(), root = path.join(process.cwd(), 'testdata', id)
  directories.push(root); await fs.promises.mkdir(root, { recursive: true })
  await fs.promises.writeFile(path.join(root, '1.in'), '1 2\n'); await fs.promises.writeFile(path.join(root, '1.out'), '3\n')
  const config = 'mode: acm\ncases:\n  - input: 1.in\n    output: 1.out\n'
  const problem = await prisma.problem.create({ data: { id, platform: 'carits', problemId: `TE-${id.slice(0, 8)}`, title: '训练引擎题目', ownerId, visibility: 'public', libraryScope: 'platform', libraryKey: 'platform', status: 'published', judgeConfig: config } })
  for (const [filename, content] of [['1.in', '1 2\n'], ['1.out', '3\n']]) await prisma.testdataFile.create({ data: { id: crypto.randomUUID(), problemId: id, filename, size: Buffer.byteLength(content), md5: crypto.createHash('md5').update(content).digest('hex'), sha256: crypto.createHash('sha256').update(content).digest('hex') } })
  await ensureInitialTestSetRevision(id, ownerId)
  return problem
}

afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.promises.rm(directory, { recursive: true, force: true }))) })

describe('independent coach-directed training engine', () => {
  let coach: Awaited<ReturnType<typeof createTestUser>>, student: Awaited<ReturnType<typeof createTestUser>>, outsider: Awaited<ReturnType<typeof createTestUser>>, team: Awaited<ReturnType<typeof createTestTeam>>, problem: Awaited<ReturnType<typeof configuredProblem>>
  beforeEach(async () => {
    coach = await createTestUser({ role: 'teacher' }); student = await createTestUser({ role: 'student', schoolId: coach.schoolId }); outsider = await createTestUser({ role: 'student' })
    team = await createTestTeam({ schoolId: null, scope: 'personal', ownerId: coach.user.id, ownerType: 'user' })
    await prisma.teamMember.create({ data: { id: crypto.randomUUID(), teamId: team.id, userId: student.user.id, userType: 'student', role: 'member', status: 'active', joinedAt: new Date() } })
    problem = await configuredProblem(coach.user.id)
  })

  it('creates, pins, publishes and enforces sequential unlocks', async () => {
    const token = generateTokenFromUser(coach.user)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({ title: '顺序训练', teamId: team.id, templateKey: 'acm-sequential', stages: [{ name: '顺序', mode: 'SEQUENTIAL', advanceMode: 'MANUAL', problemAccessMode: 'SEQUENTIAL', submissionMode: 'ENABLED', problems: [{ problemId: problem.id }, { problemId: problem.id, alias: '重复不允许' }] }] })
    expect(created.status).toBe(422)
    const secondProblem = await configuredProblem(coach.user.id)
    const valid = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({ title: '顺序训练', teamId: team.id, stages: [{ name: '顺序', mode: 'SEQUENTIAL', advanceMode: 'MANUAL', problemAccessMode: 'SEQUENTIAL', submissionMode: 'ENABLED', problems: [{ problemId: problem.id }, { problemId: secondProblem.id }] }] })
    expect(valid.status).toBe(201)
    const published = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${valid.body.data.id}/publish`).send({ expectedRevision: 0 })
    expect(published.status).toBe(200)
    const session = await prisma.trainingSession.findUniqueOrThrow({ where: { id: valid.body.data.id }, include: { Stages: { include: { Problems: { orderBy: { orderIndex: 'asc' } } } }, Participants: true } })
    expect(session.Stages[0].Problems.every(item => Boolean(item.testSetRevisionId))).toBe(true)
    expect(session.Participants.some(item => item.userId === student.user.id)).toBe(true)
    await prisma.trainingSession.update({ where: { id: session.id }, data: { status: 'RUNNING', startedAt: new Date(), currentStageId: session.Stages[0].id } })
    const locked = await resolveTrainingPermission(student.user.id, session.id, session.Stages[0].Problems[1].id)
    expect(locked.reason).toBe('SEQUENTIAL_LOCK')
    const participant = await prisma.trainingSessionParticipant.findUniqueOrThrow({ where: { sessionId_userId: { sessionId: session.id, userId: student.user.id } } })
    await prisma.trainingSessionProblemProgress.create({ data: { participantId: participant.id, stageProblemId: session.Stages[0].Problems[0].id, status: 'COMPLETED', bestScore: 100, bestVerdict: 'accepted', acAt: new Date() } })
    expect((await resolveTrainingPermission(student.user.id, session.id, session.Stages[0].Problems[1].id)).canView).toBe(true)
    expect((await resolveTrainingPermission(outsider.user.id, session.id, session.Stages[0].Problems[0].id)).reason).toBe('NOT_PARTICIPANT')
  })

  it('freezes projected judge config in Submission and JudgeRun', async () => {
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    const session = await prisma.trainingSession.create({ data: { title: '专项训练', teamId: team.id, createdBy: coach.user.id, status: 'RUNNING', startedAt: new Date() } })
    const stage = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '专项', orderIndex: 0, mode: 'SCORE_PROGRESSIVE', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED', status: 'running', startedAt: new Date() } })
    await prisma.trainingSession.update({ where: { id: session.id }, data: { currentStageId: stage.id } })
    const projection = 'mode: acm\ncases: []\n'
    const stageProblem = await prisma.trainingSessionStageProblem.create({ data: { stageId: stage.id, problemId: problem.id, testSetRevisionId: revision.id, orderIndex: 0, judgeConfigProjection: projection } })
    const participant = await prisma.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: student.user.id, currentStageId: stage.id } })
    const response = await createAuthenticatedRequest(app, generateTokenFromUser(student.user)).post(`/api/training-sessions/${session.id}/submit`).send({ stageProblemId: stageProblem.id, language: 'cpp17', code: 'int main(){}' })
    expect(response.status).toBe(201)
    const submission = await prisma.submission.findUniqueOrThrow({ where: { id: response.body.data.id }, include: { CurrentJudgeRun: true } })
    expect(submission.judgeConfigSnapshot).toBe(projection)
    expect(submission.CurrentJudgeRun?.judgeConfigSnapshot).toBe(projection)
    expect(participant.id).toBeTruthy()
  })

  it('updates progress idempotently and automatically advances a completed stage', async () => {
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    const session = await prisma.trainingSession.create({ data: { title: '自动推进', teamId: team.id, createdBy: coach.user.id, status: 'RUNNING', startedAt: new Date(Date.now() - 60_000) } })
    const first = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '一', orderIndex: 0, mode: 'FREE', advanceMode: 'COMPLETION', completionThreshold: 100, problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED', status: 'running', startedAt: new Date(Date.now() - 60_000) } })
    const next = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '二', orderIndex: 1, mode: 'REVIEW', advanceMode: 'MANUAL', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED' } })
    await prisma.trainingSession.update({ where: { id: session.id }, data: { currentStageId: first.id } })
    const stageProblem = await prisma.trainingSessionStageProblem.create({ data: { stageId: first.id, problemId: problem.id, testSetRevisionId: revision.id, orderIndex: 0 } })
    const participant = await prisma.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: student.user.id, currentStageId: first.id } })
    const submission = await prisma.submission.create({ data: { userId: student.user.id, oj: 'carits', problemId: problem.problemId, language: 'cpp17', code: 'x', codeLength: 1, result: 'accepted', submitMethod: 'local', problemInternalId: problem.id, submitScope: 'training_engine', trainingSessionId: session.id, trainingStageProblemId: stageProblem.id, testSetRevisionId: revision.id } })
    await syncTrainingEngineSubmission({ id: submission.id, userId: student.user.id, trainingSessionId: session.id, trainingStageProblemId: stageProblem.id, result: 'accepted', score: 100 })
    await syncTrainingEngineSubmission({ id: submission.id, userId: student.user.id, trainingSessionId: session.id, trainingStageProblemId: stageProblem.id, result: 'accepted', score: 100 })
    expect(await prisma.trainingSessionScoreEvent.count({ where: { submissionId: submission.id } })).toBe(1)
    await processDueTrainingSessions()
    expect((await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } })).currentStageId).toBe(next.id)
    expect(participant.id).toBeTruthy()
  })
})
