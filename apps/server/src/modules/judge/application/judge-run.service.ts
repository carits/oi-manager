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

export interface CreateQueuedSubmissionOptions {
  runType?: JudgeRunType
  requestedBy?: string | null
  afterSubmissionCreated?: (tx: Prisma.TransactionClient, submission: { id: number; userId: string; createdAt: Date }) => Promise<void>
}

export interface ClaimedSubmissionLifecycle {
  submissionId: number
  problemInternalId: string
  trainingProblemId: string | null
  testSetRevisionId: string | null
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
  trainingId?: number | null
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
 * lifecycle in one transaction. Local execution state belongs exclusively to
 * JudgeRun/JudgeAttempt; Submission result columns are archive-only snapshots.
 */
export async function createQueuedSubmissionWithRun(
  data: Prisma.SubmissionUncheckedCreateInput,
  options: CreateQueuedSubmissionOptions = {},
) {
  if (data.submitMethod === 'archive') throw new Error('Archive submissions do not create local Judge runs')
  return prisma.$transaction(async tx => {
    const submission = await tx.submission.create({ data })
    const runId = crypto.randomUUID()
    const attemptId = crypto.randomUUID()
    await tx.judgeRun.create({
      data: {
        id: runId,
        submissionId: submission.id,
        runNumber: 1,
        runType: options.runType || 'NORMAL',
        status: 'QUEUED',
        testSetRevisionId: submission.testSetRevisionId,
        judgeConfigHash: submission.judgeConfigHash,
        judgeConfigSnapshot: submission.judgeConfigSnapshot,
        inputFilename: submission.inputFilename,
        outputFilename: submission.outputFilename,
        ioAdapterVersion: submission.ioAdapterVersion,
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

/** Claim the next physical attempt without mutating archive-only Submission result fields. */
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
        AND (
          submission."submitMethod" IN ('local', 'demo_scenario')
          OR (submission.oj = 'carits' AND submission."submitMethod" <> 'archive')
        )
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
        trainingProblemId: true,
        testSetRevisionId: true,
        judgeConfigSnapshot: true,
        code: true,
        language: true,
        CurrentJudgeRun: { select: { inputFilename: true, outputFilename: true, ioAdapterVersion: true, judgeConfigSnapshot: true } },
      },
    })
    if (!submission.problemInternalId) throw new Error('Queued local submission has no internal problem')
    return {
      submissionId: submission.id,
      problemInternalId: submission.problemInternalId,
      trainingProblemId: submission.trainingProblemId,
      testSetRevisionId: submission.testSetRevisionId,
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
  return prisma.$transaction(async tx => {
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
        trainingId: true,
        trainingProblemId: true,
        contestId: true,
        contestProblemId: true,
        trainingSessionId: true,
        trainingStageProblemId: true,
        assignmentId: true,
        assignmentProblemId: true,
        assignmentRecipientId: true,
      },
    })
    return { ...submission, result: input.projection.result, score: input.projection.score ?? null }
  })
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
  input: { requestedBy: string; rejudgeBatchId?: string | null },
) {
  await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} FOR UPDATE`
  const submission = await tx.submission.findUnique({
    where: { id: submissionId },
    include: { CurrentJudgeRun: true },
  })
  if (!submission || submission.submitMethod === 'archive' || !submission.problemInternalId) return false
  if (submission.CurrentJudgeRun && ['QUEUED', 'RUNNING'].includes(submission.CurrentJudgeRun.status)) return false

  const latest = await tx.judgeRun.aggregate({ where: { submissionId }, _max: { runNumber: true } })
  const runId = crypto.randomUUID()
  const attemptId = crypto.randomUUID()
  await tx.judgeRun.create({
    data: {
      id: runId,
      submissionId,
      runNumber: (latest._max.runNumber || 0) + 1,
      runType: 'REJUDGE',
      status: 'QUEUED',
      testSetRevisionId: submission.testSetRevisionId,
      judgeConfigHash: submission.judgeConfigHash,
      judgeConfigSnapshot: submission.judgeConfigSnapshot,
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
    const batchId = crypto.randomUUID()
    await tx.rejudgeBatch.create({
      data: {
        id: batchId,
        trainingId: input.trainingId || null,
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
      if (await queueRejudgeRun(tx, submissionId, { requestedBy: input.requestedBy, rejudgeBatchId: batchId })) {
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
    if (input.trainingId && queuedCount > 0) {
      const contest = await tx.training.findUnique({
        where: { id: input.trainingId },
        select: { type: true, finalizationStatus: true, finalizedStandingId: true },
      })
      if (contest?.type === 'contest' && contest.finalizedStandingId && contest.finalizationStatus === 'FINALIZED') {
        await tx.training.update({
          where: { id: input.trainingId },
          data: { finalizationStatus: 'HELD' },
        })
      }
    }
    return { batch, queuedCount, skippedCount }
  })
}
