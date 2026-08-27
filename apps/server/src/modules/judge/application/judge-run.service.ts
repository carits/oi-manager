import crypto from 'node:crypto'
import { JudgeRunType, Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'

export interface CreateQueuedSubmissionOptions {
  runType?: JudgeRunType
  requestedBy?: string | null
}

/**
 * Creates immutable submission intent and its first logical/physical Judge
 * lifecycle in one transaction. Legacy Submission execution columns remain a
 * compatibility projection until all readers have switched to JudgeRun.
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
    return tx.submission.update({ where: { id: submission.id }, data: { currentJudgeRunId: runId } })
  })
}
