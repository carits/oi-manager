import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import {
  canAccessContest,
  getUserTypeForContest,
  contestRoutePublicId,
  requireContestStarted,
} from './contest.helpers'
import { findContestForProblemAccess } from './application/contest-problem-query.service'
import { getContestRecord, saveContestRecord } from './application/contest-user-content.service'

export const contestRecordRouter = Router()

async function context(req: AuthRequest, res: any) {
  const contestId = contestRoutePublicId(req)
  const userId = req.user!.userId
  const contest = await findContestForProblemAccess(contestId)
  if (!contest) { res.status(404).json({ success: false, message: '训练不存在' }); return null }
  if (!await canAccessContest(userId, contest)) { res.status(403).json({ success: false, message: '无权限' }); return null }
  const notStarted = await requireContestStarted(contest, userId)
  if (notStarted) { res.status(403).json({ success: false, message: notStarted }); return null }
  return { contestId, userId, userType: await getUserTypeForContest(userId, contestId) }
}

contestRecordRouter.get('/contests/:id/record', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const ctx = await context(req, res)
  if (!ctx) return
  res.json({ success: true, data: await getContestRecord(ctx.contestId, ctx.userId, ctx.userType) })
}, '查询失败'))

contestRecordRouter.put('/contests/:id/record', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const ctx = await context(req, res)
  if (!ctx) return
  res.json({ success: true, data: await saveContestRecord(ctx.contestId, ctx.userId, ctx.userType, req.body?.content) })
}, '保存失败'))
