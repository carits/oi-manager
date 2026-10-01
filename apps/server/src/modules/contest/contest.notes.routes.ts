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
import { getContestProblemNote, saveContestProblemNote } from './application/contest-user-content.service'

export const contestNotesRouter = Router()

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

contestNotesRouter.get('/contests/:id/problems/:problemId/note', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const ctx = await context(req, res)
  if (!ctx) return
  const note = await getContestProblemNote(ctx.contestId, req.params.problemId, ctx.userId, ctx.userType)
  if (!note) return res.status(404).json({ success: false, message: '题目不存在' })
  res.json({ success: true, data: note })
}, '查询失败'))

contestNotesRouter.put('/contests/:id/problems/:problemId/note', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const ctx = await context(req, res)
  if (!ctx) return
  const note = await saveContestProblemNote(
    ctx.contestId, req.params.problemId, ctx.userId, ctx.userType, req.body?.content,
  )
  if (!note) return res.status(404).json({ success: false, message: '题目不存在' })
  res.json({ success: true, data: note })
}, '保存失败'))
