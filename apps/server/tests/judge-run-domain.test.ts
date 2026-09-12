import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { JudgeAttemptState, JudgeRunStatus } from '@prisma/client'
import { prisma } from '../src/prisma'
import {
  claimNextQueuedSubmission,
  createQueuedSubmissionWithRun,
  createRejudgeBatch,
  finalizeOwnedJudgeAttempt,
  retryOwnedJudgeAttempt,
} from '../src/modules/judge/application/judge-run.service'
import {
  assertJudgeAttemptTransition,
  assertJudgeRunTransition,
  InvalidJudgeTransition,
  isTerminalJudgeAttemptState,
  isTerminalJudgeRunState,
  JUDGE_ATTEMPT_TRANSITIONS,
  JUDGE_RUN_TRANSITIONS,
  legacyResultToAttemptState,
} from '../src/modules/judge/domain/judge-state'
import { ensureContestAggregateTx } from '../src/modules/contest/contest-aggregate.service'

describe('Judge domain state machine', () => {
  it('allows only declared JudgeRun transitions', () => {
    expect(() => assertJudgeRunTransition('QUEUED', 'RUNNING')).not.toThrow()
    expect(() => assertJudgeRunTransition('RUNNING', 'FINALIZED')).not.toThrow()
    expect(() => assertJudgeRunTransition('FINALIZED', 'RUNNING')).toThrow(InvalidJudgeTransition)
    expect(() => assertJudgeRunTransition('CANCELLED', 'QUEUED')).toThrow(InvalidJudgeTransition)
  })

  it('allows retry only by creating another attempt, never by reopening a terminal attempt', () => {
    expect(() => assertJudgeAttemptTransition('QUEUED', 'CLAIMED')).not.toThrow()
    expect(() => assertJudgeAttemptTransition('CLAIMED', 'COMPILING')).not.toThrow()
    expect(() => assertJudgeAttemptTransition('COMPILING', 'RUNNING')).not.toThrow()
    expect(() => assertJudgeAttemptTransition('RUNNING', 'FINALIZING')).not.toThrow()
    expect(() => assertJudgeAttemptTransition('FINALIZING', 'SUCCEEDED')).not.toThrow()
    for (const terminal of ['SUCCEEDED', 'USER_ERROR', 'INFRA_ERROR', 'CANCELLED'] as JudgeAttemptState[]) {
      expect(JUDGE_ATTEMPT_TRANSITIONS[terminal]).toEqual([])
      expect(() => assertJudgeAttemptTransition(terminal, 'RUNNING')).toThrow(InvalidJudgeTransition)
    }
  })

  it('defines terminal states explicitly', () => {
    for (const state of Object.values(JudgeRunStatus)) {
      expect(isTerminalJudgeRunState(state)).toBe(JUDGE_RUN_TRANSITIONS[state].length === 0)
    }
    for (const state of Object.values(JudgeAttemptState)) {
      expect(isTerminalJudgeAttemptState(state)).toBe(JUDGE_ATTEMPT_TRANSITIONS[state].length === 0)
    }
  })

  it('maps compatibility results without creating illegal states', () => {
    expect(legacyResultToAttemptState('queuing')).toBe('QUEUED')
    expect(legacyResultToAttemptState('judging')).toBe('RUNNING')
    expect(legacyResultToAttemptState('accepted')).toBe('SUCCEEDED')
    expect(legacyResultToAttemptState('wa')).toBe('USER_ERROR')
    expect(legacyResultToAttemptState('judge_failed')).toBe('INFRA_ERROR')
  })
})

