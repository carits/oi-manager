import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { DataGenerationError } from './problem.data-generation.service'
import { ProblemCandidateError, cancelCandidate, contributeCandidateData, contributeCandidateGenerator, getCandidateDetail, getCandidatePool, listFeatureDefinitions, listMyCandidates, listSelectorRuns, listSubtaskRules, previewSelector, updateCandidatePolicy, updateFeatureDefinitions, updateSubtaskRules } from './application/problem-candidate.service'

export const problemCandidateRouter = Router()
function send(error: any, res: any) { if (!(error instanceof ProblemCandidateError) && !(error instanceof DataGenerationError) && !error?.statusCode) throw error; return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message }) }

problemCandidateRouter.post('/:id/candidates/data', authenticate, asyncHandler(async (req, res) => { try { res.status(202).json({ success: true, data: await contributeCandidateData(req.user!, req.params.id, req.body), message: '候选数据已进入隔离评估队列' }) } catch (error) { return send(error, res) } }))
problemCandidateRouter.post('/:id/candidates/generator', authenticate, asyncHandler(async (req, res) => { try { res.status(202).json({ success: true, data: await contributeCandidateGenerator(req.user!, req.params.id, req.body), message: 'Generator 已进入确定性检查与候选评估队列' }) } catch (error) { return send(error, res) } }))
problemCandidateRouter.get('/:id/candidates/mine', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await listMyCandidates(req.user!, req.params.id) })))
problemCandidateRouter.get('/:id/candidates/:candidateId', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await getCandidateDetail(req.user!, req.params.id, req.params.candidateId) })))
problemCandidateRouter.post('/:id/candidates/:candidateId/cancel', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await cancelCandidate(req.user!, req.params.id, req.params.candidateId) })))
problemCandidateRouter.get('/:id/candidate-pool', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await getCandidatePool(req.user!, req.params.id) })))
problemCandidateRouter.put('/:id/candidate-policy', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await updateCandidatePolicy(req.user!, req.params.id, req.body) })))
problemCandidateRouter.get('/:id/selector-runs', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await listSelectorRuns(req.user!, req.params.id) })))
problemCandidateRouter.post('/:id/selector-runs/preview', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await previewSelector(req.user!, req.params.id) })))
problemCandidateRouter.get('/:id/feature-definitions', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await listFeatureDefinitions(req.user!, req.params.id) })))
problemCandidateRouter.put('/:id/feature-definitions', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await updateFeatureDefinitions(req.user!, req.params.id, req.body) })))
problemCandidateRouter.get('/:id/subtask-rules', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await listSubtaskRules(req.user!, req.params.id) })))
problemCandidateRouter.put('/:id/subtask-rules', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await updateSubtaskRules(req.user!, req.params.id, req.body) })))
