/**
 * Training CRUD Routes
 * 训练模块 CRUD 路由
 */

import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { logger } from '../../lib/logger'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import {
  isTeamMember,
  isTeamAdmin,
  parseTrainingId,
  canAccessTraining,
  canManageTraining,
  getTrainingAccessMode,
} from './training.helpers'

export const trainingCrudRouter = Router()

/**
 * GET /api/teams/:teamId/trainings
 * 获取团队训练列表
 */
trainingCrudRouter.get('/teams/:teamId/trainings', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const { teamId } = req.params
    const userId = req.user!.userId
    const typeFilter = req.query.type as string | undefined

    if (!await isTeamMember(userId, teamId)) {
      return res.status(403).json({ success: false, message: '无权限查看该团队训练' })
    }

    const trainings = await prisma.training.findMany({
      where: { teamId, ...(typeFilter ? { type: typeFilter } : {}) },
      include: {
        _count: { select: { TrainingProblem: true } },
        TrainingProblem: { select: { id: true } },
      },
      orderBy: { startTime: 'desc' },
    })

    const trainingIds = trainings.map(t => t.id)
    const participantCounts = new Map<number, number>()
    if (trainingIds.length > 0) {
      const rows = await prisma.$queryRaw<Array<{ trainingId: number; count: bigint }>>`
        SELECT "trainingId", COUNT(DISTINCT "userId")::int as count
        FROM "Submission"
        WHERE "trainingId" IN (${Prisma.join(trainingIds)})
          AND "submitScope" IN ('training', 'contest')
        GROUP BY "trainingId"
      `
      for (const row of rows) {
        participantCounts.set(Number(row.trainingId), Number(row.count))
      }
    }

    res.json({
      success: true,
      data: trainings.map(t => {
        const now = new Date()
        let computedStatus = t.status
        if (t.status !== 'finished') {
          if (now < t.startTime) computedStatus = 'upcoming'
          else if (now >= t.startTime && now <= t.endTime) computedStatus = 'ongoing'
          else computedStatus = 'finished'
        }
        return {
          id: t.id,
          title: t.title,
          description: t.description,
          format: t.format,
          startTime: t.startTime.toISOString(),
          endTime: t.endTime.toISOString(),
          status: computedStatus,
          createdBy: t.createdBy,
          type: t.type,
          problemCount: t._count.TrainingProblem,
          participantCount: participantCounts.get(t.id) || 0,
          createdAt: t.createdAt.toISOString(),
        }
      }),
    })
}, '查询失败'))

/**
 * POST /api/teams/:teamId/trainings
 * 创建训练
 */
trainingCrudRouter.post('/teams/:teamId/trainings', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const { teamId } = req.params
    const userId = req.user!.userId
    const { title, description, format, startTime, endTime, problemIdVisible, solutionVisible, includeAdminInRanking, type } = req.body

    if (!await isTeamAdmin(userId, teamId)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以创建训练' })
    }

    if (!title || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: '标题、开始时间、结束时间为必填' })
    }

    if (new Date(endTime) <= new Date(startTime)) {
      return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' })
    }

    if (new Date(startTime) <= new Date()) {
      return res.status(400).json({ success: false, message: '开始时间不能早于当前时间' })
    }

    const training = await prisma.training.create({
      data: {
        teamId,
        title,
        description: description || null,
        format: format || 'ioi',
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        status: 'upcoming',
        createdBy: userId,
        problemIdVisible: problemIdVisible ?? false,
        solutionVisible: solutionVisible ?? false,
        includeAdminInRanking: includeAdminInRanking ?? false,
        type: type || 'training',
        updatedAt: new Date(),
      },
    })

    logger.info('training_created', { action: 'trainings', metadata: { trainingId: training.id, teamId } })
    res.json({ success: true, data: training })
}, '创建失败'))

/**
 * GET /api/trainings/:id
 * 获取训练详情
 */