describe('Submission and Judge lifecycle creation', () => {
  it('creates Submission, JudgeRun and JudgeAttempt atomically', async () => {
    const userId = `judge-domain-user-${Date.now()}`
    const problemId = `judge-domain-problem-${Date.now()}`
    await prisma.user.create({ data: {
      id: userId, username: userId, passwordHash: 'test', role: 'student', status: 'active',
    } })
    await prisma.problem.create({ data: {
      id: problemId, platform: 'carits', problemId, title: 'Judge domain test',
      ownerId: userId, ownerType: 'user', visibility: 'private', status: 'published',
    } })

    const submission = await createQueuedSubmissionWithRun({
      userId, oj: 'carits', problemId, problemInternalId: problemId,
      language: 'cpp', code: 'int main(){}', codeLength: 12,
      result: 'queuing', submitMethod: 'local', submitScope: 'problem',
      inputFilename: 'travel.in', outputFilename: 'travel.out', ioAdapterVersion: 1,
    })
    const stored = await prisma.submission.findUniqueOrThrow({
      where: { id: submission.id },
      include: { CurrentJudgeRun: { include: { CurrentAttempt: true, Attempts: true } }, JudgeRuns: true },
    })
    expect(stored.CurrentJudgeRun).toMatchObject({
      runNumber: 1, runType: 'NORMAL', status: 'QUEUED', requestedBy: userId,
      inputFilename: 'travel.in', outputFilename: 'travel.out', ioAdapterVersion: 1,
    })
    expect(stored.CurrentJudgeRun?.CurrentAttempt).toMatchObject({ attemptNumber: 1, state: 'QUEUED' })
    expect(stored.CurrentJudgeRun?.Attempts).toHaveLength(1)
    expect(stored.JudgeRuns).toHaveLength(1)
  })

  it('does not create local Judge lifecycle rows for archive records', async () => {
    await expect(createQueuedSubmissionWithRun({
      userId: 'unused', oj: 'codeforces', problemId: '1A', language: 'cpp',
      code: '', codeLength: 0, result: 'accepted', submitMethod: 'archive',
    })).rejects.toThrow('Archive submissions do not create local Judge runs')
  })
})

async function createLifecycleFixture() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const userId = `judge-owner-${suffix}`
  const problemId = `judge-problem-${suffix}`
  await prisma.user.create({ data: {
    id: userId, username: userId, passwordHash: 'test', role: 'student', status: 'active',
  } })
  await prisma.problem.create({ data: {
    id: problemId, platform: 'carits', problemId, title: 'Lifecycle fixture',
    ownerId: userId, ownerType: 'user', visibility: 'private', status: 'published',
  } })
  const submission = await createQueuedSubmissionWithRun({
    userId, oj: 'carits', problemId, problemInternalId: problemId,
    language: 'cpp17', code: 'int main(){}', codeLength: 12,
    result: 'queuing', submitMethod: 'local', submitScope: 'problem',
  })
  return { userId, problemId, submission }
}

