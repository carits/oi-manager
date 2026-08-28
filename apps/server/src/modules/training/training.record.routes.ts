import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import {
  canAccessTraining,
  getUserTypeForTeam,
  parseTrainingId,
  requireTrainingStarted,
} from './training.helpers'
import { findTrainingForProblemAccess } from './application/training-problem-query.service'
import { getTrainingRecord, saveTrainingRecord } from './application/training-user-content.service'

export const trainingRecordRouter = Router()

async function context(req: AuthRequest, res: any) {
  const trainingId = parseTrainingId(req.params.id)
  const userId = req.user!.userId
  const training = await findTrainingForProblemAccess(trainingId)
  if (!training) { res.status(404).json({ success: false, message: '训练不存在' }); return null }
  if (!await canAccessTraining(userId, training)) { res.status(403).json({ success: false, message: '无权限' }); return null }
  const notStarted = await requireTrainingStarted(training, userId)
  if (notStarted) { res.status(403).json({ success: false, message: notStarted }); return null }
  return { trainingId, userId, userType: await getUserTypeForTeam(userId) }
}

trainingRecordRouter.get('/trainings/:id/record', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const ctx = await context(req, res)
  if (!ctx) return
  res.json({ success: true, data: await getTrainingRecord(ctx.trainingId, ctx.userId, ctx.userType) })
}, '查询失败'))

trainingRecordRouter.put('/trainings/:id/record', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const ctx = await context(req, res)
  if (!ctx) return
  res.json({ success: true, data: await saveTrainingRecord(ctx.trainingId, ctx.userId, ctx.userType, req.body?.content) })
}, '保存失败'))
