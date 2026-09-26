import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import {
  createProblemHackAttempt,
  getProblemHackAttempt,
  getProblemHackConfig,
  listProblemHackAttempts,
  ProblemHackRouteError,
  retryProblemHackAttempt,
  saveProblemHackConfig,
} from './application/problem-hack-route.service'
import { ContributionApplicationError } from '../contribution/application/contribution.service'
import { ProblemContracts } from '@oi-manager/contracts'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../../lib/api-contract'

export const problemHackRouter = Router()

function sendHackError(error: unknown, res: any) {
  if (!(error instanceof ProblemHackRouteError) && !(error instanceof ContributionApplicationError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
    ...((error as any).data !== undefined ? { data: (error as any).data } : {}),
  })
}

problemHackRouter.get('/:id/hack-config', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getProblemHackConfig(req.user!, req.params.id)
    return sendContractData(res, ProblemContracts.getHackConfig, data)
  } catch (error) {
    if (sendContractError(error, res)) return
    return sendHackError(error, res)
  }
}))

problemHackRouter.put('/:id/hack-config', authenticate, asyncHandler(async (req, res) => {
  try {
    const result = await saveProblemHackConfig({
      user: req.user!,
      problemId: req.params.id,
      body: parseContractBody(ProblemContracts.saveHackConfig, req.body),
    })
    return sendContractData(res, ProblemContracts.saveHackConfig, result.config)
  } catch (error) {
    if (sendContractError(error, res)) return
    return sendHackError(error, res)
  }
}))

problemHackRouter.post('/:id/hacks', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await createProblemHackAttempt({
      user: req.user!,
      problemId: req.params.id,
      body: parseContractBody(ProblemContracts.createHackAttempt, req.body),
    })
    return sendContractData(res, ProblemContracts.createHackAttempt, data, 202)
  } catch (error) {
    if (sendContractError(error, res)) return
    return sendHackError(error, res)
  }
}))

problemHackRouter.get('/:id/hacks', authenticate, asyncHandler(async (req, res) => {
  try {
    const query = parseContractQuery(ProblemContracts.listHackAttempts, req.query)
    const data = await listProblemHackAttempts({
      user: req.user!,
      problemId: req.params.id,
      pageValue: query.page,
      pageSizeValue: query.pageSize,
    })
    return sendContractData(res, ProblemContracts.listHackAttempts, data)
  } catch (error) {
    if (sendContractError(error, res)) return
    return sendHackError(error, res)
  }
}))

problemHackRouter.get('/:id/hacks/:hackId', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getProblemHackAttempt(req.user!, req.params.id, req.params.hackId)
    return sendContractData(res, ProblemContracts.getHackAttempt, data)
  } catch (error) {
    if (sendContractError(error, res)) return
    return sendHackError(error, res)
  }
}))

problemHackRouter.post('/:id/hacks/:hackId/retry', authenticate, asyncHandler(async (req, res) => {
  try {
    parseContractBody(ProblemContracts.retryHackAttempt, req.body)
    const data = await retryProblemHackAttempt(req.user!, req.params.id, req.params.hackId)
    return sendContractData(res, ProblemContracts.retryHackAttempt, data)
  } catch (error) {
    if (sendContractError(error, res)) return
    return sendHackError(error, res)
  }
}))