describe('Judge lifecycle ownership and retries', () => {
  it('claims and finalizes only the fenced current attempt', async () => {
    const fixture = await createLifecycleFixture()
    const claimed = await claimNextQueuedSubmission('judge-domain-1')
    expect(claimed?.submissionId).toBe(fixture.submission.id)

    const stale = await finalizeOwnedJudgeAttempt({
      submissionId: fixture.submission.id,
      judgeRunId: claimed!.judgeRunId,
      judgeAttemptId: claimed!.judgeAttemptId,
      fencingToken: 'wrong-token',
      judgeId: 'judge-domain-1',
      projection: { result: 'accepted', score: 100 },
    })
    expect(stale).toBeNull()

    const finalized = await finalizeOwnedJudgeAttempt({
      submissionId: fixture.submission.id,
      judgeRunId: claimed!.judgeRunId,
      judgeAttemptId: claimed!.judgeAttemptId,
      fencingToken: claimed!.fencingToken,
      judgeId: 'judge-domain-1',
      projection: { result: 'accepted', score: 100, timeUsed: 7 },
    })
    expect(finalized).toMatchObject({ id: fixture.submission.id, result: 'accepted', score: 100 })
    const stored = await prisma.submission.findUniqueOrThrow({
      where: { id: fixture.submission.id },
      include: { CurrentJudgeRun: { include: { CurrentAttempt: true } } },
    })
    expect(stored.CurrentJudgeRun).toMatchObject({ status: 'FINALIZED', result: 'accepted', score: 100 })
    expect(stored.CurrentJudgeRun?.CurrentAttempt).toMatchObject({ state: 'SUCCEEDED', result: 'accepted' })
  })

  it('creates another attempt for infrastructure retry and rejects the stale result', async () => {
    const fixture = await createLifecycleFixture()
    const first = await claimNextQueuedSubmission('judge-domain-retry')
    expect(first?.submissionId).toBe(fixture.submission.id)
    expect(await retryOwnedJudgeAttempt({
      submissionId: fixture.submission.id,
      judgeAttemptId: first!.judgeAttemptId,
      judgeId: 'judge-domain-retry',
      reason: 'sandbox reset',
    })).toBe(true)

    const afterRetry = await prisma.submission.findUniqueOrThrow({
      where: { id: fixture.submission.id },
      include: { CurrentJudgeRun: { include: { CurrentAttempt: true, Attempts: { orderBy: { attemptNumber: 'asc' } } } } },
    })
    expect(afterRetry.result).toBe('queuing')
    expect(afterRetry.CurrentJudgeRun?.Attempts.map(item => item.state)).toEqual(['INFRA_ERROR', 'QUEUED'])
    expect(afterRetry.CurrentJudgeRun?.CurrentAttempt).toMatchObject({ attemptNumber: 2, state: 'QUEUED' })

    const stale = await finalizeOwnedJudgeAttempt({
      submissionId: fixture.submission.id,
      judgeRunId: first!.judgeRunId,
      judgeAttemptId: first!.judgeAttemptId,
      fencingToken: first!.fencingToken,
      judgeId: 'judge-domain-retry',
      projection: { result: 'accepted', score: 100 },
    })
    expect(stale).toBeNull()
  })

  it('creates a durable RejudgeBatch and a new logical run', async () => {
    const fixture = await createLifecycleFixture()
    const first = await claimNextQueuedSubmission('judge-domain-batch')
    await finalizeOwnedJudgeAttempt({
      submissionId: fixture.submission.id,
      judgeRunId: first!.judgeRunId,
      judgeAttemptId: first!.judgeAttemptId,
      fencingToken: first!.fencingToken,
      judgeId: 'judge-domain-batch',
      projection: { result: 'wa', score: 0 },
    })
    const queued = await createRejudgeBatch({
      submissionIds: [fixture.submission.id],
      requestedBy: fixture.userId,
      scopeType: 'test',
      scopePayload: { problemId: fixture.problemId },
    })
    expect(queued).toMatchObject({ queuedCount: 1, skippedCount: 0 })
    expect(queued.batch).toMatchObject({ status: 'COMPLETED', matchedCount: 1, queuedCount: 1 })
    const stored = await prisma.submission.findUniqueOrThrow({
      where: { id: fixture.submission.id },
      include: { CurrentJudgeRun: { include: { CurrentAttempt: true } }, JudgeRuns: { orderBy: { runNumber: 'asc' } } },
    })
    expect(stored.result).toBe('queuing')
    expect(stored.JudgeRuns.map(item => item.status)).toEqual(['FINALIZED', 'QUEUED'])
    expect(stored.CurrentJudgeRun).toMatchObject({ runNumber: 2, runType: 'REJUDGE', rejudgeBatchId: queued.batch.id })
    expect(stored.CurrentJudgeRun?.CurrentAttempt).toMatchObject({ attemptNumber: 1, state: 'QUEUED' })
  })

  it('holds a finalized mapped contest through the Contest command boundary', async () => {
    const fixture = await createLifecycleFixture()
    const first = await claimNextQueuedSubmission('judge-domain-contest-rejudge')
    await finalizeOwnedJudgeAttempt({
      submissionId: fixture.submission.id,
      judgeRunId: first!.judgeRunId,
      judgeAttemptId: first!.judgeAttemptId,
      fencingToken: first!.fencingToken,
      judgeId: 'judge-domain-contest-rejudge',
      projection: { result: 'wa', score: 0 },
    })

    const now = Date.now()
    const contest = await prisma.training.create({ data: {
      title: 'Finalized contest rejudge fixture',
      format: 'ioi',
      startTime: new Date(now - 7_200_000),
      endTime: new Date(now - 3_600_000),
      status: 'finished',
      createdBy: fixture.userId,
      type: 'contest',
      scope: 'platform',
      finalizationStatus: 'FINALIZED',
    } })
    const standingId = crypto.randomUUID()
    await prisma.contestStandingSnapshot.create({ data: {
      id: standingId,
      trainingId: contest.id,
      revision: 1,
      scoringMode: 'IOI',
      rulesHash: 'judge-domain-rules',
      status: 'FINALIZED',
      inputHash: 'judge-domain-input',
      createdBy: fixture.userId,
      finalizedAt: new Date(),
    } })
    await prisma.training.update({
      where: { id: contest.id },
      data: { finalizedStandingId: standingId },
    })
    await prisma.$transaction(tx => ensureContestAggregateTx(tx, contest.id))

    const queued = await createRejudgeBatch({
      submissionIds: [fixture.submission.id],
      requestedBy: fixture.userId,
      trainingId: contest.id,
      scopeType: 'contest',
      scopePayload: { trainingId: contest.id },
    })
    expect(queued.queuedCount).toBe(1)
    expect(await prisma.training.findUnique({
      where: { id: contest.id },
      select: { finalizationStatus: true },
    })).toMatchObject({ finalizationStatus: 'HELD' })
    expect(await prisma.contest.findUnique({
      where: { runtimeTrainingId: contest.id },
      select: { runtimeTrainingId: true },
    })).toMatchObject({ runtimeTrainingId: contest.id })
  })
})
