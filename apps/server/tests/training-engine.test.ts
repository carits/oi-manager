import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { ensureInitialTestSetRevision } from '../src/modules/problem/problem.testset-revision.service'
import {
  changeTrainingGrouping,
  createTrainingSession,
  executeTrainingCommand,
  executeTrainingGroupRuntimeAction,
  mergeTrainingGroup,
  publishTrainingSession,
  replaceTrainingStageGroupMatrix,
  splitTrainingGroup,
  TrainingEngineError,
} from '../src/modules/training-engine/training-engine.service'
import { createTestTeam, createTestUser } from './helpers/testUser'

const directories: string[] = []
async function configuredProblem(ownerId: string) {
  const id = crypto.randomUUID(); const root = path.join(process.cwd(), 'testdata', id); directories.push(root)
  await fs.promises.mkdir(root, { recursive: true }); await fs.promises.writeFile(path.join(root, '1.in'), '1 2\n'); await fs.promises.writeFile(path.join(root, '1.out'), '3\n')
  const problem = await prisma.problem.create({ data: { id, platform: 'carits', problemId: `TE-${id.slice(0, 8)}`, title: '训练引擎题目', ownerId, visibility: 'public', libraryScope: 'platform', libraryKey: 'platform', status: 'published', judgeConfig: 'mode: acm\ncases:\n  - input: 1.in\n    output: 1.out\n' } })
  for (const [filename, content] of [['1.in', '1 2\n'], ['1.out', '3\n']]) await prisma.testdataFile.create({ data: { id: crypto.randomUUID(), problemId: id, filename, size: Buffer.byteLength(content), md5: crypto.createHash('md5').update(content).digest('hex'), sha256: crypto.createHash('sha256').update(content).digest('hex') } })
  await ensureInitialTestSetRevision(id, ownerId); return problem
}

afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.promises.rm(directory, { recursive: true, force: true }))) })

