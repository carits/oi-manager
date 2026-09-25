import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContestId } from './contest.helpers'
import {
  downloadContestStatementVersion,
  getContestStatementManagement,
  getContestStatementVersions,
  saveContestStatementManagement,
  ContestStatementManagementError,
} from './application/contest-statement-management.service'

export const contestStatementManagementRouter = Router()

function sendStatementError(error: unknown, res: any) {
  if (!(error instanceof ContestStatementManagementError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
  })
}

function sendInlineFile(res: any, file: { mimeType: string; originalName: string; buffer: Buffer }) {
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`)
  return res.send(file.buffer)
}

contestStatementManagementRouter.get('/contests/:id/statement-management', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getContestStatementManagement(
      parseContestId(req.params.id),
      req.user!.userId,
    )
    return res.json({ success: true, data })
  } catch (error) {
    return sendStatementError(error, res)
  }
}))

contestStatementManagementRouter.put('/contests/:id/statement-management', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await saveContestStatementManagement({
      contestId: parseContestId(req.params.id),
      userId: req.user!.userId,
      selections: req.body?.selections,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendStatementError(error, res)
  }
}))

contestStatementManagementRouter.get('/contests/:id/problems/:contestProblemId/statement-versions', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getContestStatementVersions(
      parseContestId(req.params.id),
      req.params.contestProblemId,
      req.user!.userId,
    )
    return res.json({
      success: true,
      data: {
        ...data,
        statements: data.statements.map(statement => ({
          ...statement,
          fileUrl: statement.hasFile
            ? `/api/contests/${req.params.id}/problems/${req.params.contestProblemId}/statement-versions/${statement.id}/file`
            : null,
        })),
      },
    })
  } catch (error) {
    return sendStatementError(error, res)
  }
}))

contestStatementManagementRouter.get('/contests/:id/problems/:contestProblemId/statement-versions/:snapshotId/file', authenticate, asyncHandler(async (req, res) => {
  try {
    const file = await downloadContestStatementVersion({
      contestId: parseContestId(req.params.id),
      contestProblemId: req.params.contestProblemId,
      snapshotId: req.params.snapshotId,
      userId: req.user!.userId,
    })
    return sendInlineFile(res, file)
  } catch (error) {
    return sendStatementError(error, res)
  }
}))
