import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { DataGenerationError } from './problem.data-generation.service'
import { ProblemCandidateError, cancelCandidate, contributeCandidateData, contributeCandidateGenerator, emergencyPublish, getCandidateDetail, getCandidatePool, getContribution, getContributionReadiness, listFeatureDefinitions, listMyCandidates, listMyContributions, listSelectorRuns, listSubtaskRules, previewSelector, updateCandidatePolicy, updateFeatureDefinitions, updateSubtaskRules } from './application/problem-candidate.service'
import { ContributionReadinessError } from './problem.contribution-readiness.service'
import { ProblemContracts } from '@oi-manager/contracts'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'

export const problemCandidateRouter = Router()
function send(error: any, res: any) {
  if (sendContractError(error, res)) return
  if (!(error instanceof ProblemCandidateError) && !(error instanceof DataGenerationError) && !(error instanceof ContributionReadinessError) && !error?.statusCode) throw error
  return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
}

problemCandidateRouter.get('/:id/contribution-readiness', authenticate, asyncHandler(async (req, res) => {
  try {
    return sendContractData(res, ProblemContracts.getContributionReadiness, await getContributionReadiness(req.user!, req.params.id))
  } catch (error) { return send(error, res) }
}))
problemCandidateRouter.get('/:id/contributions/mine', authenticate, asyncHandler(async (req, res) => {
  try {
    return sendContractData(res, ProblemContracts.listContributions, await listMyContributions(req.user!, req.params.id))
  } catch (error) { return send(error, res) }
}))
problemCandidateRouter.get('/:id/contributions/:jobId', authenticate, asyncHandler(async (req, res) => { try { res.json({ success: true, data: await getContribution(req.user!, req.params.id, req.params.jobId) }) } catch (error) { return send(error, res) } }))

problemCandidateRouter.post('/:id/candidates/data', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.contributeCandidateData, req.body)
    return sendContractData(res, ProblemContracts.contributeCandidateData, await contributeCandidateData(req.user!, req.params.id, body), 202)
  } catch (error) { return send(error, res) }
}))
problemCandidateRouter.post('/:id/candidates/generator', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ProblemContracts.contributeCandidateGenerator, req.body)
    return sendContractData(res, ProblemContracts.contributeCandidateGenerator, await contributeCandidateGenerator(req.user!, req.params.id, body), 202)
  } catch (error) { return send(error, res) }
}))
problemCandidateRouter.get('/:id/candidates/mine', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await listMyCandidates(req.user!, req.params.id) })))
problemCandidateRouter.get('/:id/candidates/:candidateId', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await getCandidateDetail(req.user!, req.params.id, req.params.candidateId) })))
problemCandidateRouter.post('/:id/candidates/:candidateId/cancel', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await cancelCandidate(req.user!, req.params.id, req.params.candidateId) })))
problemCandidateRouter.get('/:id/candidate-pool', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await getCandidatePool(req.user!, req.params.id) })))
problemCandidateRouter.put('/:id/candidate-policy', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await updateCandidatePolicy(req.user!, req.params.id, req.body) })))
problemCandidateRouter.get('/:id/selector-runs', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await listSelectorRuns(req.user!, req.params.id) })))
problemCandidateRouter.post('/:id/selector-runs/preview', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await previewSelector(req.user!, req.params.id) })))
problemCandidateRouter.post('/:id/canonical-emergency-publish', authenticate, asyncHandler(async (req, res) => { try { res.json({ success: true, data: await emergencyPublish(req.user!, req.params.id, req.body) }) } catch (error) { return send(error, res) } }))
problemCandidateRouter.get('/:id/feature-definitions', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await listFeatureDefinitions(req.user!, req.params.id) })))
problemCandidateRouter.put('/:id/feature-definitions', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await updateFeatureDefinitions(req.user!, req.params.id, req.body) })))
problemCandidateRouter.get('/:id/subtask-rules', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await listSubtaskRules(req.user!, req.params.id) })))
problemCandidateRouter.put('/:id/subtask-rules', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await updateSubtaskRules(req.user!, req.params.id, req.body) })))
