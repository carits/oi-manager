import crypto from 'node:crypto'
import {
  JudgeAttemptState,
  JudgeRunStatus,
  JudgeRunType,
  Prisma,
} from '@prisma/client'
import { prisma } from '../../../prisma'
import {
  assertJudgeAttemptTransition,
  assertJudgeRunTransition,
} from '../domain/judge-state'
import { ensureContestRejudgeBarrierTx } from '../../contest/contest-command.service'
import { releaseTestSetReader, resolveSubmissionTestSet } from '../../problem/problem.testset-slot.service'

export interface CreateQueuedSubmissionOptions {
  runType?: JudgeRunType
  requestedBy?: string | null
  afterSubmissionCreated?: (tx: Prisma.TransactionClient, submission: { id: number; userId: string; createdAt: Date }) => Promise<void>
}

export interface ClaimedSubmissionLifecycle {
  submissionId: number
  problemInternalId: string
  trainingStageProblemId: string | null
  testSetSlot: 'STABLE' | 'EVOLVING' | null
  testSetFencingToken: number | null
  testSetGraphHash: string | null
  testSetReaderId: string | null
  judgeConfigSnapshot: string | null
  code: string
  language: string
  inputFilename: string | null
  outputFilename: string | null
  ioAdapterVersion: number
  judgeRunId: string
  judgeAttemptId: string
  fencingToken: string
}

export interface JudgeResultProjection {
  result: string
  timeUsed?: number | null
  wallTimeUsed?: number | null
  memoryUsed?: number | null
  timeoutReason?: string | null
  metricSource?: string | null
  score?: number | null
  cases?: string | null
  subtasks?: string | null
  errorMessage?: string | null
}

interface RejudgeRequest {
  submissionIds: number[]
  requestedBy: string
  contestId?: string | null
  scopeType: string
  scopePayload?: Prisma.InputJsonValue | null
}

const ACTIVE_ATTEMPT_STATES: JudgeAttemptState[] = ['CLAIMED', 'COMPILING', 'RUNNING', 'FINALIZING']

function terminalAttemptState(result: string): JudgeAttemptState {
  if (result === 'accepted') return 'SUCCEEDED'
  if (['system_error', 'judge_failed', 'unknown_error', 'remote_unavailable', 'submit_failed'].includes(result)) {
    return 'INFRA_ERROR'
  }
  return 'USER_ERROR'
}

/**
 * Creates immutable submission intent and its first logical/physical Judge
 * lifecycle in one transaction. Execution state belongs exclusively to
 * JudgeRun/JudgeAttempt.
 */
export async function createQueuedSubmissionWithRun(
  data: Prisma.SubmissionUncheckedCreateInput,
  options: CreateQueuedSubmissionOptions = {},
) {
  return prisma.$transaction(async tx => {
    // Submission is immutable request metadata. Ignore removed execution mirrors
    // defensively so stale callers cannot reintroduce Judge state on Submission.
    const {
      result: _result,
      timeUsed: _timeUsed,
      wallTimeUsed: _wallTimeUsed,
      memoryUsed: _memoryUsed,
      timeoutReason: _timeoutReason,
      metricSource: _metricSource,
      errorMessage: _errorMessage,
      cases: _cases,
      score: _score,
      subtasks: _subtasks,
      judgeId: _judgeId,
      judgeStarted: _judgeStarted,
      ...submissionData
    } = data as Prisma.SubmissionUncheckedCreateInput & Record<string, unknown>
    let submission = await tx.submission.create({
      data: submissionData as Prisma.SubmissionUncheckedCreateInput,
    })
    const runId = crypto.randomUUID()
    const attemptId = crypto.randomUUID()
    const acquired = submission.problemInternalId
      ? await resolveSubmissionTestSet({
          problemId: submission.problemInternalId,
          ownerType: 'JUDGE_RUN',
          ownerId: runId,
          slot: submission.testSetSlot || undefined,
          useEvolving: ['training', 'training_engine'].includes(submission.submitScope),
          transaction: tx,
        })
      : null
    if (acquired) {
      submission = await tx.submission.update({
        where: { id: submission.id },
        data: {
          testSetSlot: acquired.slot.slot,
          testSetFencingToken: acquired.slot.fencingToken,
          testSetGraphHash: acquired.slot.graphHash,
          judgeConfigHash: acquired.slot.judgeConfigHash,
          judgeConfigSnapshot: acquired.slot.judgeConfig,
        },
      })
    }
    await tx.judgeRun.create({
      data: {
        id: runId,
        submissionId: submission.id,
        runNumber: 1,
        runType: options.runType || 'NORMAL',
        status: 'QUEUED',
        testSetSlot: acquired?.slot.slot || submission.testSetSlot,
        testSetFencingToken: acquired?.slot.fencingToken || submission.testSetFencingToken,
        testSetGraphHash: acquired?.slot.graphHash || submission.testSetGraphHash,
        testSetReaderId: acquired?.reader.id || null,
        judgeConfigHash: acquired?.slot.judgeConfigHash || submission.judgeConfigHash,
        judgeConfigSnapshot: acquired?.slot.judgeConfig || submission.judgeConfigSnapshot,
        inputFilename: submission.inputFilename,
        outputFilename: submission.outputFilename,
        ioAdapterVersion: submission.ioAdapterVersion,
        trainingScoreGoalIndex: submission.trainingScoreGoalIndex,
        trainingScoreGoalSnapshot: submission.trainingScoreGoalSnapshot ?? undefined,
        requestedBy: options.requestedBy ?? submission.userId,
      },
    })
    await tx.judgeAttempt.create({
      data: {
        id: attemptId,
        judgeRunId: runId,
        attemptNumber: 1,
        state: 'QUEUED',
        fencingToken: crypto.randomUUID(),
      },
    })
    await tx.judgeRun.update({ where: { id: runId }, data: { currentAttemptId: attemptId } })
    if (options.afterSubmissionCreated) await options.afterSubmissionCreated(tx, submission)
    return tx.submission.update({ where: { id: submission.id }, data: { currentJudgeRunId: runId } })
  })
}

