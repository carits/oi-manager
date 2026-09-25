/**
 * Contest ranking HTTP adapter.
 */

import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { parseContestId } from './contest.helpers'
import {
  getContestRanking,
  ContestRankingError,
} from './application/contest-ranking.service'

export const contestRankingRouter = Router()

function sendRankingError(error: unknown, res: any) {
  if (!(error instanceof ContestRankingError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
  })
}

contestRankingRouter.get('/contests/:id/ranking', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await getContestRanking(parseContestId(req.params.id), req.user!.userId)
    return res.json({ success: true, data })
  } catch (error) {
    return sendRankingError(error, res)
  }
}, '查询失败'))
