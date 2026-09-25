import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { authenticate } from '../../middleware/auth'
import { parseContestId } from './contest.helpers'
import {
  previewContestTestSetUpdate,
  ContestTestSetUpdateError,
  updateContestTestSetRevision,
} from './application/contest-testset-update.service'

export const contestHackSyncRouter = Router()

function sendTestSetUpdateError(error: unknown, res: any) {
  if (!(error instanceof ContestTestSetUpdateError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
    ...(error.data !== undefined ? { data: error.data } : {}),
  })
}

contestHackSyncRouter.get('/contests/:id/problems/:contestProblemId/test-set-update', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await previewContestTestSetUpdate(
      parseContestId(req.params.id),
      req.params.contestProblemId,
      req.user!.userId,
    )
    return res.json({ success: true, data })
  } catch (error) {
    return sendTestSetUpdateError(error, res)
  }
}))

contestHackSyncRouter.post('/contests/:id/problems/:contestProblemId/test-set-update', authenticate, asyncHandler(async (req, res) => {
  try {
    const result = await updateContestTestSetRevision({
      contestId: parseContestId(req.params.id),
      contestProblemId: req.params.contestProblemId,
      userId: req.user!.userId,
      revisionId: typeof req.body?.revisionId === 'string' ? req.body.revisionId : undefined,
    })
    if (!result.updated) {
      return res.json({ success: true, data: { updated: false, ...result.state }, message: result.message })
    }
    return res.json({
      success: true,
      data: {
        updated: true,
        previousRevisionId: result.previousRevisionId,
        currentRevisionId: result.currentRevisionId,
        currentRevision: result.currentRevision,
      },
      message: result.message,
    })
  } catch (error) {
    return sendTestSetUpdateError(error, res)
  }
}))
