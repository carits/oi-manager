import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import {
  formatProblemStatement,
  getProblemAiUsage,
  ProblemAiRouteError,
  translateProblemStatement,
} from './application/problem-ai-route.service'
import { AiValidatorError, generateAiValidator, generateAiValidatorSpec, getAiValidatorRequest, saveAiValidator, saveAiValidatorSpec } from './application/problem-ai-validator.service'
import { AiTokenError } from '../ai/ai-token.service'
import { ProblemContracts } from '@oi-manager/contracts'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import { activateValidatorSpec, createValidatorSpec, listValidatorSpecs, materializeValidatorSpec, ValidatorSpecError } from './problem.validator-spec.service'

export const problemAiRouter = Router()

function sendAiError(error: unknown, res: any) {
  if (sendContractError(error, res)) return res
  if (error instanceof ValidatorSpecError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, data: error.data })
  if (error instanceof AiValidatorError || error instanceof AiTokenError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
  if (!(error instanceof ProblemAiRouteError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
  })
}

problemAiRouter.post('/:id/validator-specs', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.createValidatorSpec, req.body)
    sendContractData(res, ProblemContracts.createValidatorSpec, await createValidatorSpec({ user: req.user!, problemId: req.params.id, spec: body.spec }), 201)
  } catch (error) { return sendAiError(error, res) }
}))

problemAiRouter.get('/:id/validator-specs', authenticate, asyncHandler(async (req, res) => {
  try { sendContractData(res, ProblemContracts.listValidatorSpecs, await listValidatorSpecs(req.user!, req.params.id)) }
  catch (error) { return sendAiError(error, res) }
}))

problemAiRouter.post('/:id/validator-specs/:specId/activate', authenticate, asyncHandler(async (req, res) => {
  try {
    parseContractBody(ProblemContracts.activateValidatorSpec, req.body || {})
    sendContractData(res, ProblemContracts.activateValidatorSpec, await activateValidatorSpec({ user: req.user!, problemId: req.params.id, specId: req.params.specId }))
  } catch (error) { return sendAiError(error, res) }
}))

problemAiRouter.post('/:id/validator-specs/:specId/materialize', authenticate, asyncHandler(async (req, res) => {
  try {
    parseContractBody(ProblemContracts.materializeValidatorSpec, req.body || {})
    sendContractData(res, ProblemContracts.materializeValidatorSpec, await materializeValidatorSpec({ user: req.user!, problemId: req.params.id, specId: req.params.specId }))
  } catch (error) { return sendAiError(error, res) }
}))

problemAiRouter.post('/:id/ai/validator', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.generateAiValidator, req.body)
    sendContractData(res, ProblemContracts.generateAiValidator, await generateAiValidator({ user: req.user!, problemId: req.params.id, statementId: body.statementId }), 201)
  } catch (error) { return sendAiError(error, res) }
}, 'Validator 生成失败'))

problemAiRouter.get('/:id/ai/validator/:requestId', authenticate, asyncHandler(async (req, res) => {
  try { sendContractData(res, ProblemContracts.getAiValidatorRequest, await getAiValidatorRequest(req.user!, req.params.id, req.params.requestId)) }
  catch (error) { return sendAiError(error, res) }
}))

problemAiRouter.post('/:id/ai/validator-spec', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.generateAiValidatorSpec, req.body)
    sendContractData(res, ProblemContracts.generateAiValidatorSpec, await generateAiValidatorSpec({ user: req.user!, problemId: req.params.id, statementId: body.statementId }), 201)
  } catch (error) { return sendAiError(error, res) }
}, 'Validator DSL 生成失败'))

problemAiRouter.post('/:id/ai/validator-spec/:requestId/save', authenticate, asyncHandler(async (req, res) => {
  try {
    parseContractBody(ProblemContracts.saveAiValidatorSpec, req.body || {})
    sendContractData(res, ProblemContracts.saveAiValidatorSpec, await saveAiValidatorSpec({ user: req.user!, problemId: req.params.id, requestId: req.params.requestId }), 201)
  } catch (error) { return sendAiError(error, res) }
}))

problemAiRouter.post('/:id/ai/validator/:requestId/repair', authenticate, asyncHandler(async (req, res) => {
  try {
    parseContractBody(ProblemContracts.repairAiValidator, req.body || {})
    sendContractData(res, ProblemContracts.repairAiValidator, await generateAiValidator({ user: req.user!, problemId: req.params.id, parentRequestId: req.params.requestId }), 201)
  } catch (error) { return sendAiError(error, res) }
}, 'Validator 修复失败'))

problemAiRouter.post('/:id/ai/validator/:requestId/save', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.saveAiValidator, req.body)
    sendContractData(res, ProblemContracts.saveAiValidator, await saveAiValidator({ user: req.user!, problemId: req.params.id, requestId: req.params.requestId, ...body }), 201)
  } catch (error) { return sendAiError(error, res) }
}, 'Validator 保存失败'))

problemAiRouter.post('/:id/ai/translate', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.translateStatement, req.body)
    const data = await translateProblemStatement({
      user: req.user!,
      problemId: req.params.id,
      targetLang: body.targetLang,
      statementId: body.statementId,
    })
    return sendContractData(res, ProblemContracts.translateStatement, data)
  } catch (error) {
    return sendAiError(error, res)
  }
}, '翻译失败'))

problemAiRouter.post('/:id/ai/format', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.formatStatement, req.body)
    const data = await formatProblemStatement({
      user: req.user!,
      problemId: req.params.id,
      statementId: body.statementId,
    })
    return sendContractData(res, ProblemContracts.formatStatement, data)
  } catch (error) {
    return sendAiError(error, res)
  }
}, '格式化失败'))

problemAiRouter.get('/:id/ai/usage', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getProblemAiUsage(req.user!, req.params.id)
    return sendContractData(res, ProblemContracts.getAiUsage, data)
  } catch (error) {
    return sendAiError(error, res)
  }
}))
