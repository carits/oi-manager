/**
 * Training ranking HTTP adapter.
 */

import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { parseTrainingId } from './training.helpers'
import {
  getTrainingRanking,
  TrainingRankingError,
} from './application/training-ranking.service'

export const trainingRankingRouter = Router()

function sendRankingError(error: unknown, res: any) {
  if (!(error instanceof TrainingRankingError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
  })
}

trainingRankingRouter.get('/trainings/:id/ranking', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await getTrainingRanking(parseTrainingId(req.params.id), req.user!.userId)
    return res.json({ success: true, data })
  } catch (error) {
    return sendRankingError(error, res)
  }
}, '查询失败'))
