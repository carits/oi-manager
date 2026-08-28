import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseTrainingId } from './training.helpers'
import {
  downloadTrainingContentOption,
  downloadTrainingContentSnapshot,
  editTrainingContentMarkdown,
  getTrainingContentOptions,
  getTrainingMyContent,
  parseContentKind,
  previewTrainingContentOption,
  replaceTrainingContentPdf,
  TrainingContentError,
  updateTrainingContentSelection,
} from './application/training-content-management.service'
import {
  cleanupTrainingContentTemporaryFile,
  trainingContentPdfUpload,
} from './infrastructure/training-content-upload'

export const trainingContentRouter = Router()

function sendContentError(error: unknown, res: any) {
  if (!(error instanceof TrainingContentError)) throw error
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

trainingContentRouter.get('/trainings/:id/problems/:trainingProblemId/my-content', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getTrainingMyContent(
      parseTrainingId(req.params.id),
      req.params.trainingProblemId,
      req.user!.userId,
    )
    return res.json({ success: true, data })
  } catch (error) {
    return sendContentError(error, res)
  }
}))

trainingContentRouter.put('/trainings/:id/problems/:trainingProblemId/content-snapshots/:kind/:snapshotId', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await editTrainingContentMarkdown({
      trainingId: parseTrainingId(req.params.id),
      trainingProblemId: req.params.trainingProblemId,
      userId: req.user!.userId,
      kind: parseContentKind(req.params.kind),
      snapshotId: req.params.snapshotId,
      content: String(req.body?.content || ''),
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendContentError(error, res)
  }
}))

trainingContentRouter.post('/trainings/:id/problems/:trainingProblemId/content-snapshots/:kind/:snapshotId/pdf', authenticate, trainingContentPdfUpload.single('file'), asyncHandler(async (req, res) => {
  try {
    const data = await replaceTrainingContentPdf({
      trainingId: parseTrainingId(req.params.id),
      trainingProblemId: req.params.trainingProblemId,
      userId: req.user!.userId,
      kind: parseContentKind(req.params.kind),
      snapshotId: req.params.snapshotId,
      file: req.file,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendContentError(error, res)
  } finally {
    cleanupTrainingContentTemporaryFile(req.file)
  }
}))

trainingContentRouter.get('/trainings/:id/problems/:trainingProblemId/content-options', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getTrainingContentOptions(
      parseTrainingId(req.params.id),
      req.params.trainingProblemId,
      req.user!.userId,
    )
    return res.json({ success: true, data })
  } catch (error) {
    return sendContentError(error, res)
  }
}))

trainingContentRouter.get('/trainings/:id/problems/:trainingProblemId/content-options/:optionKey/preview', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await previewTrainingContentOption(
      parseTrainingId(req.params.id),
      req.params.trainingProblemId,
      req.user!.userId,
      req.params.optionKey,
    )
    return res.json({
      success: true,
      data: {
        ...data,
        fileUrl: data.hasFile
          ? `/api/trainings/${req.params.id}/problems/${req.params.trainingProblemId}/content-options/${encodeURIComponent(data.key)}/file`
          : null,
      },
    })
  } catch (error) {
    return sendContentError(error, res)
  }
}))

trainingContentRouter.get('/trainings/:id/problems/:trainingProblemId/content-options/:optionKey/file', authenticate, asyncHandler(async (req, res) => {
  try {
    const file = await downloadTrainingContentOption(
      parseTrainingId(req.params.id),
      req.params.trainingProblemId,
      req.user!.userId,
      req.params.optionKey,
    )
    return sendInlineFile(res, file)
  } catch (error) {
    return sendContentError(error, res)
  }
}))

trainingContentRouter.put('/trainings/:id/problems/:trainingProblemId/content-selection', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await updateTrainingContentSelection({
      trainingId: parseTrainingId(req.params.id),
      trainingProblemId: req.params.trainingProblemId,
      userId: req.user!.userId,
      statementOptionKey: String(req.body?.statementOptionKey || ''),
      solutionOptionKey: String(req.body?.solutionOptionKey || 'none'),
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendContentError(error, res)
  }
}))

trainingContentRouter.get('/trainings/:id/problems/:trainingProblemId/content-snapshot/:kind/file', authenticate, asyncHandler(async (req, res) => {
  try {
    const file = await downloadTrainingContentSnapshot({
      trainingId: parseTrainingId(req.params.id),
      trainingProblemId: req.params.trainingProblemId,
      userId: req.user!.userId,
      kind: parseContentKind(req.params.kind),
    })
    return sendInlineFile(res, file)
  } catch (error) {
    return sendContentError(error, res)
  }
}))
