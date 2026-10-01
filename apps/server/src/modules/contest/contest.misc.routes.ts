/**
 * Contest overview, solution, attachment and managed-file HTTP adapter.
 */

import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { contestRoutePublicId } from './contest.helpers'
import {
  downloadContestProblemFile,
  getContestAttachments,
  getContestOverview,
  getContestProblemAttachments,
  getContestProblemSolution,
  getContestSolutions,
  ContestMiscError,
} from './application/contest-misc.service'

export const contestMiscRouter = Router()

function sendContestMiscError(error: unknown, res: any) {
  if (!(error instanceof ContestMiscError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
  })
}

contestMiscRouter.get('/contests/:id/overview', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await getContestOverview(contestRoutePublicId(req), req.user!.userId)
    return res.json({ success: true, data })
  } catch (error) {
    return sendContestMiscError(error, res)
  }
}, '获取训练概览失败'))

contestMiscRouter.get('/contests/:id/solutions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await getContestSolutions(contestRoutePublicId(req), req.user!.userId)
    return res.json({ success: true, data })
  } catch (error) {
    return sendContestMiscError(error, res)
  }
}, '查询题解失败'))

contestMiscRouter.get('/contests/:id/attachments', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await getContestAttachments(contestRoutePublicId(req), req.user!.userId)
    return res.json({ success: true, data })
  } catch (error) {
    return sendContestMiscError(error, res)
  }
}, '查询附件失败'))

contestMiscRouter.get('/contests/:id/problems/:problemId/solution', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await getContestProblemSolution(
      contestRoutePublicId(req),
      req.params.problemId,
      req.user!.userId,
    )
    return res.json({ success: true, data: result.data, ...(result.message ? { message: result.message } : {}) })
  } catch (error) {
    return sendContestMiscError(error, res)
  }
}, '查询失败'))

contestMiscRouter.get('/contests/:id/problems/:problemId/attachments', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await getContestProblemAttachments(
      contestRoutePublicId(req),
      req.params.problemId,
      req.user!.userId,
    )
    return res.json({ success: true, data })
  } catch (error) {
    return sendContestMiscError(error, res)
  }
}, '查询失败'))

contestMiscRouter.get('/contests/:id/problems/:problemId/files/:fileId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const file = await downloadContestProblemFile({
      contestId: contestRoutePublicId(req),
      contestProblemId: req.params.problemId,
      fileId: req.params.fileId,
      userId: req.user!.userId,
    })
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Content-Disposition', `${file.disposition}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`)
    res.setHeader('Content-Length', file.buffer.length)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.send(file.buffer)
  } catch (error) {
    return sendContestMiscError(error, res)
  }
}, '下载训练题目资源失败'))
