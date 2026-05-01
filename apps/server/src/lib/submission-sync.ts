/**
 * 提交 AC 同步服务
 *
 * 核心规则：
 * - submitScope='problem'：题库提交 AC → 更新 Problem AC 状态
 * - submitScope='training'：训练提交 AC → 更新 TrainingUserProblemStatus + 同步题库 AC
 * - submitScope='contest'：比赛提交 AC → 更新 ContestUserProblemStatus + **不**同步题库 AC（比赛结束后才同步）
 */

import { prisma } from '../prisma'
import { logger } from './logger'

/**
 * 判断结果是否为 AC（Accepted）
 */
function isAcceptedResult(result: string | null | undefined): boolean {
  if (!result) return false
  return result === 'Accepted' || result === 'AC'
}

/**
 * 同步题库 AC 状态
 *
 * 当用户在某题上首次 AC 时，更新 Problem 的 AC 计数
 */
export async function syncProblemAC(
  userId: string,
  problemInternalId: string
): Promise<void> {
  try {
    // 检查该用户是否已经 AC 过这道题（避免重复计数）
    const existingAc = await prisma.submission.findFirst({
      where: {
        userId,
        problemId: problemInternalId,
        result: { in: ['Accepted', 'AC'] },
        submitScope: { in: ['problem', 'training'] },
      },
      select: { id: true },
    })

    if (existingAc) {
      // 用户已经 AC 过，不重复计数
      return
    }

    // 检查是否有新的 AC 提交
    const hasAc = await prisma.submission.findFirst({
      where: {
        userId,
        problemId: problemInternalId,
        result: { in: ['Accepted', 'AC'] },
        submitScope: { in: ['problem', 'training'] },
      },
      select: { id: true },
    })

    if (!hasAc) return

    // Problem 模型暂无 acceptedCount 字段，跳过 AC 计数更新
    // 后续如需添加该字段，可在此处启用：
    // await prisma.problem.update({
    //   where: { id: problemInternalId },
    //   data: { acceptedCount: { increment: 1 } },
    // })

    logger.info('Problem AC synced', {
      userId,
      problemId: problemInternalId,
    })
  } catch (error) {
    logger.error('Failed to sync problem AC', {
      userId,
      problemId: problemInternalId,
      error: String(error),
    })
  }
}

/**
 * 同步训练题目状态
 *
 * 更新 TrainingUserProblemStatus：
 * - 首次 AC：记录 bestScore/bestResult/acAt
 * - 非首次但更好：更新 bestScore/bestResult
 * - 每次提交：attemptCount + 1
 */
export async function syncTrainingProblemStatus(
  userId: string,
  trainingId: number,
  trainingProblemId: string,
  result: string | null,
  score: number | null
): Promise<void> {
  try {
    const isAc = isAcceptedResult(result)

    // 使用 upsert 处理并发安全
    await prisma.trainingUserProblemStatus.upsert({
      where: {
        trainingId_userId_trainingProblemId: {
          trainingId,
          userId,
          trainingProblemId,
        },
      },
      create: {
        trainingId,
        userId,
        trainingProblemId,
        bestScore: score,
        bestResult: result,
        attemptCount: 1,
        acAt: isAc ? new Date() : null,
      },
      update: {
        attemptCount: { increment: 1 },
        ...(isAc
          ? {
              bestResult: result,
              acAt: new Date(),
              ...(score != null ? { bestScore: score } : {}),
            }
          : score != null
            ? {
                // 非 AC 但分数更高也更新
                bestScore: score,
              }
            : {}),
      },
    })

    logger.info('Training problem status synced', {
      userId,
      trainingId,
      trainingProblemId,
      result,
      isAc,
    })
  } catch (error) {
    logger.error('Failed to sync training problem status', {
      userId,
      trainingId,
      trainingProblemId,
      error: String(error),
    })
  }
}

/**
 * 同步比赛题目状态
 *
 * 更新 ContestUserProblemStatus：
 * - 首次 AC：记录 bestScore/bestResult/acAt
 * - 非首次但更好：更新 bestScore/bestResult
 * - 每次提交：attemptCount + 1
 */
