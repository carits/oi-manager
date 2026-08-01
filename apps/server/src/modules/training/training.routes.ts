/**
 * Training Module - Routes Layer
 * 训练模块路由层（子路由挂载）
 *
 * 权限规则：
 * - 团队管理员 (owner/admin)：可创建、编辑、删除训练，管理题目/题解/附件
 * - 团队成员：可查看训练、提交代码、查看排名
 * - 排名只统计学生成员（非管理员角色）
 */

import { Router } from 'express'
import { authenticate, getResourceScope } from '../../middleware/auth'
import { prisma } from '../../prisma'
import { trainingCrudRouter } from './training.crud.routes'
import { trainingProblemsRouter } from './training.problems.routes'
import { trainingNotesRouter } from './training.notes.routes'
import { trainingSubmissionsRouter } from './training.submissions.routes'
import { trainingRankingRouter } from './training.ranking.routes'
import { trainingMiscRouter } from './training.misc.routes'
import { trainingRecordRouter } from './training.record.routes'

export const trainingsRouter = Router()

// Every training detail endpoint passes through this scope boundary first.
trainingsRouter.use('/trainings/:id', authenticate, async (req, res, next) => {
  const id = Number.parseInt(req.params.id, 10)
  if (!Number.isFinite(id) || !req.user) return next()

  const training = await prisma.training.findUnique({ where: { id }, select: { scope: true } })
  if (!training || training.scope !== getResourceScope(req.user)) {
    return res.status(404).json({ success: false, message: '训练不存在' })
  }
  next()
})

trainingsRouter.use(trainingCrudRouter)
trainingsRouter.use(trainingProblemsRouter)
trainingsRouter.use(trainingNotesRouter)
trainingsRouter.use(trainingRecordRouter)
trainingsRouter.use(trainingSubmissionsRouter)
trainingsRouter.use(trainingRankingRouter)
trainingsRouter.use(trainingMiscRouter)
