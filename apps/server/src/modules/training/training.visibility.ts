/**
 * Training Module - OI Visibility Helper Functions
 * OI 赛制可见性体系化辅助函数
 *
 * 核心原则：真实 result 和展示 result 分开，数据库保留真实值，API 返回时脱敏
 */

import { prisma } from '../../prisma'
import { isTeamAdmin } from './training.helpers'

/** 训练运行时状态（不依赖数据库 status） */
export type TrainingRuntimeStatus = 'upcoming' | 'ongoing' | 'finished'

/** Training 类型定义（用于可见性判断） */
export interface TrainingForVisibility {
  id: number
  format: string
  type?: string
  status: string
  problemIdVisible?: boolean
  startTime: Date
  endTime: Date
  teamId: string | null
}

/** 题号赛后显示时，由 API 而不是页面统一隐藏比赛原题身份。 */
export function shouldHideTrainingProblemIdentity(training: TrainingForVisibility, isAdmin: boolean): boolean {
  return training.type === 'contest'
    && !isAdmin
    && !training.problemIdVisible
    && getTrainingRuntimeStatus(training) !== 'finished'
}

/** Submission 类型定义（用于脱敏） */
export interface SubmissionForSanitization {
  id: number
  userId: string
  oj: string
  problemId: string
  language: string
  codeLength: number
  code: string | null
  result: string
  score: number | null
  timeUsed: number | null
  memoryUsed: number | null
  ojRemoteId: string | null
  cases: string | null
  subtasks: string | null
  errorMessage: string | null
  createdAt: Date
  submitScope?: string
  trainingId?: number | null
}

/** 脱敏后的提交数据 */
export interface SanitizedSubmission {
  id: number
  userId: string
  oj: string
  problemId: string
  language: string
  codeLength: number
  submittedAt: string

  // 脱敏字段
  hidden: boolean
  displayResult: 'pending' | 'queuing' | string

  // 真实字段置空（OI 赛中非管理员）
  result: string | null
  score: number | null
  timeUsed: number | null
  memoryUsed: number | null
  ojRemoteId: string | null
  cases: string | null
  subtasks: string | null
  errorMessage: string | null
  code: string | null
}

/** 脱敏后的排名响应 */
export interface HiddenRankingResponse {
  hidden: true
  message: string
  format: string
  status: string
  ranking: never[]  // 不返回真实排名数据，前端期望 ranking 字段
}

/**
 * 运行时状态判断（不依赖数据库 status）
 * 关键：endTime 已过但 status 未更新时，必须返回 finished
 */
export function getTrainingRuntimeStatus(training: TrainingForVisibility): TrainingRuntimeStatus {
  const now = new Date()

  if (training.status === 'finished') return 'finished'
  if (now < training.startTime) return 'upcoming'
  if (now <= training.endTime) return 'ongoing'
  return 'finished'  // endTime 已过，无论 status 是什么
}

/**
 * 判断用户是否为训练管理员
 */
export async function isTrainingAdmin(userId: string, trainingId: number): Promise<boolean> {
  // 复用现有权限逻辑
  const training = await prisma.training.findUnique({
    where: { id: trainingId },
    select: { teamId: true, schoolId: true }
  })
  if (!training) return false

  // 检查团队管理员权限
  return training.teamId ? isTeamAdmin(userId, training.teamId) : false
}

/**
 * OI 赛制是否需要隐藏结果
 * @returns true 表示需要隐藏（OI 赛中非管理员）
 */
export async function shouldHideOiResults(
  training: TrainingForVisibility,
  userId: string
): Promise<boolean> {
  if (training.format !== 'oi') return false

  const runtimeStatus = getTrainingRuntimeStatus(training)
  if (runtimeStatus === 'finished') return false

  return !await isTrainingAdmin(userId, training.id)
}

/**
 * 脱敏提交数据（OI 赛中非管理员）
 * 使用 displayResult: 'pending' 表示"已提交，结果待公布"
 */
export function sanitizeSubmissionForOi(submission: SubmissionForSanitization): SanitizedSubmission {
  return {
    id: submission.id,
    userId: submission.userId,
    oj: submission.oj,
    problemId: submission.problemId,
    language: submission.language,
    codeLength: submission.codeLength,
    submittedAt: submission.createdAt.toISOString(),

    // 脱敏字段
    hidden: true,
    displayResult: 'pending',  // "已提交，结果待公布"，不伪装成 queuing

    // 真实字段置空（关键：ojRemoteId 必须为 null，防止通过远程 ID 跳转查看结果）
    result: null,
    score: null,
    timeUsed: null,
    memoryUsed: null,
    ojRemoteId: null,
    cases: null,
    subtasks: null,
    errorMessage: null,
    code: null,
  }
}

/**
 * 脱敏排名数据（OI 赛中非管理员）
 */
export function sanitizeRankingForOi(
  training: TrainingForVisibility
): HiddenRankingResponse {
  const runtimeStatus = getTrainingRuntimeStatus(training)
  return {
    hidden: true,
    message: 'OI 赛制赛中隐藏排名',
    format: training.format,
    status: runtimeStatus,
    ranking: [],  // 不返回真实排名数据
  }
}

/**
 * 判断提交是否属于训练
 * 使用新字段 submitScope + trainingId
 */
export function isTrainingSubmission(
  submission: { submitScope?: string | null; trainingId?: number | null },
  trainingId: number
): boolean {
  if (submission.submitScope === 'training' && submission.trainingId === trainingId) {
    return true
  }
  // 比赛提交也属于该训练（contest 复用 Training 表）
  if (submission.submitScope === 'contest' && submission.trainingId === trainingId) {
    return true
  }

  return false
}

/**
 * 判断提交是否为任何训练提交（用于全局接口排除）
 */
export function isAnyTrainingSubmission(
  submission: { submitScope?: string | null }
): boolean {
  if (submission.submitScope === 'training') return true
  if (submission.submitScope === 'contest') return true

  return false
}
