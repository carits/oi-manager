import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { ensureInitialTestSetSlots } from '../src/modules/problem/problem.testset-slot.service'
import {
  appendTrainingRuntimeProblem,
  changeTrainingStageGroup,
  cloneTrainingSession,
  createTrainingHint,
  createTrainingSession,
  createTrainingSessionTemplate,
  executeStageTransition,
  executeTrainingCommand,
  getCoachDashboard,
  getTrainingDesign,
  getTrainingReport,
  getTrainingPeerProgress,
  getTrainingWorkspace,
  joinTrainingParticipantRuntime,
  leaveTrainingParticipantRuntime,
  mergeTrainingGroup,
  publishTrainingSession,
  processDueTrainingSessions,
  replaceTrainingRoster,
  replaceTrainingStageGroupMatrix,
  resolveTrainingPermission,
  saveTrainingDraft,
  splitTrainingGroup,
  TrainingEngineError,
} from '../src/modules/training-engine/training-engine.service'
import { createTestTeam, createTestUser } from './helpers/testUser'

const directories: string[] = []

async function configuredProblem(ownerId: string) {
  const id = crypto.randomUUID()
  const root = path.join(process.cwd(), 'testdata', id)
  directories.push(root)
  await fs.promises.mkdir(root, { recursive: true })
  await fs.promises.writeFile(path.join(root, '1.in'), '1 2\n')
  await fs.promises.writeFile(path.join(root, '1.out'), '3\n')
  const problem = await prisma.problem.create({
    data: {
      id,
      platform: 'carits',
      problemId: `TE-${id.slice(0, 8)}`,
      title: '训练引擎题目',
      ownerId,
      visibility: 'public',
      libraryScope: 'platform',
      libraryKey: 'platform',
      status: 'published',
      judgeConfig: 'mode: acm\ncases:\n  - input: 1.in\n    output: 1.out\n',
    },
  })
  for (const [filename, value] of [['1.in', '1 2\n'], ['1.out', '3\n']] as const) {
    await prisma.testdataFile.create({
      data: {
        id: crypto.randomUUID(),
        problemId: id,
        filename,
        size: Buffer.byteLength(value),
        md5: crypto.createHash('md5').update(value).digest('hex'),
        sha256: crypto.createHash('sha256').update(value).digest('hex'),
      },
    })
  }
  await ensureInitialTestSetSlots(id, ownerId)
  return problem
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.promises.rm(directory, { recursive: true, force: true })))
})

