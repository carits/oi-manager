import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import {
  formatProblemStatement,
  getProblemAiUsage,
  ProblemAiRouteError,
  translateProblemStatement,
} from './application/problem-ai-route.service'
import { AiValidatorError, generateAiValidator, getAiValidatorRequest, saveAiValidator } from './application/problem-ai-validator.service'
import { AiTokenError } from '../ai/ai-token.service'

export const problemAiRouter = Router()

function sendAiError(error: unknown, res: any) {
  if (error instanceof AiValidatorError || error instanceof AiTokenError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
  if (!(error instanceof ProblemAiRouteError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
  })
}

problemAiRouter.post('/:id/ai/validator', authenticate, asyncHandler(async (req, res) => {
  try { res.status(201).json({ success: true, data: await generateAiValidator({ user: req.user!, problemId: req.params.id, statementId: req.body?.statementId }) }) }
  catch (error) { return sendAiError(error, res) }
}, 'Validator 生成失败'))

problemAiRouter.get('/:id/ai/validator/:requestId', authenticate, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await getAiValidatorRequest(req.user!, req.params.id, req.params.requestId) }) }
  catch (error) { return sendAiError(error, res) }
}))

problemAiRouter.post('/:id/ai/validator/:requestId/repair', authenticate, asyncHandler(async (req, res) => {
  try { res.status(201).json({ success: true, data: await generateAiValidator({ user: req.user!, problemId: req.params.id, parentRequestId: req.params.requestId }) }) }
  catch (error) { return sendAiError(error, res) }
}, 'Validator 修复失败'))

problemAiRouter.post('/:id/ai/validator/:requestId/save', authenticate, asyncHandler(async (req, res) => {
  try { res.status(201).json({ success: true, data: await saveAiValidator({ user: req.user!, problemId: req.params.id, requestId: req.params.requestId, programId: req.body?.programId, name: req.body?.name }) }) }
  catch (error) { return sendAiError(error, res) }
}, 'Validator 保存失败'))

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
