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
import { getTrainingProblemNote, saveTrainingProblemNote } from './application/training-user-content.service'

export const trainingNotesRouter = Router()

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

trainingNotesRouter.get('/trainings/:id/problems/:problemId/note', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const ctx = await context(req, res)
  if (!ctx) return
  const note = await getTrainingProblemNote(ctx.trainingId, req.params.problemId, ctx.userId, ctx.userType)
  if (!note) return res.status(404).json({ success: false, message: '题目不存在' })
  res.json({ success: true, data: note })
}, '查询失败'))

trainingNotesRouter.put('/trainings/:id/problems/:problemId/note', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const ctx = await context(req, res)
  if (!ctx) return
  const note = await saveTrainingProblemNote(
    ctx.trainingId, req.params.problemId, ctx.userId, ctx.userType, req.body?.content,
  )
  if (!note) return res.status(404).json({ success: false, message: '题目不存在' })
  res.json({ success: true, data: note })
}, '保存失败'))
