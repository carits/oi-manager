/**
 * School Contest Test Helpers
 * 校级比赛测试辅助函数
 */

import crypto from 'node:crypto'
import { prisma } from '../../src/prisma'
import { ensureCanonicalContestFixtureTx, syncCanonicalContestProblemFixtureTx } from './contest-fixture'

interface CreateTestSchoolContestOptions {
  organizationId: string
  createdBy: string
  title?: string
  description?: string
  format?: 'ioi' | 'icpc' | 'oi'
  type?: 'contest' | 'training'
  startTime?: Date
  endTime?: Date
  status?: 'upcoming' | 'ongoing' | 'finished'
  problemIdVisible?: boolean
  solutionVisible?: boolean
  includeAdminInRanking?: boolean
}

/**
 * 创建测试校级比赛
 * 注意：组织比赛 teamId=null，直接使用规范 organizationId 归属组织
 */
export async function createTestSchoolContest(options: CreateTestSchoolContestOptions) {
  const {
    organizationId,
    createdBy,
    title = '测试校级比赛',
    description,
    format = 'ioi',
    type = 'contest',
    startTime,
    endTime,
    status = 'ongoing',
    problemIdVisible = false,
    solutionVisible = false,
    includeAdminInRanking = false,
  } = options

  const now = Date.now()
  const defaultStartTime = startTime ?? new Date(now - 3600000) // 1小时前开始
  const defaultEndTime = endTime ?? new Date(now + 3600000) // 1小时后结束
  const training = await prisma.training.create({
    data: {
      organizationId,
      teamId: null, // 校级比赛 teamId 必须为 null
      title,
      description,
      format,
      type,
      startTime: defaultStartTime,
      endTime: defaultEndTime,
      status,
      problemIdVisible,
      solutionVisible,
      includeAdminInRanking,
      createdBy,
      updatedAt: new Date(),
    },
  })

  if (training.type === 'contest') {
    await prisma.$transaction(tx => ensureCanonicalContestFixtureTx(tx, training.id))
  }

  return training
}

/**
 * 创建测试题目（用于校级比赛）
 */
export async function createTestContestProblem(options: {
  ownerId: string
  platform?: string
  problemId?: string
  title?: string
}) {
  const {
    ownerId,
    platform = 'carits',
    problemId,
    title = '测试题目',
  } = options

  const uniqueProblemId = problemId ?? `TEST_P_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const id = `prob_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  const problem = await prisma.problem.create({
    data: {
      id,
      platform,
      problemId: uniqueProblemId,
      title,
      ownerId,
      visibility: 'public',
      libraryScope: 'platform',
      libraryKey: 'platform',
      status: 'published',
      publishedAt: new Date(),
    },
  })

  return problem
}

/**
 * 为校级比赛添加题目
 */
export async function addProblemToContest(options: {
  trainingId: number
  problemId: string
  alias?: string
  points?: number
  orderIndex?: number
}) {
  const {
    trainingId,
    problemId,
    alias,
    points = 100,
    orderIndex = 1,
  } = options

  const trainingProblem = await prisma.trainingProblem.create({
    data: {
      id: `tp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      trainingId,
      problemId,
      alias,
      orderIndex,
      points,
    },
  })

  const training = await prisma.training.findUniqueOrThrow({
    where: { id: trainingId },
    select: { type: true },
  })
  if (training.type === 'contest') {
    await prisma.$transaction(tx => syncCanonicalContestProblemFixtureTx(tx, trainingProblem.id))
  }

  return trainingProblem
}

/**
 * 创建测试提交记录（用于校级比赛）
 * 注意：Submission 模型没有 userType/schoolId 字段，只有 userId/trainingId/submitScope
 */
export async function createTestSubmission(options: {
  userId: string
  trainingId: number
  problemId: string  // 外部题号（如 'TEST_P001'）
  trainingProblemId?: string  // TrainingProblem.id
  result?: string
  score?: number
  timeUsed?: number
  memoryUsed?: number
  submitScope?: 'contest' | 'training'
  oj?: string
  cases?: string
  createdAt?: Date
}) {
  const {
    userId,
    trainingId,
    problemId,
    trainingProblemId,
    result = 'accepted',
    score = 100,
    timeUsed = 100,
    memoryUsed = 1024,
    submitScope = 'contest',
    oj = 'carits',
    cases,
    createdAt,
  } = options

  const [training, trainingProblem] = await Promise.all([
    prisma.training.findUniqueOrThrow({
      where: { id: trainingId },
      select: { organizationId: true, scope: true, type: true },
    }),
    trainingProblemId
      ? prisma.trainingProblem.findUnique({ where: { id: trainingProblemId }, select: { problemId: true } })
      : Promise.resolve(null),
  ])
  const canonicalProblem = submitScope === 'contest' && trainingProblemId
    ? await prisma.$transaction(async tx => {
        await ensureCanonicalContestFixtureTx(tx, trainingId)
        return syncCanonicalContestProblemFixtureTx(tx, trainingProblemId)
      })
    : null
  if (submitScope === 'contest' && !canonicalProblem) {
    throw new Error('Contest test submission requires a canonical ContestProblem')
  }
  const submission = await prisma.submission.create({
    data: {
      userId,
      oj,
      problemId,
      language: 'cpp',
      code: '#include <iostream>\nint main() { return 0; }',
      codeLength: 50,
      trainingId: submitScope === 'contest' ? null : trainingId,
      trainingProblemId: submitScope === 'contest' ? null : trainingProblemId,
      submitScope,
      canonicalContestId: canonicalProblem?.contestId || null,
      canonicalContestProblemId: canonicalProblem?.id || null,
      submitMethod: 'local',
      workspaceScope: training.scope,
      organizationId: training.organizationId,
      problemInternalId: trainingProblem?.problemId ?? null,
      isGlobalVisible: submitScope === 'contest' ? false : true,
      ojRemoteId: null,
      createdAt: createdAt ?? new Date(),
    },
  })

  // Local result facts live in JudgeRun. Keep this shared fixture compatible
  // with the production read model instead of relying on legacy Submission
  // projection columns.
  if (trainingProblem?.problemId) {
    const runId = crypto.randomUUID()
    await prisma.judgeRun.create({
      data: {
        id: runId,
        submissionId: submission.id,
        runNumber: 1,
        runType: 'NORMAL',
        status: 'FINALIZED',
        result,
        score,
        timeUsed,
        memoryUsed,
        cases: cases ?? JSON.stringify([{ status: 'accepted', time: 100, memory: 1024 }]),
        finalizedAt: createdAt ?? new Date(),
      },
    })
    await prisma.submission.update({
      where: { id: submission.id },
      data: { currentJudgeRunId: runId },
    })
  }

  return submission
}