trainingCrudRouter.get('/trainings/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({
      where: { id },
      include: {
        _count: { select: { TrainingParticipant: true, TrainingProblem: true } },
      },
    })

    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限查看该训练' })
    }

    // 计算当前状态
    const now = new Date()
    let computedStatus = training.status
    if (training.status !== 'finished') {
      if (now < training.startTime) computedStatus = 'upcoming'
      else if (now >= training.startTime && now <= training.endTime) computedStatus = 'ongoing'
      else computedStatus = 'finished'

      // 自动更新状态
      if (computedStatus !== training.status) {
        await prisma.training.update({ where: { id }, data: { status: computedStatus } })

        // 比赛结束后，更新所有提交的 isGlobalVisible 为 true
        if (computedStatus === 'finished' && training.type === 'contest') {
          const { count } = await prisma.submission.updateMany({
            where: {
              submitScope: 'contest',
              contestId: id,
              isGlobalVisible: false,
            },
            data: { isGlobalVisible: true },
          })
          logger.info('contest_submissions_visible', {
            action: 'training',
            metadata: { contestId: id, updatedCount: count, message: '比赛结束，提交记录已公开' }
          })
        }
      }
    }

    const isAdmin = await canManageTraining(userId, training)

    res.json({
      success: true,
      data: {
        id: training.id,
        teamId: training.teamId,
        schoolId: training.schoolId,
        title: training.title,
        description: training.description,
        format: training.format,
        startTime: training.startTime.toISOString(),
        endTime: training.endTime.toISOString(),
        status: computedStatus,
        createdBy: training.createdBy,
        problemIdVisible: training.problemIdVisible,
        solutionVisible: training.solutionVisible,
        includeAdminInRanking: training.includeAdminInRanking,
        type: training.type,
        problemCount: training._count.TrainingProblem,
        participantCount: training._count.TrainingParticipant,
        isAdmin,
        createdAt: training.createdAt.toISOString(),
      },
    })
}, '查询失败'))

/**
 * PUT /api/trainings/:id
 * 更新训练信息
 */
trainingCrudRouter.put('/trainings/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { title, description, format, startTime, endTime, problemIdVisible, solutionVisible, includeAdminInRanking } = req.body

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '只有管理员可以编辑训练' })
    }

    const now = new Date()
    const isStarted = now >= training.startTime

    // 已开始的训练不能修改开始时间
    // 前端只在用户实际修改了开始时间时才发送 startTime 字段
    // 如果 startTime 未发送（undefined），说明用户没改，直接跳过
    if (startTime !== undefined && isStarted) {
      return res.status(400).json({ success: false, message: '训练已经开始，不能修改开始时间' })
    }

    // 未开始训练修改开始时间，新时间不能在过去
    if (!isStarted && startTime && new Date(startTime) <= now) {
      return res.status(400).json({ success: false, message: '开始时间不能早于当前时间' })
    }

    const newStartTime = startTime ? new Date(startTime) : training.startTime
    const newEndTime = endTime ? new Date(endTime) : training.endTime

    if (newEndTime <= newStartTime) {
      return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' })
    }

    // 结束时间不能早于当前时间
    if (newEndTime <= now) {
      return res.status(400).json({ success: false, message: '结束时间不能早于当前时间' })
    }

    const updated = await prisma.training.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(format !== undefined && { format }),
        ...(startTime !== undefined && { startTime: newStartTime }),
        ...(endTime !== undefined && { endTime: newEndTime }),
        ...(problemIdVisible !== undefined && { problemIdVisible }),
        ...(solutionVisible !== undefined && { solutionVisible }),
        ...(includeAdminInRanking !== undefined && { includeAdminInRanking }),
      },
    })

    logger.info('training_updated', { action: 'trainings', metadata: { trainingId: id } })
    res.json({ success: true, data: updated })
}, '更新失败'))

/**
 * PUT /api/trainings/:id/end-time
 * 单独更新结束时间（ongoing 时使用）
 */
trainingCrudRouter.put('/trainings/:id/end-time', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { endTime } = req.body

    if (!endTime) {
      return res.status(400).json({ success: false, message: '结束时间为必填' })
    }

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '只有管理员可以修改结束时间' })
    }

    const newEndTime = new Date(endTime)
    if (newEndTime <= new Date()) {
      return res.status(400).json({ success: false, message: '结束时间不能早于当前时间' })
    }

    if (newEndTime <= training.startTime) {
      return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' })
    }

    const updated = await prisma.training.update({
      where: { id },
      data: { endTime: newEndTime },
    })

    res.json({ success: true, data: updated })
}, '更新失败'))

/**
 * DELETE /api/trainings/:id
 * 删除训练
 */
trainingCrudRouter.delete('/trainings/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    // 只有创建者或管理员可删除
    const isCreator = training.createdBy === userId
    const isAdmin = await canManageTraining(userId, training)
    if (!isCreator && !isAdmin) {
      return res.status(403).json({ success: false, message: '只有创建者或管理员可以删除训练' })
    }

    await prisma.training.delete({ where: { id } })

    logger.info('training_deleted', { action: 'trainings', metadata: { trainingId: id } })
    res.json({ success: true, message: '删除成功' })
}, '删除失败'))