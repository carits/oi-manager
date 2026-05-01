/**
 * 提交记录可见性策略
 *
 * 核心原则：真实 result 和展示 result 分开，数据库保留真实值，API 返回时脱敏。
 * 后端兜底，不依赖前端隐藏。
 */

import type { Training, User } from '@prisma/client'

/**
 * 提交记录基础类型（从 Prisma 查询结果）
 */
export interface SubmissionRecord {
  id: number
  userId: string
  oj: string
  problemId: string
  language: string
  codeLength: number
  result: string
  score: number | null
  timeUsed: number | null
  memoryUsed: number | null
  ojRemoteId: string | null
  cases: string | null
  subtasks: string | null
  errorMessage: string | null
  code: string
  submittedAt: Date
  submitScope: string
  trainingId: number | null
  trainingProblemId: string | null
  contestId: number | null
  contestProblemId: string | null
  isGlobalVisible: boolean
}

/**
 * 训练信息（用于 OI 赛制判断）
 */
export interface TrainingInfo {
  id: number
  format: string // 'oi' | 'ioi' | 'icpc'
  type: string   // 'training' | 'contest'
  startTime: Date
  endTime: Date
  status: string
}

/**
 * 可见性选项
 */
export interface SubmissionViewOptions {
  submission: SubmissionRecord
  viewerId: string
  viewerRole: string
  training?: TrainingInfo | null
}

/**
 * 可见性结果
 */
export interface SubmissionViewResult {
  // 基础字段（始终可见）
  id: number
  userId: string
  oj: string
  problemId: string
  language: string
  codeLength: number
  submittedAt: Date
  submitScope: string
  trainingId: number | null
  trainingProblemId: string | null
  contestId: number | null
  contestProblemId: string | null

  // 可见性依赖字段（可能 null）
  result: string | null
  score: number | null
  timeUsed: number | null
  memoryUsed: number | null
  ojRemoteId: string | null
  cases: string | null
  subtasks: string | null
  errorMessage: string | null
  code: string | null

  // 元数据
  hidden: boolean
  displayResult: string
}

/**
 * 获取训练运行时状态
 */
export function getTrainingRuntimeStatus(
  training: TrainingInfo
): 'upcoming' | 'ongoing' | 'finished' {
  const now = new Date()
  if (now < training.startTime) return 'upcoming'
  if (now > training.endTime) return 'finished'
  return 'ongoing'
}

/**
 * 判断是否应该隐藏 OI 赛制结果
 *
 * OI 赛制规则：
 * - 比赛进行中：非管理员看不到真实结果
 * - 比赛结束后：所有人都能看到真实结果
 */
export function shouldHideOiResults(
  training: TrainingInfo | null | undefined,
  viewerRole: string
): boolean {
  if (!training) return false

  // 只有 OI 赛制需要隐藏
  if (training.format !== 'oi') return false

  // 管理员始终可见
  if (
    viewerRole === 'super_admin' ||
    viewerRole === 'platform_admin' ||
    viewerRole === 'school_principal' ||
    viewerRole === 'teacher'
  ) {
    return false
  }

  // 比赛结束后可见
  const runtimeStatus = getTrainingRuntimeStatus(training)
  if (runtimeStatus === 'finished') return false

  // OI 赛制进行中，学生不可见
  return true
}

/**
 * 获取提交记录的可见性视图
 *
 * 核心逻辑：
 * - submitScope='problem'：学生只看自己，教师看管理范围内，管理员看全部
 * - submitScope='training'：训练默认显示真实结果（非 OI）
 * - submitScope='contest'：根据 Training.format 做 ACM/OI/IOI 脱敏
 *   - OI 赛中非管理员：result/score/timeUsed/memoryUsed/cases/subtasks/ojRemoteId/errorMessage 全 null
 *   - ACM/IOI：正常显示
 * - 比赛结束后（runtimeStatus='finished'）：所有赛制显示真实结果
 */