/** Claim the next physical attempt without mutating Submission result mirrors. */
export async function claimNextQueuedSubmission(judgeId: string): Promise<ClaimedSubmissionLifecycle | null> {
  return prisma.$transaction(async tx => {
    const candidates = await tx.$queryRaw<Array<{
      submissionId: number
      judgeRunId: string
      judgeAttemptId: string
      fencingToken: string
    }>>`
      SELECT submission.id AS "submissionId", run.id AS "judgeRunId",
             attempt.id AS "judgeAttemptId", attempt."fencingToken"
      FROM "JudgeAttempt" attempt
      JOIN "JudgeRun" run ON run.id = attempt."judgeRunId"
      JOIN "Submission" submission ON submission.id = run."submissionId"
      WHERE attempt.state = 'QUEUED'
        AND run.status IN ('QUEUED', 'RUNNING')
        AND run."currentAttemptId" = attempt.id
        AND submission."currentJudgeRunId" = run.id
        AND submission."problemInternalId" IS NOT NULL
        AND (submission."submitMethod" IN ('local', 'demo_scenario') OR submission.oj = 'carits')
      ORDER BY attempt."createdAt" ASC
      FOR UPDATE OF attempt SKIP LOCKED
      LIMIT 1
    `
    const candidate = candidates[0]
    if (!candidate) return null

    const now = new Date()
    assertJudgeAttemptTransition('QUEUED', 'CLAIMED')
    const claimed = await tx.judgeAttempt.updateMany({
      where: {
        id: candidate.judgeAttemptId,
        judgeRunId: candidate.judgeRunId,
        state: 'QUEUED',
        fencingToken: candidate.fencingToken,
      },
      data: {
        state: 'CLAIMED',
        judgeId,
        claimedAt: now,
        leaseUntil: new Date(now.getTime() + 5 * 60_000),
      },
    })
    if (claimed.count !== 1) return null

    const run = await tx.judgeRun.findUnique({ where: { id: candidate.judgeRunId }, select: { status: true } })
    if (!run) throw new Error('JudgeRun disappeared while claiming an attempt')
    if (run.status === 'QUEUED') {
      assertJudgeRunTransition('QUEUED', 'RUNNING')
      await tx.judgeRun.update({
        where: { id: candidate.judgeRunId },
        data: { status: 'RUNNING', startedAt: now },
      })
    }

    assertJudgeAttemptTransition('CLAIMED', 'RUNNING')
    await tx.judgeAttempt.update({
      where: { id: candidate.judgeAttemptId },
      data: { state: 'RUNNING', startedAt: now },
    })
    const submission = await tx.submission.findUniqueOrThrow({
      where: { id: candidate.submissionId },
      select: {
        id: true,
        problemInternalId: true,
        trainingStageProblemId: true,
        testSetSlot: true,
        testSetFencingToken: true,
        testSetGraphHash: true,
        judgeConfigSnapshot: true,
        code: true,
        language: true,
        CurrentJudgeRun: { select: { inputFilename: true, outputFilename: true, ioAdapterVersion: true, judgeConfigSnapshot: true, testSetReaderId: true } },
      },
    })
    if (!submission.problemInternalId) throw new Error('Queued local submission has no internal problem')
    return {
      submissionId: submission.id,
      problemInternalId: submission.problemInternalId,
      trainingStageProblemId: submission.trainingStageProblemId,
      testSetSlot: submission.testSetSlot,
      testSetFencingToken: submission.testSetFencingToken,
      testSetGraphHash: submission.testSetGraphHash,
      testSetReaderId: submission.CurrentJudgeRun?.testSetReaderId || null,
      judgeConfigSnapshot: submission.CurrentJudgeRun?.judgeConfigSnapshot || submission.judgeConfigSnapshot || null,
      code: submission.code,
      language: submission.language,
      inputFilename: submission.CurrentJudgeRun?.inputFilename || null,
      outputFilename: submission.CurrentJudgeRun?.outputFilename || null,
      ioAdapterVersion: submission.CurrentJudgeRun?.ioAdapterVersion ?? 0,
      judgeRunId: candidate.judgeRunId,
      judgeAttemptId: candidate.judgeAttemptId,
      fencingToken: candidate.fencingToken,
    }
  })
}

