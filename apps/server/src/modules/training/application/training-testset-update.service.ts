import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { canManageTraining } from '../training.helpers'

export class TrainingTestSetUpdateError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string, data?: unknown): never {
  throw new TrainingTestSetUpdateError(statusCode, code, message, data)
}

function loadContext(client: any, trainingId: number, trainingProblemId: string) {
  return client.trainingProblem.findFirst({
    where: { id: trainingProblemId, trainingId },
    include: {
      Training: true,
      TestSetRevision: true,
      Problem: { include: { LatestTestSetRevision: true } },
    },
  })
}

async function revisionState(client: any, item: any) {
  const submissionCount = await client.submission.count({
    where: { trainingProblemId: item.id },
  })
  const started = new Date() >= item.Training.startTime
  const frozen = started || submissionCount > 0
  const latest = item.Problem.LatestTestSetRevision
  const current = item.TestSetRevision
  return {
    currentRevisionId: current?.id || null,
    currentRevision: current?.revisionNumber || null,
    latestRevisionId: latest?.id || null,
    latestRevision: latest?.revisionNumber || null,
    pending: Boolean(latest && latest.id !== current?.id),
    frozen,
    frozenReason: started ? '活动已经开始' : submissionCount > 0 ? '活动已经存在提交记录' : null,
    submissionCount,
  }
}

async function requireManagedContext(trainingId: number, trainingProblemId: string, userId: string) {
  const item = await loadContext(prisma, trainingId, trainingProblemId)
  if (!item) fail(404, 'TRAINING_PROBLEM_NOT_FOUND', '活动题目不存在')
  if (!await canManageTraining(userId, item.Training)) {
    fail(403, 'TRAINING_MANAGE_DENIED', '无活动管理权限')
  }
  return item
}

export async function previewTrainingTestSetUpdate(
  trainingId: number,
  trainingProblemId: string,
  userId: string,
) {
  const item = await requireManagedContext(trainingId, trainingProblemId, userId)
  return {
    trainingProblemId: item.id,
    problemId: item.problemId,
    problemTitle: item.Problem.title,
    ...await revisionState(prisma, item),
  }
}

export async function updateTrainingTestSetRevision(params: {
  trainingId: number
  trainingProblemId: string
  userId: string
  revisionId?: string
}) {
  await requireManagedContext(params.trainingId, params.trainingProblemId, params.userId)
  return prisma.$transaction(async tx => {
    const item = await loadContext(tx, params.trainingId, params.trainingProblemId)
    if (!item) fail(404, 'TRAINING_PROBLEM_NOT_FOUND', '活动题目不存在')
    const state = await revisionState(tx, item)
    if (state.frozen) {
      fail(
        409,
        'TEST_SET_REVISION_FROZEN',
        `${state.frozenReason}，测试版本已永久冻结`,
        state,
      )
    }
    const revisionId = params.revisionId || item.Problem.latestTestSetRevisionId
    if (!revisionId) {
      fail(409, 'TEST_SET_REVISION_REQUIRED', '题库尚无正式测试版本')
    }
    const revision = await tx.problemTestSetRevision.findFirst({
      where: { id: revisionId, problemId: item.problemId },
    })
    if (!revision) fail(404, 'TEST_SET_REVISION_NOT_FOUND', '测试版本不存在')
    if (revision.id === item.testSetRevisionId) {
      return { updated: false, state, message: '活动已经使用该测试版本' }
    }
    await tx.trainingProblem.update({
      where: { id: item.id },
      data: {
        testSetRevisionId: revision.id,
        judgeConfigSnapshot: revision.judgeConfig,
        testGraphRevisionSnapshot: revision.revisionNumber,
        snapshotCreatedAt: new Date(),
        dataVersion: '2',
      },
    })
    return {
      updated: true,
      previousRevisionId: item.testSetRevisionId,
      currentRevisionId: revision.id,
      currentRevision: revision.revisionNumber,
      message: `活动已固定到测试版本 R${revision.revisionNumber}`,
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
