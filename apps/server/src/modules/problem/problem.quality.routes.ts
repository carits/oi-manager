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

export const problemQualityRouter = Router()

function sendQualityError(error: unknown, res: any) {
  if (!(error instanceof ProblemQualityError)) throw error
  return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
}

problemQualityRouter.get('/:id/quality', authenticate, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await getProblemQuality(req.user!, req.params.id) }) }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.get('/:id/test-set-revisions/:revisionId/quality', authenticate, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await getRevisionQuality(req.user!, req.params.id, req.params.revisionId) }) }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.post('/:id/quality-evaluation-jobs', authenticate, asyncHandler(async (req, res) => {
  try { res.status(202).json({ success: true, data: await requestQualityEvaluation(req.user!, req.params.id, req.body) }) }
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
  try { res.status(201).json({ success: true, data: await createSolutionProfile(req.user!, req.params.id, req.body) }) }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.patch('/:id/solution-profiles/:profileId', authenticate, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await updateSolutionProfile(req.user!, req.params.id, req.params.profileId, req.body) }) }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.get('/:id/problem-quality-assessments', authenticate, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await listProblemQualityAssessments(req.user!, req.params.id) }) }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.post('/:id/problem-quality-assessments/automated', authenticate, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await runAutomatedProblemQualityAssessment(req.user!, req.params.id) }) }
  catch (error) { return sendQualityError(error, res) }
}))

problemQualityRouter.post('/:id/problem-quality-assessments/:assessmentId/expert-review', authenticate, asyncHandler(async (req, res) => {
  try { res.json({ success: true, data: await submitExpertProblemQualityReview(req.user!, req.params.id, req.params.assessmentId, req.body) }) }
  catch (error) { return sendQualityError(error, res) }
}))
