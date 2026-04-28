/**
 * Training Note Routes
 * 训练笔记管理路由
 */

import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import {
  isTeamMember,
  parseTrainingId,
  getUserTypeForTeam,
  requireTrainingStarted,
} from './training.helpers'

export const trainingNotesRouter = Router()

/**
 * GET /api/trainings/:id/problems/:problemId/note
 */
trainingNotesRouter.get('/trainings/:id/problems/:problemId/note', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId, training.teamId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const trainingProblem = await prisma.trainingProblem.findUnique({ where: { id: problemId } })
    if (!trainingProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    const userType = await getUserTypeForTeam(userId)

    // 复用 ProblemNote
    const note = await prisma.problemNote.findUnique({
      where: {
        problemId_userId_userType: {
          problemId: trainingProblem.problemId,
          userId,
          userType,
        },
      },
    })

    res.json({ success: true, data: note || { content: '' } })
}, '查询失败'))

/**
 * PUT /api/trainings/:id/problems/:problemId/note
 */
trainingNotesRouter.put('/trainings/:id/problems/:problemId/note', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId
    const { content } = req.body

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await isTeamMember(userId, training.teamId)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId, training.teamId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const trainingProblem = await prisma.trainingProblem.findUnique({ where: { id: problemId } })
    if (!trainingProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    const userType = await getUserTypeForTeam(userId)

    const note = await prisma.problemNote.upsert({
      where: {
        problemId_userId_userType: {
          problemId: trainingProblem.problemId,
          userId,
          userType,
        },
      },
      create: {
        problemId: trainingProblem.problemId,
        userId,
        userType,
        content: content || '',
      },
      update: {
        content: content || '',
      },
    })

    res.json({ success: true, data: note })
}, '保存失败'))