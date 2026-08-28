import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { authenticate } from '../../middleware/auth'
import { parseTrainingId } from './training.helpers'
import {
  previewTrainingTestSetUpdate,
  TrainingTestSetUpdateError,
  updateTrainingTestSetRevision,
} from './application/training-testset-update.service'

export const trainingHackSyncRouter = Router()

function sendTestSetUpdateError(error: unknown, res: any) {
  if (!(error instanceof TrainingTestSetUpdateError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
    ...(error.data !== undefined ? { data: error.data } : {}),
  })
}

trainingHackSyncRouter.get('/trainings/:id/problems/:trainingProblemId/test-set-update', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await previewTrainingTestSetUpdate(
      parseTrainingId(req.params.id),
      req.params.trainingProblemId,
      req.user!.userId,
    )
    return res.json({ success: true, data })
  } catch (error) {
    return sendTestSetUpdateError(error, res)
  }
}))

trainingHackSyncRouter.post('/trainings/:id/problems/:trainingProblemId/test-set-update', authenticate, asyncHandler(async (req, res) => {
  try {
    const result = await updateTrainingTestSetRevision({
      trainingId: parseTrainingId(req.params.id),
      trainingProblemId: req.params.trainingProblemId,
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

for (const suffix of ['hack-sync-preview', 'hack-sync']) {
  trainingHackSyncRouter.all(`/trainings/:id/problems/:trainingProblemId/${suffix}`, authenticate, (_req, res) => {
    res.status(410).json({
      success: false,
      code: 'HACK_SYNC_RETIRED',
      message: '题库 Hack 不再直接同步活动，请使用测试版本更新接口',
    })
  })
}
