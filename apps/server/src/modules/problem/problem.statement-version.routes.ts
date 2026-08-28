import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import {
  createProblemStatementVersion,
  deleteProblemStatementVersion,
  downloadProblemStatementVersion,
  getProblemStatementVersion,
  listProblemStatementVersions,
  ProblemStatementVersionRouteError,
  replaceProblemStatementPdf,
  updateProblemStatementMarkdown,
  updateProblemStatementMetadata,
} from './application/problem-statement-version-route.service'
import {
  cleanupProblemContentTemporaryFile,
  problemContentPdfUpload,
} from './infrastructure/problem-content-upload'

export const problemStatementVersionRouter = Router()

function sendStatementVersionError(error: unknown, res: any) {
  if (!(error instanceof ProblemStatementVersionRouteError)) throw error
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

problemStatementVersionRouter.get('/:id/statement-versions', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await listProblemStatementVersions({
      user: req.user!,
      problemId: req.params.id,
      pageValue: req.query.page,
      pageSizeValue: req.query.pageSize,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendStatementVersionError(error, res)
  }
}))

problemStatementVersionRouter.get('/:id/statement-versions/:versionId', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getProblemStatementVersion(
      req.user!,
      req.params.id,
      req.params.versionId,
    )
    return res.json({ success: true, data })
  } catch (error) {
    return sendStatementVersionError(error, res)
  }
}))

problemStatementVersionRouter.post('/:id/statement-versions', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await createProblemStatementVersion({
      user: req.user!,
      problemId: req.params.id,
      body: req.body,
    })
    return res.status(201).json({ success: true, data })
  } catch (error) {
    return sendStatementVersionError(error, res)
  }
}))

problemStatementVersionRouter.put('/:id/statement-versions/:versionId/content', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await updateProblemStatementMarkdown({
      user: req.user!,
      problemId: req.params.id,
      versionId: req.params.versionId,
      content: String(req.body?.content || ''),
      title: req.body?.title,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendStatementVersionError(error, res)
  }
}))

problemStatementVersionRouter.patch('/:id/statement-versions/:versionId', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await updateProblemStatementMetadata({
      user: req.user!,
      problemId: req.params.id,
      versionId: req.params.versionId,
      body: req.body,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendStatementVersionError(error, res)
  }
}))

problemStatementVersionRouter.post('/:id/statement-versions/:versionId/pdf', authenticate, problemContentPdfUpload.single('file'), asyncHandler(async (req, res) => {
  try {
    const data = await replaceProblemStatementPdf({
      user: req.user!,
      problemId: req.params.id,
      versionId: req.params.versionId,
      title: req.body?.title,
      file: req.file,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendStatementVersionError(error, res)
  } finally {
    cleanupProblemContentTemporaryFile(req.file)
  }
}))

problemStatementVersionRouter.get('/:id/statement-versions/:versionId/file', authenticate, asyncHandler(async (req, res) => {
  try {
    const file = await downloadProblemStatementVersion({
      user: req.user!,
      problemId: req.params.id,
      versionId: req.params.versionId,
    })
    return sendInlineFile(res, file)
  } catch (error) {
    return sendStatementVersionError(error, res)
  }
}))

problemStatementVersionRouter.delete('/:id/statement-versions/:versionId', authenticate, asyncHandler(async (req, res) => {
  try {
    await deleteProblemStatementVersion({
      user: req.user!,
      problemId: req.params.id,
      versionId: req.params.versionId,
    })
    return res.json({ success: true })
  } catch (error) {
    return sendStatementVersionError(error, res)
  }
}))
