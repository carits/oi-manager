/**
 * Training Record Routes
 * 比赛记录管理路由（比赛级别，一个比赛一条记录）
 */

import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import {
  canAccessTraining,
  parseTrainingId,
  getUserTypeForTeam,
  requireTrainingStarted,
} from './training.helpers'

export const trainingRecordRouter = Router()

/**
 * GET /api/trainings/:id/record
 * 获取当前用户的比赛记录
 */
trainingRecordRouter.get('/trainings/:id/record', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = parseTrainingId(req.params.id)
  const userId = req.user!.userId

  const training = await prisma.training.findUnique({ where: { id } })
  if (!training) {
    return res.status(404).json({ success: false, message: '训练不存在' })
  }

  if (!await canAccessTraining(userId, training)) {
    return res.status(403).json({ success: false, message: '无权限' })
  }

  const notStarted = await requireTrainingStarted(training, userId)
  if (notStarted) {
    return res.status(403).json({ success: false, message: notStarted })
  }

  const userType = await getUserTypeForTeam(userId)

  const record = await prisma.contestRecord.findUnique({
    where: {
      trainingId_userId_userType: {
        trainingId: id,
        userId,
        userType,
      },
    },
  })

  res.json({ success: true, data: record || { content: '' } })
}, '查询失败'))

/**
 * PUT /api/trainings/:id/record
 * 保存/更新比赛记录
 */
trainingRecordRouter.put('/trainings/:id/record', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = parseTrainingId(req.params.id)
  const userId = req.user!.userId
  const { content } = req.body

  const training = await prisma.training.findUnique({ where: { id } })
  if (!training) {
    return res.status(404).json({ success: false, message: '训练不存在' })
  }

  if (!await canAccessTraining(userId, training)) {
    return res.status(403).json({ success: false, message: '无权限' })
  }

  const notStarted = await requireTrainingStarted(training, userId)
  if (notStarted) {
    return res.status(403).json({ success: false, message: notStarted })
  }

  const userType = await getUserTypeForTeam(userId)

  const record = await prisma.contestRecord.upsert({
    where: {
      trainingId_userId_userType: {
        trainingId: id,
        userId,
        userType,
      },
    },
    create: {
      id: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      trainingId: id,
      userId,
      userType,
      content: content || '',
    },
    update: {
      content: content || '',
    },
  })

  res.json({ success: true, data: record })
}, '保存失败'))