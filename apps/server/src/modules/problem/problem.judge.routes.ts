import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import {
  deleteProblemChecker,
  getProblemCheckerDownload,
  getProblemJudgeConfig,
  listProblemCheckers,
  ProblemJudgeRouteError,
  saveProblemJudgeConfig,
  uploadProblemChecker,
} from './application/problem-judge-route.service'
import {
  cleanupProblemCheckerTemporaryFile,
  problemCheckerUpload,
} from './infrastructure/problem-checker-storage'

export const problemJudgeRouter = Router()

function sendJudgeError(error: unknown, res: any) {
  if (!(error instanceof ProblemJudgeRouteError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
    ...(error.data !== undefined ? { data: error.data } : {}),
  })
}

problemJudgeRouter.get('/:id/checker', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await listProblemCheckers(req.user!, req.params.id)
    return res.json({ success: true, data })
  } catch (error) {
    return sendJudgeError(error, res)
  }
}))

problemJudgeRouter.get('/:id/checker/:fileName/download', authenticate, asyncHandler(async (req, res) => {
  try {
    const file = await getProblemCheckerDownload(req.user!, req.params.id, req.params.fileName)
    return res.download(file.path, file.fileName)
  } catch (error) {
    return sendJudgeError(error, res)
  }
}))

problemJudgeRouter.post('/:id/checker', authenticate, problemCheckerUpload.single('file'), asyncHandler(async (req, res) => {
  try {
    const data = await uploadProblemChecker({
      user: req.user!,
      problemId: req.params.id,
      file: req.file,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendJudgeError(error, res)
  } finally {
    cleanupProblemCheckerTemporaryFile(req.file)
  }
}))

problemJudgeRouter.delete('/:id/checker/:checkerId', authenticate, asyncHandler(async (req, res) => {
  try {
    await deleteProblemChecker(req.user!, req.params.id, req.params.checkerId)
    return res.json({ success: true })
  } catch (error) {
    return sendJudgeError(error, res)
  }
}))

problemJudgeRouter.get('/:id/judge-config', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getProblemJudgeConfig(req.user!, req.params.id)
    return res.json({ success: true, data })
  } catch (error) {
    return sendJudgeError(error, res)
  }
}))

problemJudgeRouter.put('/:id/judge-config', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await saveProblemJudgeConfig({
      user: req.user!,
      problemId: req.params.id,
      body: req.body,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendJudgeError(error, res)
  }
}))