/** Finalize exactly the currently owned attempt. JudgeRun is the only local result fact. */
export async function finalizeOwnedJudgeAttempt(input: {
  submissionId: number
  judgeRunId: string
  judgeAttemptId: string
  fencingToken: string
  judgeId: string
  projection: JudgeResultProjection
  performance?: {
    resultReceivedAt: Date
    dispatchLatencyMs?: number | null
    compileLatencyMs?: number | null
    runLatencyMs?: number | null
  }
}) {
  const finalized = await prisma.$transaction(async tx => {
    assertJudgeAttemptTransition('RUNNING', 'FINALIZING')
    const finalizing = await tx.judgeAttempt.updateMany({
      where: {
        id: input.judgeAttemptId,
        judgeRunId: input.judgeRunId,
        fencingToken: input.fencingToken,
        judgeId: input.judgeId,
        state: 'RUNNING',
        JudgeRun: {
          submissionId: input.submissionId,
          currentAttemptId: input.judgeAttemptId,
          status: 'RUNNING',
          Submission: { currentJudgeRunId: input.judgeRunId },
        },
      },
      data: { state: 'FINALIZING' },
    })
    if (finalizing.count !== 1) return null

    const now = new Date()
    const attempt = await tx.judgeAttempt.findUniqueOrThrow({
      where: { id: input.judgeAttemptId },
      select: { createdAt: true, claimedAt: true },
    })
    const safeMetric = (value?: number | null) => Number.isFinite(value) && Number(value) >= 0
      ? Math.round(Number(value)) : null
    const queueLatencyMs = attempt.claimedAt ? Math.max(0, attempt.claimedAt.getTime() - attempt.createdAt.getTime()) : null
    const persistLatencyMs = input.performance
      ? Math.max(0, now.getTime() - input.performance.resultReceivedAt.getTime()) : null
    const totalLatencyMs = Math.max(0, now.getTime() - attempt.createdAt.getTime())
    const terminalState = terminalAttemptState(input.projection.result)
    assertJudgeAttemptTransition('FINALIZING', terminalState)
    await tx.judgeAttempt.update({
      where: { id: input.judgeAttemptId },
      data: {
        state: terminalState,
        result: input.projection.result,
        score: input.projection.score ?? null,
        cases: input.projection.cases ?? null,
        subtasks: input.projection.subtasks ?? null,
        errorMessage: input.projection.errorMessage ?? null,
        timeUsed: input.projection.timeUsed ?? null,
        wallTimeUsed: input.projection.wallTimeUsed ?? null,
        memoryUsed: input.projection.memoryUsed ?? null,
        timeoutReason: input.projection.timeoutReason ?? null,
        metricSource: input.projection.metricSource ?? null,
        queueLatencyMs,
        dispatchLatencyMs: safeMetric(input.performance?.dispatchLatencyMs),
        compileLatencyMs: safeMetric(input.performance?.compileLatencyMs),
        runLatencyMs: safeMetric(input.performance?.runLatencyMs),
        persistLatencyMs,
        totalLatencyMs,
        leaseUntil: null,
        finalizedAt: now,
      },
    })
    assertJudgeRunTransition('RUNNING', 'FINALIZED')
    await tx.judgeRun.update({
      where: { id: input.judgeRunId },
      data: {
        status: 'FINALIZED',
        result: input.projection.result,
        score: input.projection.score ?? null,
        cases: input.projection.cases ?? null,
        subtasks: input.projection.subtasks ?? null,
        errorMessage: input.projection.errorMessage ?? null,
        timeUsed: input.projection.timeUsed ?? null,
        wallTimeUsed: input.projection.wallTimeUsed ?? null,
        memoryUsed: input.projection.memoryUsed ?? null,
        timeoutReason: input.projection.timeoutReason ?? null,
        metricSource: input.projection.metricSource ?? null,
        finalizedAt: now,
      },
    })
    const submission = await tx.submission.findUniqueOrThrow({
      where: { id: input.submissionId },
      select: {
        id: true,
        userId: true,
        problemId: true,
        submitScope: true,
        trainingStageProblemId: true,
        canonicalContestId: true,
        canonicalContestProblemId: true,
        trainingSessionId: true,
        assignmentId: true,
        assignmentProblemId: true,
        assignmentRecipientId: true,
      },
    })
    const run = await tx.judgeRun.findUnique({ where: { id: input.judgeRunId }, select: { testSetReaderId: true } })
    return { ...submission, result: input.projection.result, score: input.projection.score ?? null, testSetReaderId: run?.testSetReaderId || null }
  })
  if (finalized?.testSetReaderId) await releaseTestSetReader(finalized.testSetReaderId)
  return finalized
}