describe('Training Engine single-model domain', () => {
  let coach: Awaited<ReturnType<typeof createTestUser>>
  let first: Awaited<ReturnType<typeof createTestUser>>
  let second: Awaited<ReturnType<typeof createTestUser>>
  let team: Awaited<ReturnType<typeof createTestTeam>>
  let problem: Awaited<ReturnType<typeof configuredProblem>>

  beforeEach(async () => {
    coach = await createTestUser({ organization: { role: 'teacher' } })
    first = await createTestUser({ organization: { role: 'student', organizationId: coach.organization!.organizationId } })
    second = await createTestUser({ organization: { role: 'student', organizationId: coach.organization!.organizationId } })
    team = await createTestTeam({ organizationId: null, scope: 'personal', ownerId: coach.user.id, ownerType: 'user' })
    for (const user of [first, second]) await prisma.teamMember.create({ data: { id: crypto.randomUUID(), teamId: team.id, userId: user.user.id, userType: 'student', role: 'member', status: 'active', joinedAt: new Date() } })
    problem = await configuredProblem(coach.user.id)
  })

  async function createSession(groupCount = 1, stageCount = 3, scheduled = true) {
    const users = [first.user.id, second.user.id]
    const grouping = groupCount === 1
      ? { groups: [{ clientKey: 'all', name: '全体学员', participantIds: users }] }
      : { groups: [{ clientKey: 'g1', name: '基础组', participantIds: [users[0]] }, { clientKey: 'g2', name: '提高组', participantIds: [users[1]] }] }
    return createTrainingSession(coach.user.id, {
      title: 'V2 训练', teamId: team.id, participantUserIds: users, settings: { participantTarget: 'custom_students' }, grouping,
      ...(scheduled ? { scheduledStartAt: new Date(Date.now() + 3600_000).toISOString() } : {}),
      stages: Array.from({ length: stageCount }, (_, index) => ({ name: `阶段 ${index + 1}`, kind: 'TRAINING', problems: [{ problemId: problem.id }] })),
    })
  }

  async function loaded(id: string) {
    return prisma.trainingSession.findUniqueOrThrow({ where: { id }, include: { Groups: { orderBy: { orderIndex: 'asc' }, include: { Participants: true, StageGroups: { include: { Stage: true, ProblemPlans: true }, orderBy: { Stage: { orderIndex: 'asc' } } } } }, Stages: { orderBy: { orderIndex: 'asc' }, include: { Groups: { include: { ProblemPlans: true } }, Problems: true } }, Participants: true } })
  }

  async function publishAndStart(id: string, groupIndexes: number[] = [0]) {
    await publishTrainingSession(coach.user.id, id, 0)
    let session = await loaded(id)
    for (const index of groupIndexes) { await executeTrainingGroupRuntimeAction(coach.user.id, id, { expectedRevision: session.statusRevision, action: 'start', groupId: session.Groups[index].id }); session = await loaded(id) }
    return session
  }

  it('creates one stable Group and exactly one StageGroup per Stage', async () => {
    const created = await createSession(1, 3)
    const session = await loaded(created!.id)
    expect(session.Groups).toHaveLength(1)
    expect(session.Participants.every(item => item.groupId === session.Groups[0].id)).toBe(true)
    expect(session.Stages.every(stage => stage.Groups.length === 1 && stage.Groups[0].groupId === session.Groups[0].id)).toBe(true)
  })

  it('allows different Groups to run in different Stages', async () => {
    const created = await createSession(2, 3)
    let session = await publishAndStart(created!.id, [0, 1])
    await executeTrainingGroupRuntimeAction(coach.user.id, session.id, { expectedRevision: session.statusRevision, action: 'advance', groupId: session.Groups[1].id })
    session = await loaded(session.id)
    expect(session.Groups[0].StageGroups.find(unit => unit.status === 'RUNNING')?.Stage.orderIndex).toBe(0)
    expect(session.Groups[1].StageGroups.find(unit => unit.status === 'RUNNING')?.Stage.orderIndex).toBe(1)
  })

  it('moves a participant across Stages without resetting the target StageGroup epoch', async () => {
    const created = await createSession(2, 3)
    let session = await publishAndStart(created!.id, [0, 1])
    await executeTrainingGroupRuntimeAction(coach.user.id, session.id, { expectedRevision: session.statusRevision, action: 'advance', groupId: session.Groups[1].id })
    session = await loaded(session.id)
    const sourceParticipant = session.Groups[0].Participants[0]
    const sourceProblem = session.Groups[0].StageGroups[0].ProblemPlans[0].stageProblemId
    await prisma.trainingSessionProblemProgress.create({ data: { participantId: sourceParticipant.id, stageProblemId: sourceProblem, status: 'WORKING', attemptCount: 2, bestScore: 40 } })
    const targetUnit = session.Groups[1].StageGroups.find(unit => unit.status === 'RUNNING')!
    const epoch = { startedAt: targetUnit.startedAt?.getTime(), activeElapsedSeconds: targetUnit.activeElapsedSeconds }
    await changeTrainingGrouping(coach.user.id, session.id, { expectedRevision: session.statusRevision, participantId: sourceParticipant.id, toGroupId: session.Groups[1].id, reason: '跨阶段调组' })
    const after = await loaded(session.id); const unchanged = after.Groups[1].StageGroups.find(unit => unit.id === targetUnit.id)!
    expect(after.Participants.find(item => item.id === sourceParticipant.id)?.groupId).toBe(session.Groups[1].id)
    expect({ startedAt: unchanged.startedAt?.getTime(), activeElapsedSeconds: unchanged.activeElapsedSeconds }).toEqual(epoch)
    expect(await prisma.trainingSessionProblemProgress.findUnique({ where: { participantId_stageProblemId: { participantId: sourceParticipant.id, stageProblemId: sourceProblem } } })).not.toBeNull()
  })

  it('keeps same-Stage progress when changing stable Group', async () => {
    const created = await createSession(2, 2)
    let session = await publishAndStart(created!.id, [0, 1])
    const participant = session.Groups[0].Participants[0]
    const stageProblemId = session.Groups[0].StageGroups[0].ProblemPlans[0].stageProblemId
    await prisma.trainingSessionProblemProgress.create({ data: { participantId: participant.id, stageProblemId, status: 'WORKING', attemptCount: 3, bestScore: 60 } })
    await changeTrainingGrouping(coach.user.id, session.id, { expectedRevision: session.statusRevision, participantId: participant.id, toGroupId: session.Groups[1].id, reason: '同阶段调组' })
    const progress = await prisma.trainingSessionProblemProgress.findUniqueOrThrow({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } } })
    expect(progress).toMatchObject({ attemptCount: 3, bestScore: 60 })
  })

  it('splits a running Group and inherits its current and future StageGroup units', async () => {
    const created = await createSession(1, 3)
    let session = await publishAndStart(created!.id)
    const source = session.Groups[0]; const moved = source.Participants[0]; const sourceActive = source.StageGroups.find(unit => unit.status === 'RUNNING')!
    await splitTrainingGroup(coach.user.id, session.id, { expectedRevision: session.statusRevision, sourceGroupId: source.id, name: '拆分组', participantIds: [moved.id], reason: '课堂拆组' })
    session = await loaded(session.id); const target = session.Groups.find(group => group.name === '拆分组')!
    expect(target.StageGroups).toHaveLength(3)
    expect(target.StageGroups.find(unit => unit.status === 'RUNNING')?.stageId).toBe(sourceActive.stageId)
    expect(target.Participants.map(item => item.id)).toContain(moved.id)
  })

  it('merges Groups only when both are active in the same Stage', async () => {
    const created = await createSession(2, 3)
    let session = await publishAndStart(created!.id, [0, 1])
    await mergeTrainingGroup(coach.user.id, session.id, { expectedRevision: session.statusRevision, sourceGroupId: session.Groups[0].id, targetGroupId: session.Groups[1].id, reason: '同阶段合组' })
    session = await loaded(session.id)
    expect(session.Groups[0].status).toBe('archived')
    expect(session.Participants.every(item => item.groupId === session.Groups[1].id)).toBe(true)

    const other = await createSession(2, 3); let mismatch = await publishAndStart(other!.id, [0, 1])
    await executeTrainingGroupRuntimeAction(coach.user.id, mismatch.id, { expectedRevision: mismatch.statusRevision, action: 'advance', groupId: mismatch.Groups[1].id }); mismatch = await loaded(mismatch.id)
    await expect(mergeTrainingGroup(coach.user.id, mismatch.id, { expectedRevision: mismatch.statusRevision, sourceGroupId: mismatch.Groups[0].id, targetGroupId: mismatch.Groups[1].id, reason: '错误合组' })).rejects.toMatchObject<Partial<TrainingEngineError>>({ code: 'TRAINING_GROUP_MERGE_STAGE_MISMATCH' })
  })

  it('does not rewrite an ended StageGroup when future matrix configuration changes', async () => {
    const created = await createSession(1, 3)
    let session = await publishAndStart(created!.id)
    await executeTrainingGroupRuntimeAction(coach.user.id, session.id, { expectedRevision: session.statusRevision, action: 'advance', groupId: session.Groups[0].id }); session = await loaded(session.id)
    const ended = session.Groups[0].StageGroups[0]
    const before = { status: ended.status, endedAt: ended.endedAt?.getTime(), activeElapsedSeconds: ended.activeElapsedSeconds }
    const stageGroups = session.Stages.flatMap(stage => stage.Groups.map(unit => ({ id: unit.id, clientKey: unit.id, stageId: stage.id, groupId: unit.groupId, mode: unit.mode, accessPolicy: unit.accessPolicy, submissionMode: unit.submissionMode, plannedDurationSeconds: unit.plannedDurationSeconds, completionThreshold: unit.completionThreshold, minDurationSeconds: unit.minDurationSeconds, completionPolicy: unit.completionPolicy as Record<string, unknown> | null, transitionPolicy: unit.transitionPolicy as 'WAIT_FOR_TEACHER' | 'AUTO_ADVANCE', problemIds: unit.ProblemPlans.map(plan => plan.stageProblemId), rules: unit.rules as Record<string, unknown> | null })))
    await replaceTrainingStageGroupMatrix(coach.user.id, session.id, { expectedRevision: session.statusRevision, stageGroups })
    const after = (await loaded(session.id)).Groups[0].StageGroups[0]
    expect({ status: after.status, endedAt: after.endedAt?.getTime(), activeElapsedSeconds: after.activeElapsedSeconds }).toEqual(before)
  })

  it('preserves a locally paused Group across Session pause and resume', async () => {
    const created = await createSession(2, 2)
    let session = await publishAndStart(created!.id, [0, 1])
    await executeTrainingGroupRuntimeAction(coach.user.id, session.id, { expectedRevision: session.statusRevision, action: 'pause', groupId: session.Groups[1].id }); session = await loaded(session.id)
    await executeTrainingCommand(coach.user.id, session.id, { expectedRevision: session.statusRevision, type: 'PAUSE_SESSION', targetType: 'ALL', payload: { mode: 'SOFT' } }); session = await loaded(session.id)
    await executeTrainingCommand(coach.user.id, session.id, { expectedRevision: session.statusRevision, type: 'RESUME_SESSION', targetType: 'ALL', payload: {} })
    session = await loaded(session.id)
    expect(session.Groups[0].StageGroups.find(unit => unit.status === 'RUNNING')).toBeTruthy()
    expect(session.Groups[1].StageGroups.find(unit => unit.status === 'PAUSED')).toBeTruthy()
  })
})