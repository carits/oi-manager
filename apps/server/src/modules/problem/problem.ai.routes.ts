import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import {
  formatProblemStatement,
  getProblemAiUsage,
  ProblemAiRouteError,
  translateProblemStatement,
} from './application/problem-ai-route.service'

export const problemAiRouter = Router()

function sendAiError(error: unknown, res: any) {
  if (!(error instanceof ProblemAiRouteError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
  })
}

problemAiRouter.post('/:id/ai/translate', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await translateProblemStatement({
      user: req.user!,
      problemId: req.params.id,
      targetLang: req.body?.targetLang,
      statementId: req.body?.statementId,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendAiError(error, res)
  }
}, '翻译失败'))

problemAiRouter.post('/:id/ai/format', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await formatProblemStatement({
      user: req.user!,
      problemId: req.params.id,
      statementId: req.body?.statementId,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendAiError(error, res)
  }
}, '格式化失败'))

problemAiRouter.get('/:id/ai/usage', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getProblemAiUsage(req.user!, req.params.id)
    return res.json({ success: true, data })
  } catch (error) {
    return sendAiError(error, res)
  }
}))
