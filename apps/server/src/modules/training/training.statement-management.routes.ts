import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseTrainingId } from './training.helpers'
import {
  downloadTrainingStatementVersion,
  getTrainingStatementManagement,
  getTrainingStatementVersions,
  saveTrainingStatementManagement,
  TrainingStatementManagementError,
} from './application/training-statement-management.service'

export const trainingStatementManagementRouter = Router()

function sendStatementError(error: unknown, res: any) {
  if (!(error instanceof TrainingStatementManagementError)) throw error
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

trainingStatementManagementRouter.get('/trainings/:id/statement-management', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getTrainingStatementManagement(
      parseTrainingId(req.params.id),
      req.user!.userId,
    )
    return res.json({ success: true, data })
  } catch (error) {
    return sendStatementError(error, res)
  }
}))

trainingStatementManagementRouter.put('/trainings/:id/statement-management', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await saveTrainingStatementManagement({
      trainingId: parseTrainingId(req.params.id),
      userId: req.user!.userId,
      selections: req.body?.selections,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendStatementError(error, res)
  }
}))

trainingStatementManagementRouter.get('/trainings/:id/problems/:trainingProblemId/statement-versions', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getTrainingStatementVersions(
      parseTrainingId(req.params.id),
      req.params.trainingProblemId,
      req.user!.userId,
    )
    return res.json({
      success: true,
      data: {
        ...data,
        statements: data.statements.map(statement => ({
          ...statement,
          fileUrl: statement.hasFile
            ? `/api/trainings/${req.params.id}/problems/${req.params.trainingProblemId}/statement-versions/${statement.id}/file`
            : null,
        })),
      },
    })
  } catch (error) {
    return sendStatementError(error, res)
  }
}))

trainingStatementManagementRouter.get('/trainings/:id/problems/:trainingProblemId/statement-versions/:snapshotId/file', authenticate, asyncHandler(async (req, res) => {
  try {
    const file = await downloadTrainingStatementVersion({
      trainingId: parseTrainingId(req.params.id),
      trainingProblemId: req.params.trainingProblemId,
      snapshotId: req.params.snapshotId,
      userId: req.user!.userId,
    })
    return sendInlineFile(res, file)
  } catch (error) {
    return sendStatementError(error, res)
  }
}))
