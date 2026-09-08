import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { ensureInitialTestSetRevision } from '../src/modules/problem/problem.testset-revision.service'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestTeam, createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'
import { executeTrainingCommand, getTrainingDesign, getTrainingPeerProgress, getTrainingWorkspace, joinTrainingSession, listAvailableHints, listTrainingSessions, openTrainingHint, processDueTrainingSessions, recordHeartbeat, resolveTrainingPermission, saveTrainingDraft, syncTrainingEngineSubmission } from '../src/modules/training-engine/training-engine.service'

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
    const valid = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({ title: '顺序训练', teamId: team.id, stages: [{ name: '顺序', mode: 'SEQUENTIAL', advanceMode: 'MANUAL', problemAccessMode: 'SEQUENTIAL', submissionMode: 'ENABLED', problems: [{ problemId: problem.id }, { problemId: secondProblem.id, unlockPolicy: { mode: 'ANY', conditions: [{ type: 'AC' }] } }] }] })
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

  it('returns the design DTO and preserves stable stage/problem ids while reordering', async () => {
    const token = generateTokenFromUser(coach.user)
    const secondProblem = await configuredProblem(coach.user.id)
    const created = await createAuthenticatedRequest(app, token).post('/api/training-sessions').send({ title: '编排稳定性', teamId: team.id, stages: [
      { name: '阶段 A', mode: 'SEQUENTIAL', advanceMode: 'MANUAL', problemAccessMode: 'SEQUENTIAL', problems: [{ problemId: problem.id }, { problemId: secondProblem.id, unlockPolicy: { mode: 'ANY', conditions: [{ type: 'AC' }] } }] },
      { name: '讲评', mode: 'TEACHING', advanceMode: 'MANUAL', problems: [] },
    ] })
    expect(created.status).toBe(201)
    const sessionId = created.body.data.id
    const designResponse = await createAuthenticatedRequest(app, token).get(`/api/training-sessions/${sessionId}/design`)
    expect(designResponse.status).toBe(200)
    expect((await createAuthenticatedRequest(app, generateTokenFromUser(student.user)).get(`/api/training-sessions/${sessionId}/design`)).status).toBe(403)
    expect(designResponse.body.data.issues).toEqual([])
    const design = designResponse.body.data.stages
    const originalStageId = design[0].id
    const originalAssignmentIds = design[0].Problems.map((item: any) => item.assignmentId)
    expect(design[0].Problems[0].latestRevision.revisionNumber).toBe(1)

    const validate = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/structure/validate`).send({ stages: [{ ...design[1], problems: [] }, { ...design[0], problems: design[0].Problems.map((item: any) => ({ ...item, problemId: item.problemId, testSetRevisionId: item.testSetRevisionId })) }] })
    expect(validate.status).toBe(200)
    expect(validate.body.data.valid).toBe(true)
    const saved = await createAuthenticatedRequest(app, token).put(`/api/training-sessions/${sessionId}/structure`).send({ expectedRevision: 0, stages: [{ ...design[1], problems: [] }, { ...design[0], problems: [...design[0].Problems].reverse().map((item: any, index: number) => ({ ...item, problemId: item.problemId, testSetRevisionId: item.testSetRevisionId, unlockPolicy: index ? item.unlockPolicy || { mode: 'ANY', conditions: [{ type: 'AC' }] } : item.unlockPolicy })) }] })
    expect(saved.status).toBe(200)
    const after = await getTrainingDesign(coach.user.id, sessionId)
    expect(after.stages[1].id).toBe(originalStageId)
    expect(after.stages[1].Problems.map(item => item.assignmentId)).toEqual([...originalAssignmentIds].reverse())

    const stale = await createAuthenticatedRequest(app, token).put(`/api/training-sessions/${sessionId}/structure`).send({ expectedRevision: 0, stages: [] })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('TRAINING_SESSION_STALE')
    const published = await createAuthenticatedRequest(app, token).post(`/api/training-sessions/${sessionId}/publish`).send({ expectedRevision: 1 })
    expect(published.status).toBe(200)
    const frozen = await createAuthenticatedRequest(app, token).put(`/api/training-sessions/${sessionId}/structure`).send({ expectedRevision: 2, stages: [] })
    expect(frozen.status).toBe(409)
    expect(frozen.body.code).toBe('TRAINING_STRUCTURE_FROZEN')
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

  it('enforces hard pause on drafts and preserves terminal progress during heartbeats', async () => {
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    const session = await prisma.trainingSession.create({ data: { title: '硬暂停', teamId: team.id, createdBy: coach.user.id, status: 'PAUSED', pauseMode: 'HARD', startedAt: new Date(), pausedAt: new Date() } })
    const stage = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '阶段', orderIndex: 0, mode: 'FREE', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED', status: 'running', startedAt: new Date() } })
    await prisma.trainingSession.update({ where: { id: session.id }, data: { currentStageId: stage.id } })
    const stageProblem = await prisma.trainingSessionStageProblem.create({ data: { stageId: stage.id, problemId: problem.id, testSetRevisionId: revision.id, orderIndex: 0 } })
    const participant = await prisma.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: student.user.id, currentStageId: stage.id, currentProblemId: stageProblem.id, lastHeartbeatAt: new Date(Date.now() - 31_000) } })
    await prisma.trainingSessionProblemProgress.create({ data: { participantId: participant.id, stageProblemId: stageProblem.id, status: 'COMPLETED', activeSeconds: 100, continuousActiveSeconds: 100, attemptCount: 2, bestScore: 100, acAt: new Date() } })

    await expect(saveTrainingDraft(student.user.id, session.id, problem.id, { code: 'int main(){}', language: 'cpp17' })).rejects.toMatchObject({ code: 'HARD_PAUSE' })
    await recordHeartbeat(student.user.id, session.id, { stageProblemId: stageProblem.id, pageVisible: true, editorFocused: true })
    const after = await prisma.trainingSessionProblemProgress.findUniqueOrThrow({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: stageProblem.id } } })
    expect(after.status).toBe('COMPLETED')
    expect(after.activeSeconds).toBe(100)
    expect((await prisma.trainingSessionParticipant.findUniqueOrThrow({ where: { id: participant.id } })).currentStageId).toBe(stage.id)
  })

  it('treats OI target score as completion and requires both HYBRID conditions', async () => {
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    const session = await prisma.trainingSession.create({ data: { title: 'OI 目标分', teamId: team.id, createdBy: coach.user.id, sessionType: 'OI', status: 'RUNNING', startedAt: new Date(), runningSince: new Date() } })
    const first = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '目标 60', orderIndex: 0, mode: 'SCORE_PROGRESSIVE', targetScore: 60, advanceMode: 'HYBRID', durationSeconds: 60, completionThreshold: 100, problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED', status: 'running', startedAt: new Date(Date.now() - 61_000) } })
    const next = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '下一阶段', orderIndex: 1, mode: 'REVIEW', advanceMode: 'MANUAL', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED' } })
    await prisma.trainingSession.update({ where: { id: session.id }, data: { currentStageId: first.id } })
    const stageProblem = await prisma.trainingSessionStageProblem.create({ data: { stageId: first.id, problemId: problem.id, testSetRevisionId: revision.id, orderIndex: 0 } })
    const participant = await prisma.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: student.user.id, currentStageId: first.id } })

    await processDueTrainingSessions()
    expect((await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } })).currentStageId).toBe(first.id)
    const submission = await prisma.submission.create({ data: { userId: student.user.id, oj: 'carits', problemId: problem.problemId, language: 'cpp17', code: 'x', codeLength: 1, result: 'wrong_answer', score: 60, submitMethod: 'local', problemInternalId: problem.id, submitScope: 'training_engine', trainingSessionId: session.id, trainingStageProblemId: stageProblem.id, testSetRevisionId: revision.id } })
    await syncTrainingEngineSubmission({ id: submission.id, userId: student.user.id, trainingSessionId: session.id, trainingStageProblemId: stageProblem.id, result: 'wrong_answer', score: 60 })
    expect((await prisma.trainingSessionProblemProgress.findUniqueOrThrow({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: stageProblem.id } } })).status).toBe('COMPLETED')
    await processDueTrainingSessions()
    expect((await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } })).currentStageId).toBe(next.id)
  })

  it('isolates targeted overlays and restores the original problem across focus replacement', async () => {
    const secondProblem = await configuredProblem(coach.user.id)
    const [revision1, revision2] = await Promise.all([
      prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } }),
      prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: secondProblem.id } }),
    ])
    const peer = await createTestUser({ role: 'student' })
    await prisma.teamMember.create({ data: { id: crypto.randomUUID(), teamId: team.id, userId: peer.user.id, userType: 'student', role: 'member', status: 'active', joinedAt: new Date() } })
    const session = await prisma.trainingSession.create({ data: { title: '分组聚焦', teamId: team.id, createdBy: coach.user.id, status: 'RUNNING', startedAt: new Date(), runningSince: new Date() } })
    const stage = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '阶段', orderIndex: 0, mode: 'FREE', problemAccessMode: 'ALL', submissionMode: 'ENABLED', status: 'running', startedAt: new Date() } })
    await prisma.trainingSession.update({ where: { id: session.id }, data: { currentStageId: stage.id } })
    const first = await prisma.trainingSessionStageProblem.create({ data: { stageId: stage.id, problemId: problem.id, testSetRevisionId: revision1.id, orderIndex: 0 } })
    const second = await prisma.trainingSessionStageProblem.create({ data: { stageId: stage.id, problemId: secondProblem.id, testSetRevisionId: revision2.id, orderIndex: 1 } })
    const group1 = await prisma.trainingSessionGroup.create({ data: { sessionId: session.id, name: '基础组' } })
    const group2 = await prisma.trainingSessionGroup.create({ data: { sessionId: session.id, name: '提高组', orderIndex: 1 } })
    const p1 = await prisma.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: student.user.id, groupId: group1.id, currentStageId: stage.id, currentProblemId: first.id } })
    const p2 = await prisma.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: peer.user.id, groupId: group2.id, currentStageId: stage.id, currentProblemId: second.id } })

    await executeTrainingCommand(coach.user.id, session.id, { type: 'FOCUS_PROBLEM', expectedRevision: 0, targetType: 'GROUP', targetId: group1.id, payload: { stageProblemId: second.id, mode: 'LOCKED_FOCUS' } })
    await executeTrainingCommand(coach.user.id, session.id, { type: 'FOCUS_PROBLEM', expectedRevision: 1, targetType: 'GROUP', targetId: group2.id, payload: { stageProblemId: first.id, mode: 'LOCKED_FOCUS' } })
    await executeTrainingCommand(coach.user.id, session.id, { type: 'SHOW_MESSAGE', expectedRevision: 2, targetType: 'GROUP', targetId: group1.id, payload: { message: '基础组消息', messageType: 'INSTRUCTION' } })
    await executeTrainingCommand(coach.user.id, session.id, { type: 'FOCUS_PROBLEM', expectedRevision: 3, targetType: 'GROUP', targetId: group1.id, payload: { stageProblemId: first.id, mode: 'LOCKED_FOCUS' } })
    await executeTrainingCommand(coach.user.id, session.id, { type: 'END_FOCUS', expectedRevision: 4, targetType: 'GROUP', targetId: group1.id, payload: {} })

    expect((await prisma.trainingSessionParticipant.findUniqueOrThrow({ where: { id: p1.id } })).currentProblemId).toBe(first.id)
    expect((await prisma.trainingSessionParticipant.findUniqueOrThrow({ where: { id: p2.id } })).currentProblemId).toBe(first.id)
    expect(await prisma.trainingSessionOverlay.count({ where: { sessionId: session.id, status: 'active', type: 'LOCKED_FOCUS', targetId: group2.id } })).toBe(1)
    const peerWorkspace = await getTrainingWorkspace(peer.user.id, session.id)
    expect(peerWorkspace.session.Overlays.some(overlay => overlay.type === 'MESSAGE')).toBe(false)
    await expect(executeTrainingCommand(coach.user.id, session.id, { type: 'END_FOCUS', expectedRevision: 5, targetType: 'GROUP', targetId: 'not-a-group', payload: {} })).rejects.toMatchObject({ code: 'TRAINING_GROUP_NOT_FOUND' })
  })

  it('opens hints to one group without leaking them and limits peer progress fields', async () => {
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    const peer = await createTestUser({ role: 'student' })
    await prisma.teamMember.create({ data: { id: crypto.randomUUID(), teamId: team.id, userId: peer.user.id, userType: 'student', role: 'member', status: 'active', joinedAt: new Date() } })
    const session = await prisma.trainingSession.create({ data: { title: '提示权限', teamId: team.id, createdBy: coach.user.id, status: 'RUNNING', startedAt: new Date(), runningSince: new Date(), rankingMode: 'SCORE', peerVisibility: 'PROGRESS' } })
    const stage = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '阶段', orderIndex: 0, mode: 'FREE', problemAccessMode: 'ALL', submissionMode: 'ENABLED', status: 'running', startedAt: new Date() } })
    await prisma.trainingSession.update({ where: { id: session.id }, data: { currentStageId: stage.id } })
    const stageProblem = await prisma.trainingSessionStageProblem.create({ data: { stageId: stage.id, problemId: problem.id, testSetRevisionId: revision.id, orderIndex: 0 } })
    const group = await prisma.trainingSessionGroup.create({ data: { sessionId: session.id, name: '开放提示组' } })
    const p1 = await prisma.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: student.user.id, groupId: group.id, currentStageId: stage.id } })
    const p2 = await prisma.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: peer.user.id, currentStageId: stage.id } })
    const hint = await prisma.trainingSessionHint.create({ data: { sessionId: session.id, stageProblemId: stageProblem.id, level: 1, title: '方向', content: '考虑前缀信息', createdBy: coach.user.id } })
    await executeTrainingCommand(coach.user.id, session.id, { type: 'OPEN_HINT', expectedRevision: 0, targetType: 'GROUP', targetId: group.id, payload: { hintId: hint.id } })
    expect((await listAvailableHints(student.user.id, session.id, stageProblem.id)).map(item => item.id)).toContain(hint.id)
    expect(await listAvailableHints(peer.user.id, session.id, stageProblem.id)).toEqual([])
    expect((await openTrainingHint(student.user.id, session.id, hint.id)).content).toBe('考虑前缀信息')
    await executeTrainingCommand(coach.user.id, session.id, { type: 'CLOSE_HINT', expectedRevision: 1, targetType: 'GROUP', targetId: group.id, payload: { hintId: hint.id } })
    expect((await listAvailableHints(student.user.id, session.id, stageProblem.id)).map(item => item.id)).toContain(hint.id)
    const peers = await getTrainingPeerProgress(student.user.id, session.id)
    expect(peers.rankingMode).toBe('PROGRESS_ONLY')
    expect(peers.entries).toHaveLength(2)
    expect(peers.entries.every(item => !('score' in item) && !('attempts' in item))).toBe(true)
    expect(p1.id).toBeTruthy(); expect(p2.id).toBeTruthy()
  })

  it('allows scoped late join but cannot bypass an explicit coach roster', async () => {
    const late = await createTestUser({ role: 'student' })
    await prisma.teamMember.create({ data: { id: crypto.randomUUID(), teamId: team.id, userId: late.user.id, userType: 'student', role: 'member', status: 'active', joinedAt: new Date() } })
    const openSession = await prisma.trainingSession.create({ data: { title: '允许迟到', teamId: team.id, createdBy: coach.user.id, status: 'SCHEDULED', joinMode: 'CURRENT_STAGE' } })
    const stage = await prisma.trainingSessionStage.create({ data: { sessionId: openSession.id, name: '阶段', orderIndex: 0, mode: 'REVIEW', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED' } })
    await prisma.trainingSession.update({ where: { id: openSession.id }, data: { currentStageId: stage.id } })
    const visible = await listTrainingSessions(late.user.id, { teamId: team.id })
    expect(visible.find(item => item.id === openSession.id)?.canJoin).toBe(true)
    expect((await joinTrainingSession(late.user.id, openSession.id)).currentStageId).toBe(stage.id)

    const restricted = await prisma.trainingSession.create({ data: { title: '显式名单', teamId: team.id, createdBy: coach.user.id, status: 'SCHEDULED', joinMode: 'CURRENT_STAGE', settings: { rosterExplicit: true } } })
    await expect(joinTrainingSession(late.user.id, restricted.id)).rejects.toMatchObject({ code: 'TRAINING_JOIN_REQUIRES_ASSIGNMENT' })
  })

  it('enforces an ACM forced-switch interval and resets it only after opening another problem', async () => {
    const secondProblem = await configuredProblem(coach.user.id)
    const [revision1, revision2] = await Promise.all([
      prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } }),
      prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: secondProblem.id } }),
    ])
    const session = await prisma.trainingSession.create({ data: { title: 'ACM 换题', teamId: team.id, createdBy: coach.user.id, sessionType: 'ACM', status: 'RUNNING', startedAt: new Date(), runningSince: new Date() } })
    const stage = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '策略阶段', orderIndex: 0, mode: 'FREE', problemAccessMode: 'ALL', submissionMode: 'ENABLED', status: 'running', startedAt: new Date() } })
    await prisma.trainingSession.update({ where: { id: session.id }, data: { currentStageId: stage.id } })
    const first = await prisma.trainingSessionStageProblem.create({ data: { stageId: stage.id, problemId: problem.id, testSetRevisionId: revision1.id, orderIndex: 0, maxContinuousWorkSeconds: 60, forceSwitchOnTimeout: true } })
    const second = await prisma.trainingSessionStageProblem.create({ data: { stageId: stage.id, problemId: secondProblem.id, testSetRevisionId: revision2.id, orderIndex: 1 } })
    const participant = await prisma.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: student.user.id, currentStageId: stage.id, currentProblemId: first.id, lastHeartbeatAt: new Date(Date.now() - 31_000) } })
    await prisma.trainingSessionProblemProgress.create({ data: { participantId: participant.id, stageProblemId: first.id, status: 'WORKING', activeSeconds: 90, continuousActiveSeconds: 60 } })
    expect((await resolveTrainingPermission(student.user.id, session.id, first.id)).reason).toBe('FORCED_SWITCH_REQUIRED')
    await recordHeartbeat(student.user.id, session.id, { stageProblemId: second.id, pageVisible: true, editorFocused: true })
    await prisma.trainingSessionParticipant.update({ where: { id: participant.id }, data: { lastHeartbeatAt: new Date(Date.now() - 31_000) } })
    await recordHeartbeat(student.user.id, session.id, { stageProblemId: first.id, pageVisible: true, editorFocused: true })
    expect((await resolveTrainingPermission(student.user.id, session.id, first.id)).canSubmit).toBe(true)
  })

  it('enforces FOCUS_ONLY on the server and rejects targeted lifecycle commands', async () => {
    const secondProblem = await configuredProblem(coach.user.id)
    const [revision1, revision2] = await Promise.all([
      prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } }),
      prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: secondProblem.id } }),
    ])
    const session = await prisma.trainingSession.create({ data: { title: '聚焦限制', teamId: team.id, createdBy: coach.user.id, status: 'RUNNING', startedAt: new Date(), runningSince: new Date() } })
    const stage = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '聚焦阶段', orderIndex: 0, mode: 'FOCUS', problemAccessMode: 'FOCUS_ONLY', submissionMode: 'ENABLED', status: 'running', startedAt: new Date() } })
    await prisma.trainingSession.update({ where: { id: session.id }, data: { currentStageId: stage.id } })
    const first = await prisma.trainingSessionStageProblem.create({ data: { stageId: stage.id, problemId: problem.id, testSetRevisionId: revision1.id, orderIndex: 0 } })
    const second = await prisma.trainingSessionStageProblem.create({ data: { stageId: stage.id, problemId: secondProblem.id, testSetRevisionId: revision2.id, orderIndex: 1 } })
    const group = await prisma.trainingSessionGroup.create({ data: { sessionId: session.id, name: '第一组' } })
    await prisma.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: student.user.id, groupId: group.id, currentStageId: stage.id, currentProblemId: first.id } })

    expect((await resolveTrainingPermission(student.user.id, session.id, first.id)).canView).toBe(true)
    expect((await resolveTrainingPermission(student.user.id, session.id, second.id)).reason).toBe('FOCUS_REQUIRED')
    await executeTrainingCommand(coach.user.id, session.id, { type: 'FOCUS_PROBLEM', expectedRevision: 0, targetType: 'ALL', payload: { stageProblemId: second.id, mode: 'LOCKED_FOCUS' } })
    expect((await resolveTrainingPermission(student.user.id, session.id, second.id)).canSubmit).toBe(true)
    await expect(executeTrainingCommand(coach.user.id, session.id, { type: 'PAUSE_SESSION', expectedRevision: 1, targetType: 'GROUP', targetId: group.id, payload: { mode: 'SOFT' } })).rejects.toMatchObject({ code: 'INVALID_TRAINING_COMMAND_TARGET' })
  })

  it('advances a FROM_BEGINNING late participant through completed stages without moving beyond the class', async () => {
    const revision = await prisma.problemTestSetRevision.findFirstOrThrow({ where: { problemId: problem.id } })
    const session = await prisma.trainingSession.create({ data: { title: '从头补训', teamId: team.id, createdBy: coach.user.id, status: 'RUNNING', joinMode: 'FROM_BEGINNING', startedAt: new Date(), runningSince: new Date() } })
    const firstStage = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '第一阶段', orderIndex: 0, mode: 'FREE', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED', status: 'completed', startedAt: new Date(), endedAt: new Date() } })
    const secondStage = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '第二阶段', orderIndex: 1, mode: 'FREE', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED', status: 'running', startedAt: new Date() } })
    const thirdStage = await prisma.trainingSessionStage.create({ data: { sessionId: session.id, name: '第三阶段', orderIndex: 2, mode: 'REVIEW', problemAccessMode: 'STAGE_ONLY', submissionMode: 'DISABLED' } })
    await prisma.trainingSession.update({ where: { id: session.id }, data: { currentStageId: secondStage.id } })
    const firstProblem = await prisma.trainingSessionStageProblem.create({ data: { stageId: firstStage.id, problemId: problem.id, testSetRevisionId: revision.id, orderIndex: 0 } })
    await prisma.trainingSessionStageProblem.create({ data: { stageId: secondStage.id, problemId: problem.id, testSetRevisionId: revision.id, orderIndex: 0 } })
    const participant = await prisma.trainingSessionParticipant.create({ data: { sessionId: session.id, userId: student.user.id, currentStageId: firstStage.id } })
    const submission = await prisma.submission.create({ data: { userId: student.user.id, oj: 'carits', problemId: problem.problemId, language: 'cpp17', code: 'x', codeLength: 1, result: 'accepted', score: 100, submitMethod: 'local', problemInternalId: problem.id, submitScope: 'training_engine', trainingSessionId: session.id, trainingStageProblemId: firstProblem.id, testSetRevisionId: revision.id } })

    await syncTrainingEngineSubmission({ id: submission.id, userId: student.user.id, trainingSessionId: session.id, trainingStageProblemId: firstProblem.id, result: 'accepted', score: 100 })
    const advanced = await prisma.trainingSessionParticipant.findUniqueOrThrow({ where: { id: participant.id } })
    expect(advanced.currentStageId).toBe(secondStage.id)
    expect(advanced.currentProblemId).toBeNull()
    expect(await prisma.trainingSessionEvent.count({ where: { sessionId: session.id, type: 'training.participant.stage.advanced', targetType: 'USER', targetId: student.user.id } })).toBe(1)
    expect(advanced.currentStageId).not.toBe(thirdStage.id)
  })
})