async function retryAttemptTransaction(
  tx: Prisma.TransactionClient,
  input: { submissionId: number; judgeAttemptId?: string; judgeId?: string; reason: string },
) {
  const submission = await tx.submission.findUnique({
    where: { id: input.submissionId },
    include: {
      CurrentJudgeRun: {
        include: { CurrentAttempt: true },
      },
    },
  })
  const run = submission?.CurrentJudgeRun
  const attempt = run?.CurrentAttempt
  if (!submission || !run || !attempt) return false
  if (input.judgeAttemptId && attempt.id !== input.judgeAttemptId) return false
  if (input.judgeId && attempt.judgeId !== input.judgeId) return false
  if (!ACTIVE_ATTEMPT_STATES.includes(attempt.state)) return false

  const now = new Date()
  assertJudgeAttemptTransition(attempt.state, 'INFRA_ERROR')
  await tx.judgeAttempt.update({
    where: { id: attempt.id },
    data: {
      state: 'INFRA_ERROR',
      result: 'judge_failed',
      errorMessage: input.reason,
      leaseUntil: null,
      finalizedAt: now,
    },
  })
  const nextAttemptId = crypto.randomUUID()
  await tx.judgeAttempt.create({
    data: {
      id: nextAttemptId,
      judgeRunId: run.id,
      attemptNumber: attempt.attemptNumber + 1,
      state: 'QUEUED',
      fencingToken: crypto.randomUUID(),
      retryOfAttemptId: attempt.id,
    },
  })
  await tx.judgeRun.update({
    where: { id: run.id },
    data: { currentAttemptId: nextAttemptId, errorMessage: null },
  })
  return true
}

/** Infrastructure retry creates a new immutable Attempt; it never reopens one. */
export async function retryOwnedJudgeAttempt(input: {
  submissionId: number
  judgeAttemptId?: string
  judgeId?: string
  reason: string
}) {
  return prisma.$transaction(tx => retryAttemptTransaction(tx, input))
}

export async function recoverStaleJudgeAttempts(input: {
  judgeId?: string
  leaseBefore?: Date
  reason: string
}) {
  const attempts = await prisma.judgeAttempt.findMany({
    where: {
      state: { in: ACTIVE_ATTEMPT_STATES },
      ...(input.judgeId ? { judgeId: input.judgeId } : {}),
      ...(input.leaseBefore ? { leaseUntil: { lt: input.leaseBefore } } : {}),
    },
    select: {
      id: true,
      judgeId: true,
      JudgeRun: { select: { submissionId: true, currentAttemptId: true } },
    },
  })
  let recoveredCount = 0
  for (const attempt of attempts) {
    if (attempt.JudgeRun.currentAttemptId !== attempt.id) continue
    const recovered = await retryOwnedJudgeAttempt({
      submissionId: attempt.JudgeRun.submissionId,
      judgeAttemptId: attempt.id,
      judgeId: attempt.judgeId || undefined,
      reason: input.reason,
    })
    if (recovered) recoveredCount++
  }
  return recoveredCount
}

