import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import {
  createSolutionProfile,
  ProblemQualityError,
  getProblemQuality,
  getQualityJob,
  getRevisionQuality,
  listSolutionProfiles,
  listProblemQualityAssessments,
  listQualityJobs,
  requestQualityEvaluation,
  runAutomatedProblemQualityAssessment,
  submitExpertProblemQualityReview,
  updateSolutionProfile,
} from './problem.quality.service'
import { ProblemQualityContracts } from '@oi-manager/contracts'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'

export const problemQualityRouter = Router()

function sendQualityError(error: unknown, res: any) {
  if (sendContractError(error, res)) return res
  if (!(error instanceof ProblemQualityError)) throw error
  return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
}

problemQualityRouter.get('/:id/quality', authenticate, asyncHandler(async (req, res) => {
  try { sendContractData(res, ProblemQualityContracts.dashboard, await getProblemQuality(req.user!, req.params.id)) }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.get('/:id/test-set-revisions/:revisionId/quality', authenticate, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await getRevisionQuality(req.user!, req.params.id, req.params.revisionId) }) }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.post('/:id/quality-evaluation-jobs', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemQualityContracts.requestEvaluation, req.body)
    sendContractData(res, ProblemQualityContracts.requestEvaluation, await requestQualityEvaluation(req.user!, req.params.id, body), 202)
  }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.get('/:id/quality-evaluation-jobs', authenticate, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await listQualityJobs(req.user!, req.params.id) }) }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.get('/:id/quality-evaluation-jobs/:jobId', authenticate, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await getQualityJob(req.user!, req.params.id, req.params.jobId) }) }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.get('/:id/solution-profiles', authenticate, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await listSolutionProfiles(req.user!, req.params.id) }) }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.post('/:id/solution-profiles', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemQualityContracts.createSolutionProfile, req.body)
    sendContractData(res, ProblemQualityContracts.createSolutionProfile, await createSolutionProfile(req.user!, req.params.id, body), 201)
  }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.patch('/:id/solution-profiles/:profileId', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemQualityContracts.updateSolutionProfile, req.body)
    sendContractData(res, ProblemQualityContracts.updateSolutionProfile, await updateSolutionProfile(req.user!, req.params.id, req.params.profileId, body))
  }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.get('/:id/problem-quality-assessments', authenticate, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await listProblemQualityAssessments(req.user!, req.params.id) }) }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.post('/:id/problem-quality-assessments/automated', authenticate, asyncHandler(async (req, res) => {
  try {
    parseContractBody(ProblemQualityContracts.runAutomated, req.body || {})
    sendContractData(res, ProblemQualityContracts.runAutomated, await runAutomatedProblemQualityAssessment(req.user!, req.params.id))
  }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.post('/:id/problem-quality-assessments/:assessmentId/expert-review', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemQualityContracts.submitExpert, req.body)
    sendContractData(res, ProblemQualityContracts.submitExpert, await submitExpertProblemQualityReview(req.user!, req.params.id, req.params.assessmentId, body))
  }
  catch (error) { return sendQualityError(error, res) }
}))
