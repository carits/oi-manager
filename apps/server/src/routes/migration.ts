/**
 * Migration: Migrate submission scope fields
 * 将旧字段 submitSource/sourceId 迁移到新字段 submitScope/trainingId/contestId
 */

import { Router } from 'express'
import { prisma } from '../prisma'
import { logger } from '../lib/logger'

export const migrationRouter = Router()

/**
 * POST /api/admin/migrate-submission-scope
 * 迁移提交来源字段
 *
 * 迁移逻辑：
 * 1. 查找 submitSource='training' 或 sourceId LIKE 'training-%' 的旧提交
 * 2. 解析 sourceId 提取 trainingId
 * 3. 设置 submitScope='training'，回填 trainingId，设置 isGlobalVisible=false
 * 4. 判断 Training.type：如果 type='contest'，额外设置 submitScope='contest'，contestId
 * 5. 为已 AC 的提交创建 TrainingUserProblemStatus/ContestUserProblemStatus 记录
 */
migrationRouter.post('/migrate-submission-scope', async (req, res) => {
  try {
    logger.info('migration_submission_scope_started', { action: 'migration' })

    // Step 1: 查找所有需要迁移的提交（submitScope 为 null 或 'problem' 但有旧字段）
    const submissions = await prisma.submission.findMany({
      where: {
        OR: [
          { submitSource: 'training' },
          { sourceId: { startsWith: 'training-' } },
        ],
      },
      select: {
        id: true,
        submitSource: true,
        sourceId: true,
        userId: true,
        problemId: true,
        result: true,
        score: true,
        trainingId: true,
        submitScope: true,
      },
    })

    // 只迁移 submitScope 未设置或仍为 'problem' 的
    const toMigrate = submissions.filter(s => !s.submitScope || s.submitScope === 'problem')

    if (toMigrate.length === 0) {
      return res.json({
        success: true,
        data: { migrated: 0, message: '没有需要迁移的提交' },
      })
    }

    logger.info('migration_submissions_found', {
      action: 'migration',
      metadata: { count: toMigrate.length },
    })

    // Step 2: 获取所有涉及的 trainingId
    const trainingIds = new Set<number>()
    for (const sub of toMigrate) {
      if (sub.trainingId) {
        trainingIds.add(sub.trainingId)
      } else if (sub.sourceId) {
        const match = sub.sourceId.match(/^training-(\d+)$/)
        if (match) {
          trainingIds.add(parseInt(match[1]))
        }
      }
    }

    // Step 3: 获取训练信息（判断 type）
    const trainings = await prisma.training.findMany({
      where: { id: { in: [...trainingIds] } },
      select: { id: true, type: true },
    })
    const trainingTypeMap = new Map(trainings.map(t => [t.id, t.type]))

    // Step 4: 迁移每条提交
    let migrated = 0
    let contestCount = 0
    let trainingCount = 0

    for (const sub of toMigrate) {
      let trainingId: number | null = null

      if (sub.trainingId) {
        trainingId = sub.trainingId
      } else if (sub.sourceId) {
        const match = sub.sourceId.match(/^training-(\d+)$/)
        if (match) {
          trainingId = parseInt(match[1])
        }
      }

      if (!trainingId) continue

      const trainingType = trainingTypeMap.get(trainingId) || 'training'
      const isContest = trainingType === 'contest'

      await prisma.submission.update({
        where: { id: sub.id },
        data: {
          submitScope: isContest ? 'contest' : 'training',
          trainingId,
          contestId: isContest ? trainingId : null,
          isGlobalVisible: false,
        },
      })

      migrated++
      if (isContest) {
        contestCount++
      } else {
        trainingCount++
      }
    }

    logger.info('migration_submission_scope_completed', {
      action: 'migration',
      metadata: { migrated, contestCount, trainingCount },
    })

    res.json({
      success: true,
      data: {
        migrated,
        contestCount,
        trainingCount,
        message: `成功迁移 ${migrated} 条提交（比赛: ${contestCount}, 训练: ${trainingCount}）`,
      },
    })
  } catch (error: any) {
    logger.error('migration_submission_scope_error', {
      action: 'migration',
      metadata: { error: error.message },
    })
    res.status(500).json({ success: false, message: error.message })
  }
})

/**
 * POST /api/admin/migrate-problem-status
 * 为已 AC 的提交创建 TrainingUserProblemStatus/ContestUserProblemStatus 记录
 */
migrationRouter.post('/migrate-problem-status', async (req, res) => {
  try {
    logger.info('migration_problem_status_started', { action: 'migration' })

    // 查找所有已 AC 的训练/比赛提交
    const acSubmissions = await prisma.submission.findMany({
      where: {
        submitScope: { in: ['training', 'contest'] },
        result: { in: ['accepted', 'Accepted', 'AC'] },
        trainingId: { not: null },
      },
      select: {
        id: true,
        userId: true,
        trainingId: true,
        trainingProblemId: true,
        contestId: true,
        contestProblemId: true,
        submitScope: true,
        result: true,
        score: true,
        createdAt: true,
      },
    })

    if (acSubmissions.length === 0) {
      return res.json({
        success: true,
        data: { created: 0, message: '没有需要处理的 AC 提交' },
      })
    }

    let trainingStatusCreated = 0
    let contestStatusCreated = 0

    for (const sub of acSubmissions) {
      if (sub.submitScope === 'training' && sub.trainingId && sub.trainingProblemId) {
        try {
          await prisma.trainingUserProblemStatus.upsert({
            where: {
              trainingId_userId_trainingProblemId: {
                trainingId: sub.trainingId,
                userId: sub.userId,
                trainingProblemId: sub.trainingProblemId,
              },
            },
            create: {
              trainingId: sub.trainingId,
              userId: sub.userId,
              trainingProblemId: sub.trainingProblemId,
              bestScore: sub.score,
              bestResult: sub.result,
              attemptCount: 1,
              acAt: sub.createdAt,
            },
            update: {
              bestResult: sub.result,
              acAt: sub.createdAt,
              ...(sub.score != null ? { bestScore: sub.score } : {}),
            },
          })
          trainingStatusCreated++
        } catch (e) {
          // 忽略重复错误
        }
      } else if (sub.submitScope === 'contest' && sub.contestId && sub.contestProblemId) {
        try {
          await prisma.contestUserProblemStatus.upsert({
            where: {
              contestId_userId_contestProblemId: {
                contestId: sub.contestId,
                userId: sub.userId,
                contestProblemId: sub.contestProblemId,
              },
            },
            create: {
              contestId: sub.contestId,
              userId: sub.userId,
              contestProblemId: sub.contestProblemId,
              bestScore: sub.score,
              bestResult: sub.result,
              attemptCount: 1,
              acAt: sub.createdAt,
            },
            update: {
              bestResult: sub.result,
              acAt: sub.createdAt,
              ...(sub.score != null ? { bestScore: sub.score } : {}),
            },
          })
          contestStatusCreated++
        } catch (e) {
          // 忽略重复错误
        }
      }
    }

    logger.info('migration_problem_status_completed', {
      action: 'migration',
      metadata: { trainingStatusCreated, contestStatusCreated },
    })

    res.json({
      success: true,
      data: {
        trainingStatusCreated,
        contestStatusCreated,
        message: `创建了 ${trainingStatusCreated} 条训练状态记录，${contestStatusCreated} 条比赛状态记录`,
      },
    })
  } catch (error: any) {
    logger.error('migration_problem_status_error', {
      action: 'migration',
      metadata: { error: error.message },
    })
    res.status(500).json({ success: false, message: error.message })
  }
})