async function queueRejudgeRun(
  tx: Prisma.TransactionClient,
  submissionId: number,
  input: { requestedBy: string; rejudgeBatchId?: string | null; contestId?: string | null },
) {
  await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} FOR UPDATE`
  const submission = await tx.submission.findUnique({
    where: { id: submissionId },
    include: { CurrentJudgeRun: true },
  })
  if (!submission || !submission.problemInternalId) return false
  if (
    submission.submitScope === 'contest'
    && (!input.contestId || submission.canonicalContestId !== input.contestId)
  ) return false
  if (submission.CurrentJudgeRun && ['QUEUED', 'RUNNING'].includes(submission.CurrentJudgeRun.status)) return false

  const latest = await tx.judgeRun.aggregate({ where: { submissionId }, _max: { runNumber: true } })
  const runId = crypto.randomUUID()
  const attemptId = crypto.randomUUID()
  const acquired = await resolveSubmissionTestSet({
    problemId: submission.problemInternalId,
    ownerType: 'JUDGE_RUN',
    ownerId: runId,
    slot: submission.testSetSlot || undefined,
    useEvolving: ['training', 'training_engine'].includes(submission.submitScope),
    transaction: tx,
  })
  await tx.judgeRun.create({
    data: {
      id: runId,
      submissionId,
      runNumber: (latest._max.runNumber || 0) + 1,
      runType: 'REJUDGE',
      status: 'QUEUED',
      testSetSlot: acquired.slot.slot,
      testSetFencingToken: acquired.slot.fencingToken,
      testSetGraphHash: acquired.slot.graphHash,
      testSetReaderId: acquired.reader.id,
      judgeConfigHash: acquired.slot.judgeConfigHash,
      judgeConfigSnapshot: acquired.slot.judgeConfig,
      inputFilename: submission.inputFilename,
      outputFilename: submission.outputFilename,
      ioAdapterVersion: submission.ioAdapterVersion,
      rejudgeBatchId: input.rejudgeBatchId || null,
      requestedBy: input.requestedBy,
    },
  })
  await tx.judgeAttempt.create({
    data: {
      id: attemptId,
      judgeRunId: runId,
      attemptNumber: 1,
      state: 'QUEUED',
      fencingToken: crypto.randomUUID(),
    },
  })
  await tx.judgeRun.update({ where: { id: runId }, data: { currentAttemptId: attemptId } })
  await tx.submission.update({
    where: { id: submissionId },
    data: { currentJudgeRunId: runId },
  })
  return true
}

export async function rejudgeSubmissionWithRun(submissionId: number, requestedBy: string) {
  return prisma.$transaction(tx => queueRejudgeRun(tx, submissionId, { requestedBy }))
}

/** Queue a scope as a durable batch and create one new Run per eligible submission. */
export async function createRejudgeBatch(input: RejudgeRequest) {
  return prisma.$transaction(async tx => {
    if (input.contestId && input.submissionIds.length > 0) {
      await ensureContestRejudgeBarrierTx(tx, input.contestId)
    }
    const batchId = crypto.randomUUID()
    await tx.rejudgeBatch.create({
      data: {
        id: batchId,
        contestId: input.contestId || null,
        scopeType: input.scopeType,
        scopePayload: input.scopePayload ?? undefined,
        status: 'QUEUING',
        requestedBy: input.requestedBy,
        matchedCount: input.submissionIds.length,
        startedAt: new Date(),
      },
    })
    let queuedCount = 0
    for (const submissionId of input.submissionIds) {
      if (await queueRejudgeRun(tx, submissionId, {
        requestedBy: input.requestedBy,
        rejudgeBatchId: batchId,
        contestId: input.contestId,
      })) {
        queuedCount++
      }
    }
    const skippedCount = input.submissionIds.length - queuedCount
    const batch = await tx.rejudgeBatch.update({
      where: { id: batchId },
      data: {
        status: 'COMPLETED',
        queuedCount,
        skippedCount,
        completedAt: new Date(),
      },
    })
    return { batch, queuedCount, skippedCount }
  })
}
