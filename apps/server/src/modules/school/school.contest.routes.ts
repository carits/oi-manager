/**
 * School Contest Routes
 * 校级比赛 CRUD 路由
 */

import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { logger } from '../../lib/logger'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import {
  isSchoolMember,
  isSchoolContestAdmin,
  parseTrainingId,
} from '../training/training.helpers'

export const schoolContestRouter = Router()

/**
 * GET /api/schools/:schoolId/contests
 * 获取校级比赛列表
 */
schoolContestRouter.get('/:schoolId/contests', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const { schoolId } = req.params
  const userId = req.user!.userId
  const typeFilter = req.query.type as string | undefined

  if (!await isSchoolMember(userId, schoolId)) {
    return res.status(403).json({ success: false, message: '无权限查看该校级比赛' })
  }

  const trainings = await prisma.training.findMany({
    where: { schoolId, ...(typeFilter ? { type: typeFilter } : { type: 'contest' }) },
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
 * POST /api/schools/:schoolId/contests
 * 创建校级比赛
 */
schoolContestRouter.post('/:schoolId/contests', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const { schoolId } = req.params
  const userId = req.user!.userId
  const { title, description, format, startTime, endTime, problemIdVisible, solutionVisible, includeAdminInRanking } = req.body

  if (!await isSchoolContestAdmin(userId, schoolId)) {
    return res.status(403).json({ success: false, message: '只有学校负责人或本校教师可以创建校级比赛' })
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
      schoolId,
      teamId: null,
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
      type: 'contest',
      updatedAt: new Date(),
    },
  })

  logger.info('school_contest_created', { action: 'school_contests', metadata: { trainingId: training.id, schoolId } })
  res.json({ success: true, data: training })
}, '创建失败'))

/**
 * PUT /api/schools/:schoolId/contests/:id
 * 更新校级比赛
 */
schoolContestRouter.put('/:schoolId/contests/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const { schoolId } = req.params
  const id = parseTrainingId(req.params.id)
  const userId = req.user!.userId
  const { title, description, format, startTime, endTime, problemIdVisible, solutionVisible, includeAdminInRanking } = req.body

  const training = await prisma.training.findUnique({ where: { id } })
  if (!training) {
    return res.status(404).json({ success: false, message: '比赛不存在' })
  }

  if (training.schoolId !== schoolId) {
    return res.status(403).json({ success: false, message: '该比赛不属于此学校' })
  }

  if (!await isSchoolContestAdmin(userId, schoolId, training.createdBy)) {
    return res.status(403).json({ success: false, message: '只有学校负责人或创建者可以编辑校级比赛' })
  }

  const now = new Date()
  const isStarted = now >= training.startTime

  if (startTime !== undefined && isStarted) {
    return res.status(400).json({ success: false, message: '比赛已经开始，不能修改开始时间' })
  }

  if (!isStarted && startTime && new Date(startTime) <= now) {
    return res.status(400).json({ success: false, message: '开始时间不能早于当前时间' })
  }

  const newStartTime = startTime ? new Date(startTime) : training.startTime
  const newEndTime = endTime ? new Date(endTime) : training.endTime

  if (newEndTime <= newStartTime) {
    return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' })
  }

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

  logger.info('school_contest_updated', { action: 'school_contests', metadata: { trainingId: id, schoolId } })
  res.json({ success: true, data: updated })
}, '更新失败'))

/**
 * DELETE /api/schools/:schoolId/contests/:id
 * 删除校级比赛
 */
schoolContestRouter.delete('/:schoolId/contests/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const { schoolId } = req.params
  const id = parseTrainingId(req.params.id)
  const userId = req.user!.userId

  const training = await prisma.training.findUnique({ where: { id } })
  if (!training) {
    return res.status(404).json({ success: false, message: '比赛不存在' })
  }

  if (training.schoolId !== schoolId) {
    return res.status(403).json({ success: false, message: '该比赛不属于此学校' })
  }

  if (!await isSchoolContestAdmin(userId, schoolId, training.createdBy)) {
    return res.status(403).json({ success: false, message: '只有学校负责人或创建者可以删除校级比赛' })
  }

  await prisma.training.delete({ where: { id } })

  logger.info('school_contest_deleted', { action: 'school_contests', metadata: { trainingId: id, schoolId } })
  res.json({ success: true, message: '删除成功' })
}, '删除失败'))
