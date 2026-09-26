import { Router } from 'express'
import { ProblemContracts } from '@oi-manager/contracts'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { cancelDataGenerationJob, createDataGenerationJob, DataGenerationError, getDataGenerationJob, listDataGenerationJobs, promoteDataGenerationJob } from './problem.data-generation.service'
import { JudgeProgramError } from './problem.judge-program.service'

export const problemDataGenerationRouter = Router()

function send(error: unknown, res: any) {
  if (sendContractError(error, res)) return res
  if (!(error instanceof DataGenerationError) && !(error instanceof JudgeProgramError)) throw error
  return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, ...('data' in error && error.data !== undefined ? { data: error.data } : {}) })
}

problemDataGenerationRouter.post('/:id/data-generation-jobs', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.createDataGenerationJob, req.body)
    sendContractData(res, ProblemContracts.createDataGenerationJob, await createDataGenerationJob({
      user: req.user!,
      problemId: req.params.id,
      body: { ...body, contribution: false },
    }), 201)
  } catch (error) { return send(error, res) }
}))

problemDataGenerationRouter.get('/:id/data-generation-jobs', authenticate, asyncHandler(async (req, res) => {
  try { sendContractData(res, ProblemContracts.listDataGenerationJobs, await listDataGenerationJobs(req.user!, req.params.id)) }
  catch (error) { return send(error, res) }
}))

problemDataGenerationRouter.get('/:id/data-generation-jobs/:jobId', authenticate, asyncHandler(async (req, res) => {
  try { sendContractData(res, ProblemContracts.getDataGenerationJob, await getDataGenerationJob(req.user!, req.params.id, req.params.jobId)) }
  catch (error) { return send(error, res) }
}))

problemDataGenerationRouter.post('/:id/data-generation-jobs/:jobId/cancel', authenticate, asyncHandler(async (req, res) => {
  try {
    parseContractBody(ProblemContracts.cancelDataGenerationJob, req.body || {})
    sendContractData(res, ProblemContracts.cancelDataGenerationJob, await cancelDataGenerationJob(req.user!, req.params.id, req.params.jobId))
  } catch (error) { return send(error, res) }
}))

problemDataGenerationRouter.post('/:id/data-generation-jobs/:jobId/promote', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.promoteDataGenerationJob, req.body)
    sendContractData(res, ProblemContracts.promoteDataGenerationJob, await promoteDataGenerationJob({
      user: req.user!,
      problemId: req.params.id,
      jobId: req.params.jobId,
      ...body,
      expectedLatestRevisionId: String(body.expectedLatestRevisionId || ""),
    }))
  } catch (error) { return send(error, res) }
}))