export function getSubmissionView(
  options: SubmissionViewOptions
): SubmissionViewResult {
  const { submission, viewerId, viewerRole, training } = options

  // 基础字段始终可见
  const baseResult: SubmissionViewResult = {
    id: submission.id,
    userId: submission.userId,
    oj: submission.oj,
    problemId: submission.problemId,
    language: submission.language,
    codeLength: submission.codeLength,
    submittedAt: submission.submittedAt,
    submitScope: submission.submitScope,
    trainingId: submission.trainingId,
    trainingProblemId: submission.trainingProblemId,
    contestId: submission.contestId,
    contestProblemId: submission.contestProblemId,
    result: submission.result,
    score: submission.score ?? null,
    timeUsed: submission.timeUsed,
    memoryUsed: submission.memoryUsed,
    ojRemoteId: submission.ojRemoteId,
    cases: submission.cases,
    subtasks: submission.subtasks,
    errorMessage: submission.errorMessage,
    code: submission.code,
    hidden: false,
    displayResult: submission.result,
  }

  // 题库提交：学生只看自己，教师看管理范围内，管理员看全部
  if (submission.submitScope === 'problem') {
    // 学生只能看自己的提交
    if (viewerRole === 'student' && submission.userId !== viewerId) {
      return {
        ...baseResult,
        result: null,
        score: null,
        timeUsed: null,
        memoryUsed: null,
        ojRemoteId: null,
        cases: null,
        subtasks: null,
        errorMessage: null,
        code: null,
        hidden: true,
        displayResult: 'forbidden',
      }
    }
    return baseResult
  }

  // 训练提交：默认显示真实结果（非 OI 赛制）
  if (submission.submitScope === 'training') {
    const shouldHide = shouldHideOiResults(training, viewerRole)
    if (shouldHide) {
      return {
        ...baseResult,
        result: null,
        score: null,
        timeUsed: null,
        memoryUsed: null,
        ojRemoteId: null,
        cases: null,
        subtasks: null,
        errorMessage: null,
        code: null,
        hidden: true,
        displayResult: 'pending',
      }
    }
    return baseResult
  }

  // 比赛提交：根据赛制脱敏
  if (submission.submitScope === 'contest') {
    const shouldHide = shouldHideOiResults(training, viewerRole)
    if (shouldHide) {
      return {
        ...baseResult,
        result: null,
        score: null,
        timeUsed: null,
        memoryUsed: null,
        ojRemoteId: null,
        cases: null,
        subtasks: null,
        errorMessage: null,
        code: null,
        hidden: true,
        displayResult: 'pending',
      }
    }
    return baseResult
  }

  // 未知 submitScope，返回基础结果
  return baseResult
}

/**
 * 批量处理提交记录可见性
 */
export function getSubmissionViews(
  submissions: SubmissionRecord[],
  viewerId: string,
  viewerRole: string,
  trainingMap: Map<number, TrainingInfo>
): SubmissionViewResult[] {
  return submissions.map((submission) => {
    let training: TrainingInfo | undefined

    // 根据 submitScope 获取对应的训练信息
    if (submission.submitScope === 'training' && submission.trainingId) {
      training = trainingMap.get(submission.trainingId)
    } else if (submission.submitScope === 'contest' && submission.contestId) {
      training = trainingMap.get(submission.contestId)
    }

    return getSubmissionView({
      submission,
      viewerId,
      viewerRole,
      training,
    })
  })
}

/**
 * 脱敏提交记录（用于 OI 赛制）
 *
 * 将敏感字段置空，保留基础信息
 */
export function sanitizeSubmissionForOi(
  submission: SubmissionRecord
): SubmissionViewResult {
  return {
    id: submission.id,
    userId: submission.userId,
    oj: submission.oj,
    problemId: submission.problemId,
    language: submission.language,
    codeLength: submission.codeLength,
    submittedAt: submission.submittedAt,
    submitScope: submission.submitScope,
    trainingId: submission.trainingId,
    trainingProblemId: submission.trainingProblemId,
    contestId: submission.contestId,
    contestProblemId: submission.contestProblemId,
    result: null,
    score: null,
    timeUsed: null,
    memoryUsed: null,
    ojRemoteId: null,
    cases: null,
    subtasks: null,
    errorMessage: null,
    code: null,
    hidden: true,
    displayResult: 'pending',
  }
}

/**
 * 判断用户是否可以查看提交详情
 *
 * 规则：
 * - 管理员：可以查看所有
 * - 教师：可以查看管理范围内的学生提交
 * - 学生：只能查看自己的提交
 */
export function canViewSubmission(
  submission: SubmissionRecord,
  viewerId: string,
  viewerRole: string,
  managedStudentIds?: Set<string>
): boolean {
  // 管理员可以查看所有
  if (
    viewerRole === 'super_admin' ||
    viewerRole === 'platform_admin' ||
    viewerRole === 'school_principal'
  ) {
    return true
  }

  // 教师可以查看管理范围内的学生提交
  if (viewerRole === 'teacher') {
    // 自己的提交
    if (submission.userId === viewerId) return true
    // 管理范围内的学生提交
    if (managedStudentIds && managedStudentIds.has(submission.userId)) return true
    return false
  }

  // 学生只能查看自己的提交
  if (viewerRole === 'student') {
    return submission.userId === viewerId
  }

  return false
}
