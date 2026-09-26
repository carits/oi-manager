import { Router } from 'express'
import { ContestContracts } from '@oi-manager/contracts'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import { parseContestId } from './contest.helpers'
import {
  downloadContestStatementFile,
  getContestStatementManagement,
  getContestStatements,
  saveContestStatementManagement,
  ContestStatementManagementError,
} from './application/contest-statement-management.service'

export const contestStatementManagementRouter = Router()

function sendStatementError(error: unknown, res: any) {
  if (sendContractError(error, res)) return
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
    return sendContractData(res, ContestContracts.statementManagement, data)
  } catch (error) {
    return sendStatementError(error, res)
  }
}))

contestStatementManagementRouter.put('/contests/:id/statement-management', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ContestContracts.saveStatementManagement, req.body)
    const data = await saveContestStatementManagement({
      contestId: parseContestId(req.params.id),
      userId: req.user!.userId,
      selections: body.selections,
    })
    return sendContractData(res, ContestContracts.saveStatementManagement, data)
  } catch (error) {
    return sendStatementError(error, res)
  }
}))

contestStatementManagementRouter.get('/contests/:id/problems/:contestProblemId/statements', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getContestStatements(
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
            ? `/api/contests/${req.params.id}/problems/${req.params.contestProblemId}/statement/file`
            : null,
        })),
      },
    })
  } catch (error) {
    return sendStatementError(error, res)
  }
}))

contestStatementManagementRouter.get('/contests/:id/problems/:contestProblemId/statement/file', authenticate, asyncHandler(async (req, res) => {
  try {
    const file = await downloadContestStatementFile({
      contestId: parseContestId(req.params.id),
      contestProblemId: req.params.contestProblemId,
      userId: req.user!.userId,
    })
    return sendInlineFile(res, file)
  } catch (error) {
    return sendStatementError(error, res)
  }
}))
