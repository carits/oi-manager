/**
 * School Contest Test Helpers
 * 校级比赛测试辅助函数
 */

import { prisma } from '../../src/prisma'

interface CreateTestSchoolContestOptions {
  schoolId: string
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
 * 注意：校级比赛 teamId=null，schoolId 有值
 */
export async function createTestSchoolContest(options: CreateTestSchoolContestOptions) {
  const {
    schoolId,
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
      schoolId,
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
}) {
  const {
    trainingId,
    problemId,
    alias,
    points = 100,
  } = options

  const trainingProblem = await prisma.trainingProblem.create({
    data: {
      id: `tp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      trainingId,
      problemId,
      alias,
      orderIndex: 1,
      points,
    },
  })

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
  } = options

  const submission = await prisma.submission.create({
    data: {
      userId,
      oj,
      problemId,
      language: 'cpp',
      code: '#include <iostream>\nint main() { return 0; }',
      codeLength: 50,
      result,
      score,
      timeUsed,
      memoryUsed,
      trainingId,
      trainingProblemId,
      submitScope,
      submitMethod: 'robot',
      isGlobalVisible: submitScope === 'contest' ? false : true,
      ojRemoteId: null,
      cases: cases ?? JSON.stringify([{ status: 'accepted', time: 100, memory: 1024 }]),
      createdAt: new Date(),
    },
  })

  return submission
}