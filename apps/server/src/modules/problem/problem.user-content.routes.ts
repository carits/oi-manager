import { Router } from 'express'
import { ProblemContracts } from '@oi-manager/contracts'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import {
  deleteMyProblemContent,
  getMyProblemContent,
  getProblemContentOptions,
  parseUserContentKind,
  ProblemUserContentRouteError,
  saveProblemMarkdownContent,
  saveProblemPdfContent,
  updateProblemContentVisibility,
} from './application/problem-user-content-route.service'
import {
  cleanupProblemContentTemporaryFile,
  problemContentPdfUpload,
} from './infrastructure/problem-content-upload'

export const problemUserContentRouter = Router()

function sendUserContentError(error: unknown, res: any) {
  if (sendContractError(error, res)) return
  if (!(error instanceof ProblemUserContentRouteError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
  })
}

problemUserContentRouter.get('/:id/my-content', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getMyProblemContent(req.user!, req.params.id)
    return sendContractData(res, ProblemContracts.getMyContent, data)
  } catch (error) {
    return sendUserContentError(error, res)
  }
}))

problemUserContentRouter.get('/:id/content-options', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getProblemContentOptions(req.user!, req.params.id)
    return res.json({ success: true, data })
  } catch (error) {
    return sendUserContentError(error, res)
  }
}))

problemUserContentRouter.put('/:id/my-content/:kind', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.saveMyContent, req.body)
    const data = await saveProblemMarkdownContent({
      user: req.user!,
      problemId: req.params.id,
      kind: parseUserContentKind(req.params.kind),
      title: body.title,
      language: body.language,
      content: body.content,
    })
    return sendContractData(res, ProblemContracts.saveMyContent, data)
  } catch (error) {
    return sendUserContentError(error, res)
  }
}))

problemUserContentRouter.post('/:id/my-content/:kind/pdf', authenticate, problemContentPdfUpload.single('file'), asyncHandler(async (req, res) => {
  try {
    const data = await saveProblemPdfContent({
      user: req.user!,
      problemId: req.params.id,
      kind: parseUserContentKind(req.params.kind),
      title: req.body?.title,
      language: req.body?.language,
      file: req.file,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendUserContentError(error, res)
  } finally {
    cleanupProblemContentTemporaryFile(req.file)
  }
}))

problemUserContentRouter.put('/:id/my-content/:kind/shares', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.updateMyContentShares, req.body)
    await updateProblemContentVisibility({
      user: req.user!,
      problemId: req.params.id,
      kind: parseUserContentKind(req.params.kind),
      shareKeys: body.shareKeys,
    })
    return sendContractData(res, ProblemContracts.updateMyContentShares, {})
  } catch (error) {
    return sendUserContentError(error, res)
  }
}))

problemUserContentRouter.delete('/:id/my-content/:kind', authenticate, asyncHandler(async (req, res) => {
  try {
    await deleteMyProblemContent({
      user: req.user!,
      problemId: req.params.id,
      kind: parseUserContentKind(req.params.kind),
    })
    return sendContractData(res, ProblemContracts.deleteMyContent, {})
  } catch (error) {
    return sendUserContentError(error, res)
  }
}))
