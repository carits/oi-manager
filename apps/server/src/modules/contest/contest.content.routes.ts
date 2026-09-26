import { Router } from 'express'
import { ContestContracts, ProblemContracts } from '@oi-manager/contracts'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import { parseContestId } from './contest.helpers'
import {
  downloadContestContentOption,
  downloadContestContentFile,
  editContestContentMarkdown,
  getContestContentOptions,
  getContestMyContent,
  parseContentKind,
  previewContestContentOption,
  replaceContestContentPdf,
  ContestContentError,
  updateContestContentSelection,
} from './application/contest-content-management.service'
import {
  cleanupContestContentTemporaryFile,
  contestContentPdfUpload,
} from './infrastructure/contest-content-upload'

export const contestContentRouter = Router()

function sendContentError(error: unknown, res: any) {
  if (sendContractError(error, res)) return
  if (!(error instanceof ContestContentError)) throw error
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

contestContentRouter.get('/contests/:id/problems/:contestProblemId/my-content', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getContestMyContent(
      parseContestId(req.params.id),
      req.params.contestProblemId,
      req.user!.userId,
    )
    return sendContractData(res, ProblemContracts.getMyContent, data)
  } catch (error) {
    return sendContentError(error, res)
  }
}))

contestContentRouter.put('/contests/:id/problems/:contestProblemId/content/:kind', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ContestContracts.updateContentMarkdown, req.body)
    const data = await editContestContentMarkdown({
      contestId: parseContestId(req.params.id),
      contestProblemId: req.params.contestProblemId,
      userId: req.user!.userId,
      kind: parseContentKind(req.params.kind),
      content: body.content,
    })
    return sendContractData(res, ContestContracts.updateContentMarkdown, data)
  } catch (error) {
    return sendContentError(error, res)
  }
}))

contestContentRouter.post('/contests/:id/problems/:contestProblemId/content/:kind/pdf', authenticate, contestContentPdfUpload.single('file'), asyncHandler(async (req, res) => {
  try {
    const data = await replaceContestContentPdf({
      contestId: parseContestId(req.params.id),
      contestProblemId: req.params.contestProblemId,
      userId: req.user!.userId,
      kind: parseContentKind(req.params.kind),
      file: req.file,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendContentError(error, res)
  } finally {
    cleanupContestContentTemporaryFile(req.file)
  }
}))

contestContentRouter.get('/contests/:id/problems/:contestProblemId/content-options', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getContestContentOptions(
      parseContestId(req.params.id),
      req.params.contestProblemId,
      req.user!.userId,
    )
    return sendContractData(res, ContestContracts.contentOptions, data)
  } catch (error) {
    return sendContentError(error, res)
  }
}))

contestContentRouter.get('/contests/:id/problems/:contestProblemId/content-options/:optionKey/preview', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await previewContestContentOption(
      parseContestId(req.params.id),
      req.params.contestProblemId,
      req.user!.userId,
      req.params.optionKey,
    )
    return sendContractData(res, ContestContracts.contentPreview, {
      ...data,
      fileUrl: data.hasFile
        ? `/api/contests/${req.params.id}/problems/${req.params.contestProblemId}/content-options/${encodeURIComponent(data.key)}/file`
        : null,
    })
  } catch (error) {
    return sendContentError(error, res)
  }
}))

contestContentRouter.get('/contests/:id/problems/:contestProblemId/content-options/:optionKey/file', authenticate, asyncHandler(async (req, res) => {
  try {
    const file = await downloadContestContentOption(
      parseContestId(req.params.id),
      req.params.contestProblemId,
      req.user!.userId,
      req.params.optionKey,
    )
    return sendInlineFile(res, file)
  } catch (error) {
    return sendContentError(error, res)
  }
}))

contestContentRouter.put('/contests/:id/problems/:contestProblemId/content-selection', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ContestContracts.updateContentSelection, req.body)
    const data = await updateContestContentSelection({
      contestId: parseContestId(req.params.id),
      contestProblemId: req.params.contestProblemId,
      userId: req.user!.userId,
      statementOptionKey: body.statementOptionKey,
      solutionOptionKey: body.solutionOptionKey,
    })
    return sendContractData(res, ContestContracts.updateContentSelection, data)
  } catch (error) {
    return sendContentError(error, res)
  }
}))

contestContentRouter.get('/contests/:id/problems/:contestProblemId/content/:kind/file', authenticate, asyncHandler(async (req, res) => {
  try {
    const file = await downloadContestContentFile({
      contestId: parseContestId(req.params.id),
      contestProblemId: req.params.contestProblemId,
      userId: req.user!.userId,
      kind: parseContentKind(req.params.kind),
    })
    return sendInlineFile(res, file)
  } catch (error) {
    return sendContentError(error, res)
  }
}))