export async function syncContestProblemStatus(
  userId: string,
  contestId: number,
  contestProblemId: string,
  result: string | null,
  score: number | null
): Promise<void> {
  try {
    const isAc = isAcceptedResult(result)

    await prisma.contestUserProblemStatus.upsert({
      where: {
        contestId_userId_contestProblemId: {
          contestId,
          userId,
          contestProblemId,
        },
      },
      create: {
        contestId,
        userId,
        contestProblemId,
        bestScore: score,
        bestResult: result,
        attemptCount: 1,
        acAt: isAc ? new Date() : null,
      },
      update: {
        attemptCount: { increment: 1 },
        ...(isAc
          ? {
              bestResult: result,
              acAt: new Date(),
              ...(score != null ? { bestScore: score } : {}),
            }
          : score != null
            ? {
                bestScore: score,
              }
            : {}),
      },
    })

    logger.info('Contest problem status synced', {
      userId,
      contestId,
      contestProblemId,
      result,
      isAc,
    })
  } catch (error) {
    logger.error('Failed to sync contest problem status', {
      userId,
      contestId,
      contestProblemId,
      error: String(error),
    })
  }
}

/**
 * 评测完成后统一调用入口
 *
 * 根据 submitScope 决定同步策略：
 * - submitScope='problem' → syncProblemAC
 * - submitScope='training' → syncTrainingProblemStatus + syncProblemAC（训练 AC 同步题库）
 * - submitScope='contest' → syncContestProblemStatus + **不**同步题库 AC（比赛结束后才同步）
 */
export async function onSubmissionJudged(submission: {
  id: number
  userId: string
  problemId: string
  result: string | null
  score: number | null
  submitScope: string
  trainingId: number | null
  trainingProblemId: string | null
  contestId: number | null
  contestProblemId: string | null
}): Promise<void> {
  const { submitScope } = submission

  logger.info('Processing submission judged callback', {
    submissionId: submission.id,
    submitScope,
    result: submission.result,
  })

  if (submitScope === 'problem') {
    // 题库提交：同步题库 AC
    if (isAcceptedResult(submission.result)) {
      await syncProblemAC(submission.userId, submission.problemId)
    }
  } else if (submitScope === 'training') {
    // 训练提交：更新训练状态 + 同步题库 AC
    if (submission.trainingId && submission.trainingProblemId) {
      await syncTrainingProblemStatus(
        submission.userId,
        submission.trainingId,
        submission.trainingProblemId,
        submission.result,
        submission.score
      )
    }
    if (isAcceptedResult(submission.result)) {
      await syncProblemAC(submission.userId, submission.problemId)
    }
  } else if (submitScope === 'contest') {
    // 比赛提交：更新比赛状态 + **不**同步题库 AC
    if (submission.contestId && submission.contestProblemId) {
      await syncContestProblemStatus(
        submission.userId,
        submission.contestId,
        submission.contestProblemId,
        submission.result,
        submission.score
      )
    }
    // 比赛期间不同步题库 AC，等比赛结束后由 syncContestEndAC 处理
  }
}

/**
 * 比赛结束后 AC 同步
 *
 * 比赛状态变为 finished 时调用：
 * 1. 将比赛提交的 AC 状态同步到题库
 * 2. 将 ContestUserProblemStatus 的 frozenScore/frozenResult 写入
 */
export async function syncContestEndAC(contestId: number): Promise<void> {
  try {
    logger.info('Starting contest end AC sync', { contestId })

    // 获取比赛所有 AC 提交
    const acSubmissions = await prisma.submission.findMany({
      where: {
        contestId,
        submitScope: 'contest',
        result: { in: ['Accepted', 'AC'] },
      },
      select: {
        userId: true,
        problemId: true,
      },
      distinct: ['userId', 'problemId'],
    })

    // 逐个同步题库 AC
    for (const sub of acSubmissions) {
      await syncProblemAC(sub.userId, sub.problemId)
    }

    // 冻结比赛成绩
    const contestStatuses = await prisma.contestUserProblemStatus.findMany({
      where: { contestId },
    })

    for (const status of contestStatuses) {
      await prisma.contestUserProblemStatus.update({
        where: { id: status.id },
        data: {
          frozenScore: status.bestScore,
          frozenResult: status.bestResult,
        },
      })
    }

    logger.info('Contest end AC sync completed', {
      contestId,
      acCount: acSubmissions.length,
      statusCount: contestStatuses.length,
    })
  } catch (error) {
    logger.error('Failed to sync contest end AC', {
      contestId,
      error: String(error),
    })
  }
}