describe('Training Engine global Stage domain', () => {
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
    for (const user of [first, second]) {
      await prisma.teamMember.create({ data: { id: crypto.randomUUID(), teamId: team.id, userId: user.user.id, userType: 'student', role: 'member', status: 'active', joinedAt: new Date() } })
    }
    problem = await configuredProblem(coach.user.id)
  })

  async function createSession(
    groupCount = 1,
    stageCount = 3,
    scheduled = false,
    sessionSettings: { participantTarget: string; preset?: string; resultVisibility?: string } = { participantTarget: 'custom_students' },
  ) {
    const users = [first.user.id, second.user.id]
    const grouping = groupCount === 1
      ? { groups: [{ clientKey: 'all', name: '全体学员', participantIds: users }] }
      : { groups: [{ clientKey: 'g1', name: '基础组', participantIds: [users[0]] }, { clientKey: 'g2', name: '提高组', participantIds: [users[1]] }] }
    return createTrainingSession(coach.user.id, {
      title: '全局阶段训练',
      teamId: team.id,
      participantUserIds: users,
      settings: sessionSettings,
      grouping,
      ...(scheduled ? { scheduledStartAt: new Date(Date.now() + 3600_000).toISOString() } : {}),
      stages: Array.from({ length: stageCount }, (_, index) => ({
        name: `阶段 ${index + 1}`,
        kind: 'TRAINING',
        mode: 'PRACTICE',
        accessPolicy: 'ALL_AT_ONCE',
        submissionMode: 'ENABLED',
        endPolicy: 'MANUAL',
        problems: [{ problemId: problem.id, required: true }],
      })),
    })
  }

  async function loaded(id: string) {
    return prisma.trainingSession.findUniqueOrThrow({
      where: { id },
      include: {
        Groups: { orderBy: { orderIndex: 'asc' }, include: { Participants: true, StageGroups: { include: { ProblemPlans: true } } } },
        Stages: { orderBy: { orderIndex: 'asc' }, include: { Groups: { include: { ProblemPlans: true } }, Problems: true, RuntimeSnapshot: true } },
        Participants: true,
      },
    })
  }

  async function publishAndStart(id: string) {
    await publishTrainingSession(coach.user.id, id, 0)
    return loaded(id)
  }

  it('creates stable participant Groups and exactly one default plan per Stage', async () => {
    const created = await createSession(2, 3)
    const session = await loaded(created!.id)
    expect(session.Groups).toHaveLength(2)
    expect(session.Participants.every(item => session.Groups.some(group => group.id === item.groupId))).toBe(true)
    expect(session.Stages.every(stage => stage.Groups.length === 1 && stage.Groups[0].isDefault && stage.Groups[0].groupId === null)).toBe(true)
    expect(session.Stages.every(stage => stage.Groups[0].ProblemPlans.length === 1 && stage.Groups[0].ProblemPlans[0].required)).toBe(true)
  })

  it('stores optional group overrides without creating a second runtime timeline', async () => {
    const created = await createSession(2, 1, true)
    const session = await loaded(created!.id)
    const stage = session.Stages[0]
    const fallback = stage.Groups.find(plan => plan.isDefault)!

    await replaceTrainingStageGroupMatrix(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      stagePlans: [
        {
          id: fallback.id,
          clientKey: fallback.id,
          stageId: stage.id,
          groupId: null,
          isDefault: true,
          inheritsDefault: false,
          accessPolicy: 'ALL_AT_ONCE',
          submissionMode: 'ENABLED',
          problemIds: fallback.ProblemPlans.map(item => item.stageProblemId),
          requiredProblemIds: fallback.ProblemPlans.map(item => item.stageProblemId),
        },
        {
          clientKey: 'override',
          stageId: stage.id,
          groupId: session.Groups[1].id,
          isDefault: false,
          inheritsDefault: true,
          accessPolicy: 'SEQUENTIAL',
          submissionMode: 'DISABLED',
          problemIds: fallback.ProblemPlans.map(item => item.stageProblemId),
          requiredProblemIds: [],
        },
      ],
    })

    const updated = (await loaded(session.id)).Stages[0]
    expect(updated.lifecycle).toBe('PENDING')
    expect(updated.Groups).toHaveLength(2)
    expect(updated.Groups.find(plan => plan.groupId === session.Groups[1].id)).toMatchObject({
      isDefault: false,
      inheritsDefault: true,
      accessPolicy: 'SEQUENTIAL',
      submissionMode: 'DISABLED',
    })
  })

  it('rejects group commands when a non-inheriting override excludes the default problem', async () => {
    const created = await createSession(2, 1)
    let session = await loaded(created!.id)
    const stage = session.Stages[0]
    const fallback = stage.Groups.find(plan => plan.isDefault)!
    const excludedGroupId = session.Groups[1].id
    const stageProblemId = fallback.ProblemPlans[0].stageProblemId

    await replaceTrainingStageGroupMatrix(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      stagePlans: [
        {
          id: fallback.id,
          clientKey: fallback.id,
          stageId: stage.id,
          groupId: null,
          isDefault: true,
          inheritsDefault: false,
          accessPolicy: 'ALL_AT_ONCE',
          submissionMode: 'ENABLED',
          problemIds: [stageProblemId],
          requiredProblemIds: [stageProblemId],
        },
        {
          clientKey: 'exclusive-empty-override',
          stageId: stage.id,
          groupId: excludedGroupId,
          isDefault: false,
          inheritsDefault: false,
          accessPolicy: 'ALL_AT_ONCE',
          submissionMode: 'ENABLED',
          problemIds: [],
          requiredProblemIds: [],
        },
      ],
    })

    session = await loaded(session.id)
    await publishTrainingSession(coach.user.id, session.id, session.statusRevision)
    session = await loaded(session.id)

    await expect(executeTrainingCommand(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      type: 'FOCUS_PROBLEM',
      targetType: 'GROUP',
      targetId: excludedGroupId,
      payload: { stageProblemId, mode: 'LOCKED_FOCUS' },
    })).rejects.toMatchObject<Partial<TrainingEngineError>>({
      code: 'TRAINING_PROBLEM_NOT_IN_CURRENT_STAGE',
    })
  })

  it('advances one global Stage for every learner and creates immutable snapshots', async () => {
    const created = await createSession(2, 3)
    let session = await publishAndStart(created!.id)
    expect(session.currentStageId).toBe(session.Stages[0].id)
    expect(session.Stages.map(stage => stage.lifecycle)).toEqual(['RUNNING', 'PENDING', 'PENDING'])
    expect(session.Stages[0].RuntimeSnapshot?.configHash).toMatch(/^[a-f0-9]{64}$/)

    await executeStageTransition(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      action: 'advance',
      stageId: session.Stages[0].id,
      outcome: 'completed',
    })
    session = await loaded(session.id)
    expect(session.currentStageId).toBe(session.Stages[1].id)
    expect(session.Stages.map(stage => stage.lifecycle)).toEqual(['ENDED', 'RUNNING', 'PENDING'])
    expect(session.Stages[0].RuntimeSnapshot?.configHash).toMatch(/^[a-f0-9]{64}$/)
    expect(session.Stages[1].RuntimeSnapshot?.configHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('resolves learner permissions from the global current Stage and stable Group plan', async () => {
    const created = await createSession(1, 1)
    const session = await publishAndStart(created!.id)
    const stageProblemId = session.Stages[0].Groups[0].ProblemPlans[0].stageProblemId

    await expect(resolveTrainingPermission(first.user.id, session.id, stageProblemId)).resolves.toMatchObject({
      canView: true,
      canEdit: true,
      reason: 'ALLOWED',
    })
    await expect(getTrainingWorkspace(first.user.id, session.id)).resolves.toMatchObject({
      session: { currentStageId: session.Stages[0].id },
      participant: { currentGroupId: session.Groups[0].id, requiredCount: 1, completedCount: 0 },
    })
    await expect(saveTrainingDraft(first.user.id, session.id, stageProblemId, {
      language: 'cpp17',
      code: 'int main() {}',
    })).resolves.toMatchObject({ stageProblemId, userId: first.user.id })
  })

  it('shows the current Stage sequential lock reason without revealing future Stages', async () => {
    const secondProblem = await configuredProblem(coach.user.id)
    const users = [first.user.id, second.user.id]
    const created = await createTrainingSession(coach.user.id, {
      title: '顺序解锁训练',
      teamId: team.id,
      participantUserIds: users,
      settings: { participantTarget: 'custom_students' },
      grouping: { groups: [{ clientKey: 'all', name: '全体学员', participantIds: users }] },
      stages: [
        {
          name: '当前阶段',
          kind: 'TRAINING',
          mode: 'PRACTICE',
          accessPolicy: 'SEQUENTIAL',
          submissionMode: 'ENABLED',
          endPolicy: 'MANUAL',
          problems: [
            { problemId: problem.id, required: true },
            {
              problemId: secondProblem.id,
              required: true,
              unlockPolicy: { mode: 'ANY', conditions: [{ type: 'AC' }] },
            },
          ],
        },
        {
          name: '未来阶段',
          kind: 'TRAINING',
          mode: 'PRACTICE',
          accessPolicy: 'ALL_AT_ONCE',
          submissionMode: 'ENABLED',
          endPolicy: 'MANUAL',
          problems: [{ problemId: problem.id, required: true }],
        },
      ],
    })
    const session = await publishAndStart(created!.id)
    const currentProblems = session.Stages[0].Problems
    const futureProblem = session.Stages[1].Problems[0]
    const workspace = await getTrainingWorkspace(first.user.id, session.id)

    expect(workspace.permissions[currentProblems[1].id]).toMatchObject({
      canView: false,
      canSeeMetadata: true,
      reason: 'SEQUENTIAL_LOCK',
      blockedByStageProblemId: currentProblems[0].id,
    })
    expect(workspace.session.Stages[0].Problems[1].Problem.title).not.toBe('未开放题目')
    expect(workspace.permissions[futureProblem.id]).toMatchObject({
      canView: false,
      canSeeMetadata: false,
      reason: 'FUTURE_STAGE',
    })
    expect(workspace.session.Stages[1].Problems[0].Problem.title).toBe('未开放题目')
  })

  it('hides exam results from learners until the session ends', async () => {
    const created = await createSession(1, 1, false, {
      participantTarget: 'custom_students',
      preset: 'oi_exam',
      resultVisibility: 'AFTER_END',
    })
    let session = await publishAndStart(created!.id)
    expect(session.settings).toMatchObject({ preset: 'oi_exam', resultVisibility: 'AFTER_END' })
    const participant = session.Participants.find(item => item.userId === first.user.id)!
    const stageProblemId = session.Stages[0].Problems[0].id
    await prisma.trainingSessionProblemProgress.create({
      data: { participantId: participant.id, stageProblemId, status: 'WORKING', attemptCount: 2, bestScore: 60 },
    })

    const learnerWorkspace = await getTrainingWorkspace(first.user.id, session.id)
    expect(learnerWorkspace.progress[0]).toMatchObject({ status: 'HIDDEN', bestScore: null, attemptCount: 0 })
    expect(learnerWorkspace.participant).not.toHaveProperty('requiredCount')
    await expect(getTrainingPeerProgress(first.user.id, session.id)).resolves.toMatchObject({ rankingMode: 'OFF', peerVisibility: 'NONE', entries: [] })
    await expect(getTrainingReport(first.user.id, session.id)).rejects.toMatchObject<Partial<TrainingEngineError>>({ code: 'TRAINING_RESULTS_HIDDEN' })

    const managerWorkspace = await getTrainingWorkspace(coach.user.id, session.id)
    expect(managerWorkspace.progress).toEqual([])
    await expect(getTrainingReport(coach.user.id, session.id)).resolves.toMatchObject({ session: { id: session.id } })

    await executeStageTransition(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      action: 'end_session',
      stageId: session.Stages[0].id,
      outcome: 'completed',
    })
    session = await loaded(session.id)
    const endedWorkspace = await getTrainingWorkspace(first.user.id, session.id)
    expect(endedWorkspace.progress[0]).toMatchObject({ status: 'WORKING', bestScore: 60, attemptCount: 2 })
    await expect(getTrainingReport(first.user.id, session.id)).resolves.toMatchObject({ session: { status: 'ENDED' } })
  })

  it('publishes teacher-controlled exam results through the runtime command', async () => {
    const created = await createSession(1, 1, false, {
      participantTarget: 'custom_students',
      preset: 'oi_exam',
      resultVisibility: 'TEACHER_PUBLISHED',
    })
    let session = await publishAndStart(created!.id)
    const participant = session.Participants.find(item => item.userId === first.user.id)!
    const stageProblemId = session.Stages[0].Problems[0].id
    await prisma.trainingSessionProblemProgress.create({
      data: { participantId: participant.id, stageProblemId, status: 'WORKING', attemptCount: 1, bestScore: 80 },
    })

    let learnerWorkspace = await getTrainingWorkspace(first.user.id, session.id)
    expect(learnerWorkspace.progress[0]).toMatchObject({ status: 'HIDDEN', bestScore: null, attemptCount: 0 })
    await expect(getTrainingReport(first.user.id, session.id)).rejects.toMatchObject<Partial<TrainingEngineError>>({
      code: 'TRAINING_RESULTS_HIDDEN',
    })

    await executeTrainingCommand(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      type: 'PUBLISH_RESULTS',
      targetType: 'ALL',
      payload: {},
    })
    session = await loaded(session.id)
    expect(session.settings).toMatchObject({
      resultVisibility: 'TEACHER_PUBLISHED',
      resultsPublishedAt: expect.any(String),
    })

    learnerWorkspace = await getTrainingWorkspace(first.user.id, session.id)
    expect(learnerWorkspace.progress[0]).toMatchObject({ status: 'WORKING', bestScore: 80, attemptCount: 1 })
    await expect(getTrainingReport(first.user.id, session.id)).resolves.toMatchObject({ session: { id: session.id } })
  })

  it('applies immediate group changes without changing Stage or deleting progress', async () => {
    const created = await createSession(2, 2)
    let session = await publishAndStart(created!.id)
    const participant = session.Groups[0].Participants[0]
    const stageProblemId = session.Stages[0].Groups[0].ProblemPlans[0].stageProblemId
    await prisma.trainingSessionProblemProgress.create({ data: { participantId: participant.id, stageProblemId, status: 'WORKING', attemptCount: 3, bestScore: 60 } })
    const currentStageId = session.currentStageId

    await changeTrainingStageGroup(coach.user.id, session.id, currentStageId!, {
      expectedRevision: session.statusRevision,
      participantIds: [participant.id],
      toGroupId: session.Groups[1].id,
      effectiveMode: 'immediate',
      reason: '课堂调组',
    })
    session = await loaded(session.id)
    expect(session.currentStageId).toBe(currentStageId)
    expect(session.Participants.find(item => item.id === participant.id)?.groupId).toBe(session.Groups[1].id)
    await expect(prisma.trainingSessionGroupChange.findFirstOrThrow({ where: { participantId: participant.id, status: 'applied' } })).resolves.toMatchObject({ targetStageId: currentStageId, effectiveMode: 'IMMEDIATE' })
    const dashboard = await getCoachDashboard(coach.user.id, session.id)
    expect(dashboard.participants.find(item => item.id === participant.id)).toMatchObject({ currentPlanId: expect.any(String) })
    const report = await getTrainingReport(coach.user.id, session.id)
    expect(report.timeline[0].groupCompletions.find(item => item.groupId === session.Groups[1].id)).toMatchObject({ participantCount: 2 })
    await expect(prisma.trainingSessionProblemProgress.findUniqueOrThrow({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } } })).resolves.toMatchObject({ attemptCount: 3, bestScore: 60 })
    await expect(getTrainingWorkspace(participant.userId, session.id)).resolves.toMatchObject({ participant: { latestGroupChange: { fromGroupName: '基础组', toGroupName: '提高组', reason: '课堂调组' } } })
  })

  it('applies a next-stage group change only when that Stage starts', async () => {
    const created = await createSession(2, 2)
    let session = await publishAndStart(created!.id)
    const participant = session.Groups[0].Participants[0]
    const sourceGroupId = participant.groupId
    const targetGroupId = session.Groups[1].id

    await changeTrainingStageGroup(coach.user.id, session.id, session.currentStageId!, {
      expectedRevision: session.statusRevision,
      participantIds: [participant.id],
      toGroupId: targetGroupId,
      effectiveMode: 'next_stage',
      targetStageId: session.Stages[1].id,
      reason: '下一阶段分层',
    })
    session = await loaded(session.id)
    expect(session.Participants.find(item => item.id === participant.id)?.groupId).toBe(sourceGroupId)

    await executeStageTransition(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      action: 'advance',
      stageId: session.Stages[0].id,
      outcome: 'completed',
    })
    session = await loaded(session.id)
    expect(session.Participants.find(item => item.id === participant.id)?.groupId).toBe(targetGroupId)
  })

  it('splits and merges Groups without creating independent Stage runtimes', async () => {
    const created = await createSession(1, 2)
    let session = await publishAndStart(created!.id)
    const originalCurrentStageId = session.currentStageId
    const source = session.Groups[0]
    const moved = source.Participants[0]

    await splitTrainingGroup(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      sourceGroupId: source.id,
      name: '拆分组',
      participantIds: [moved.id],
      reason: '课堂拆组',
    })
    session = await loaded(session.id)
    const target = session.Groups.find(group => group.name === '拆分组')!
    expect(session.currentStageId).toBe(originalCurrentStageId)
    expect(target.Participants.map(item => item.id)).toContain(moved.id)
    expect(session.Stages.filter(stage => stage.lifecycle === 'RUNNING')).toHaveLength(1)

    await mergeTrainingGroup(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      sourceGroupId: target.id,
      targetGroupId: source.id,
      reason: '课堂合组',
    })
    session = await loaded(session.id)
    expect(session.currentStageId).toBe(originalCurrentStageId)
    expect(session.Groups.find(group => group.id === target.id)?.status).toBe('archived')
  })

  it('defers a split Group assignment until the selected Stage starts', async () => {
    const created = await createSession(1, 2)
    let session = await publishAndStart(created!.id)
    const source = session.Groups[0]
    const moved = source.Participants[0]

    await splitTrainingGroup(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      sourceGroupId: source.id,
      name: '下一阶段冲刺组',
      participantIds: [moved.id],
      effectiveMode: 'next_stage',
      targetStageId: session.Stages[1].id,
      reason: '下一阶段分层',
    })
    session = await loaded(session.id)
    const target = session.Groups.find(group => group.name === '下一阶段冲刺组')!
    expect(session.Participants.find(item => item.id === moved.id)?.groupId).toBe(source.id)
    expect(target.Participants).toHaveLength(0)

    await executeStageTransition(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      action: 'advance',
      stageId: session.Stages[0].id,
      outcome: 'completed',
    })
    session = await loaded(session.id)
    expect(session.Participants.find(item => item.id === moved.id)?.groupId).toBe(target.id)
    await expect(prisma.trainingSessionGroupChange.findFirstOrThrow({ where: { participantId: moved.id, toGroupId: target.id } })).resolves.toMatchObject({ targetStageId: session.Stages[1].id, status: 'applied' })
  })

  it('advances and ends timed Stages through the scheduler', async () => {
    const users = [first.user.id, second.user.id]
    const created = await createTrainingSession(coach.user.id, {
      title: '定时模拟测试',
      teamId: team.id,
      participantUserIds: users,
      settings: { participantTarget: 'custom_students', preset: 'oi_exam', resultVisibility: 'AFTER_END' },
      grouping: { groups: [{ clientKey: 'all', name: '全体学员', participantIds: users }] },
      stages: [0, 1].map(index => ({
        name: `测试阶段 ${index + 1}`,
        kind: 'TRAINING',
        mode: 'EXAM',
        accessPolicy: 'ALL_AT_ONCE',
        submissionMode: 'ENABLED',
        endPolicy: 'TIME',
        plannedDurationSeconds: 60,
        problems: [{ problemId: problem.id, required: true }],
      })),
    })
    let session = await publishAndStart(created!.id)
    const firstStageId = session.Stages[0].id
    const secondStageId = session.Stages[1].id
    const firstDeadline = new Date()
    await prisma.trainingSessionStage.update({
      where: { id: firstStageId },
      data: { runningSince: new Date(firstDeadline.getTime() - 61_000) },
    })

    await expect(processDueTrainingSessions(firstDeadline)).resolves.toMatchObject({ advanced: 1 })
    session = await loaded(session.id)
    expect(session).toMatchObject({ status: 'RUNNING', currentStageId: secondStageId })
    expect(session.Stages[0]).toMatchObject({ lifecycle: 'ENDED', endReason: 'TIME_REACHED' })
    expect(session.Stages[1]).toMatchObject({ lifecycle: 'RUNNING' })

    const secondDeadline = new Date(firstDeadline.getTime() + 62_000)
    await prisma.trainingSessionStage.update({
      where: { id: secondStageId },
      data: { runningSince: new Date(secondDeadline.getTime() - 61_000) },
    })
    await expect(processDueTrainingSessions(secondDeadline)).resolves.toMatchObject({ ended: 1 })
    session = await loaded(session.id)
    expect(session.status).toBe('ENDED')
    expect(session.currentStageId).toBeNull()
    expect(session.Stages[1]).toMatchObject({ lifecycle: 'ENDED', endReason: 'TIME_REACHED' })
  })

  it('pauses the Session clock without inventing a paused Stage lifecycle', async () => {
    const created = await createSession(1, 2)
    let session = await publishAndStart(created!.id)
    const currentStageId = session.currentStageId!

    await executeTrainingCommand(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      type: 'PAUSE_SESSION',
      targetType: 'ALL',
      payload: { mode: 'SOFT' },
    })
    session = await loaded(session.id)
    expect(session.status).toBe('PAUSED')
    expect(session.Stages.find(stage => stage.id === currentStageId)).toMatchObject({ lifecycle: 'RUNNING', runningSince: null })

    await executeTrainingCommand(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      type: 'RESUME_SESSION',
      targetType: 'ALL',
      payload: {},
    })
    session = await loaded(session.id)
    expect(session.status).toBe('RUNNING')
    expect(session.Stages.find(stage => stage.id === currentStageId)?.runningSince).not.toBeNull()
  })


  it('separates the published roster from runtime join and leave events', async () => {
    const third = await createTestUser({ organization: { role: 'student', organizationId: coach.organization!.organizationId } })
    await prisma.teamMember.create({ data: { id: crypto.randomUUID(), teamId: team.id, userId: third.user.id, userType: 'student', role: 'member', status: 'active', joinedAt: new Date() } })
    const created = await createSession(1, 2)
    let session = await publishAndStart(created!.id)
    await executeStageTransition(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      action: 'advance',
      stageId: session.Stages[0].id,
      outcome: 'completed',
    })
    session = await loaded(session.id)

    await expect(replaceTrainingRoster(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      participants: [{ userId: first.user.id }, { userId: second.user.id }, { userId: third.user.id }],
    })).rejects.toMatchObject<Partial<TrainingEngineError>>({ code: 'TRAINING_ROSTER_DEFINITION_FROZEN' })

    await joinTrainingParticipantRuntime(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      userId: third.user.id,
      groupId: session.Groups[0].id,
      historyMode: 'absent',
      reason: '课堂中途加入',
    })
    session = await loaded(session.id)
    const participant = session.Participants.find(item => item.userId === third.user.id)!
    expect(participant).toMatchObject({ status: 'active', groupId: session.Groups[0].id })

    const historicalProblemId = session.Stages[0].Problems[0].id
    await expect(prisma.trainingSessionProblemProgress.findUniqueOrThrow({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: historicalProblemId } } })).resolves.toMatchObject({ status: 'SKIPPED' })
    const joinedWorkspace = await getTrainingWorkspace(third.user.id, session.id)
    expect(joinedWorkspace.participant).toMatchObject({ requiredCount: 2, completedCount: 1 })

    const stageProblemId = session.Stages[1].Problems[0].id
    await prisma.trainingSessionProblemProgress.create({ data: { participantId: participant.id, stageProblemId, status: 'WORKING', attemptCount: 1, bestScore: 30 } })
    await leaveTrainingParticipantRuntime(coach.user.id, session.id, participant.id, {
      expectedRevision: session.statusRevision,
      reason: '学生提前离开',
    })
    session = await loaded(session.id)
    expect(session.Participants.find(item => item.id === participant.id)?.status).toBe('left')
    await expect(prisma.trainingSessionProblemProgress.findUniqueOrThrow({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } } })).resolves.toMatchObject({ bestScore: 30 })

    const report = await getTrainingReport(coach.user.id, session.id)
    expect(report.rosterEvents.map(event => event.type)).toEqual([
      'training.participant.joined',
      'training.participant.left',
    ])
  })


  it('appends a targeted runtime problem without mutating the Stage snapshot', async () => {
    const extraProblem = await configuredProblem(coach.user.id)
    const created = await createSession(2, 1)
    let session = await publishAndStart(created!.id)
    const currentStage = session.Stages[0]
    const targetGroup = session.Groups[0]
    const otherGroup = session.Groups[1]
    const snapshotHash = currentStage.RuntimeSnapshot?.configHash

    await appendTrainingRuntimeProblem(coach.user.id, session.id, currentStage.id, {
      expectedRevision: session.statusRevision,
      targetType: 'GROUP',
      targetId: targetGroup.id,
      problemId: extraProblem.id,
      required: true,
      targetScore: 80,
      reason: '根据课堂进度追加练习',
    })
    session = await loaded(session.id)
    const appended = session.Stages[0].Problems.find(item => item.problemId === extraProblem.id)!
    expect(appended).toBeTruthy()
    expect(session.Stages[0].RuntimeSnapshot?.configHash).toBe(snapshotHash)

    const targetUserId = targetGroup.Participants[0].userId
    const otherUserId = otherGroup.Participants[0].userId
    const targetWorkspace = await getTrainingWorkspace(targetUserId, session.id)
    const otherWorkspace = await getTrainingWorkspace(otherUserId, session.id)
    expect(targetWorkspace.permissions[appended.id]).toMatchObject({ canView: true, canSubmit: true })
    expect(targetWorkspace.participant?.requiredCount).toBe(2)
    expect(otherWorkspace.permissions[appended.id]).toMatchObject({ canView: false, canSubmit: false })
    expect(otherWorkspace.participant?.requiredCount).toBe(1)

    session = await loaded(session.id)
    await appendTrainingRuntimeProblem(coach.user.id, session.id, currentStage.id, {
      expectedRevision: session.statusRevision,
      targetType: 'GROUP',
      targetId: otherGroup.id,
      problemId: extraProblem.id,
      required: false,
      targetScore: 60,
      reason: '提高组自选练习',
    })
    const optionalWorkspace = await getTrainingWorkspace(otherUserId, session.id)
    expect(optionalWorkspace.permissions[appended.id]).toMatchObject({ canView: true, canSubmit: true })
    expect(optionalWorkspace.participant?.requiredCount).toBe(1)

    session = await loaded(session.id)
    await executeTrainingCommand(coach.user.id, session.id, {
      type: 'UNLOCK_FOR_USER',
      expectedRevision: session.statusRevision,
      targetType: 'USER',
      targetId: targetUserId,
      payload: { stageProblemId: currentStage.Problems[0].id },
    })

    const report = await getTrainingReport(coach.user.id, session.id)
    expect(report.runtimeProblems).toHaveLength(2)
    expect(report.runtimeProblems.map(item => item.payload.targetScore)).toEqual([80, 60])
    expect(report.interventions.map(item => item.type)).toContain('UNLOCK_FOR_USER')
    const targetReport = await getTrainingReport(targetUserId, session.id)
    const otherReport = await getTrainingReport(otherUserId, session.id)
    expect(targetReport.runtimeProblems.map(item => item.payload.targetScore)).toEqual([80])
    expect(otherReport.runtimeProblems.map(item => item.payload.targetScore)).toEqual([60])
    expect(targetReport.interventions.map(item => item.type)).toContain('UNLOCK_FOR_USER')
    expect(otherReport.interventions.map(item => item.type)).not.toContain('UNLOCK_FOR_USER')
  })

  it('saves and reapplies a full immutable training template', async () => {
    const created = await createSession(2, 2)
    const source = await loaded(created!.id)
    const sourceProblem = source.Stages[0].Problems[0]
    await createTrainingHint(coach.user.id, source.id, {
      stageProblemId: sourceProblem.id,
      level: 1,
      title: '第一层提示',
      content: '先检查输入边界',
      openMode: 'MANUAL',
    })

    const template = await createTrainingSessionTemplate(coach.user.id, source.id, {
      name: '完整训练模板',
      scope: 'personal',
    })
    expect(template).toMatchObject({
      name: '完整训练模板',
      source: 'personal',
      problemCount: 2,
    })
    expect(template.key).toMatch(/^database:/)

    const recreated = await createTrainingSession(coach.user.id, {
      title: '从模板创建',
      teamId: team.id,
      participantUserIds: [],
      templateKey: template.key,
    })
    const restored = await loaded(recreated!.id)
    const restoredHints = await prisma.trainingSessionHint.findMany({ where: { sessionId: restored.id } })

    expect(restored.status).toBe('DRAFT')
    expect(restored.Groups.map(group => group.name)).toEqual(source.Groups.map(group => group.name))
    expect(restored.Stages.map(stage => stage.name)).toEqual(source.Stages.map(stage => stage.name))
    expect(restored.Stages.map(stage => stage.Problems.map(item => item.problemId)))
      .toEqual(source.Stages.map(stage => stage.Problems.map(item => item.problemId)))
    expect(restored.Stages.map(stage => stage.Groups.map(plan => ({
      group: plan.TrainingGroup?.name || null,
      isDefault: plan.isDefault,
      required: plan.ProblemPlans.map(item => item.required),
    })))).toEqual(source.Stages.map(stage => stage.Groups.map(plan => ({
      group: plan.TrainingGroup?.name || null,
      isDefault: plan.isDefault,
      required: plan.ProblemPlans.map(item => item.required),
    }))))
    expect(restoredHints).toHaveLength(1)
    expect(restoredHints[0]).toMatchObject({ level: 1, title: '第一层提示', content: '先检查输入边界' })
  })

  it('clones only the reusable training definition into a new draft', async () => {
    const created = await createSession(2, 2)
    const source = await loaded(created!.id)
    await createTrainingHint(coach.user.id, source.id, {
      stageProblemId: source.Stages[1].Problems[0].id,
      level: 2,
      content: '第二阶段提示',
      openMode: 'ATTEMPT',
      triggerAttempts: 2,
    })

    const clone = await cloneTrainingSession(coach.user.id, source.id, {
      expectedRevision: source.statusRevision,
      title: '训练副本',
    })
    const copied = await loaded(clone!.id)
    const copiedHints = await prisma.trainingSessionHint.findMany({ where: { sessionId: copied.id } })

    expect(copied.id).not.toBe(source.id)
    expect(copied).toMatchObject({ title: '训练副本', status: 'DRAFT', currentStageId: null })
    expect(copied.Participants).toHaveLength(0)
    expect(copied.Groups.map(group => group.name)).toEqual(source.Groups.map(group => group.name))
    expect(copied.Stages.map(stage => stage.lifecycle)).toEqual(['PENDING', 'PENDING'])
    expect(copied.Stages.map(stage => stage.Problems.map(item => item.problemId)))
      .toEqual(source.Stages.map(stage => stage.Problems.map(item => item.problemId)))
    expect(copiedHints).toHaveLength(1)
    expect(copiedHints[0]).toMatchObject({ level: 2, content: '第二阶段提示', triggerAttempts: 2 })
  })

  it('rejects edits to a started Stage definition', async () => {
    const created = await createSession(1, 1)
    const session = await publishAndStart(created!.id)
    const stage = session.Stages[0]
    const plan = stage.Groups[0]
    await expect(replaceTrainingStageGroupMatrix(coach.user.id, session.id, {
      expectedRevision: session.statusRevision,
      stagePlans: [{
        id: plan.id,
        clientKey: plan.id,
        stageId: stage.id,
        groupId: null,
        isDefault: true,
        inheritsDefault: false,
        accessPolicy: plan.accessPolicy,
        submissionMode: plan.submissionMode,
        problemIds: plan.ProblemPlans.map(item => item.stageProblemId),
        requiredProblemIds: plan.ProblemPlans
          .filter(item => item.required)
          .map(item => item.stageProblemId),
      }],
    })).rejects.toMatchObject<Partial<TrainingEngineError>>({ code: 'TRAINING_STAGE_FROZEN' })
  })
})
