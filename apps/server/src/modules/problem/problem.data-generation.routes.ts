import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { cancelDataGenerationJob, createDataGenerationJob, DataGenerationError, getDataGenerationJob, listDataGenerationJobs, promoteDataGenerationJob } from './problem.data-generation.service'
import { JudgeProgramError } from './problem.judge-program.service'
export const problemDataGenerationRouter = Router()
function send(error: unknown, res: any) { if (!(error instanceof DataGenerationError) && !(error instanceof JudgeProgramError)) throw error; return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, ...('data' in error && error.data !== undefined ? { data: error.data } : {}) }) }
problemDataGenerationRouter.post('/:id/data-generation-jobs', authenticate, asyncHandler(async (req, res) => { try { res.status(201).json({ success: true, data: await createDataGenerationJob({ user: req.user!, problemId: req.params.id, body: { ...req.body, contribution: false } }) }) } catch (error) { return send(error, res) } }))
problemDataGenerationRouter.get('/:id/data-generation-jobs', authenticate, asyncHandler(async (req, res) => { try { res.json({ success: true, data: await listDataGenerationJobs(req.user!, req.params.id) }) } catch (error) { return send(error, res) } }))
problemDataGenerationRouter.get('/:id/data-generation-jobs/:jobId', authenticate, asyncHandler(async (req, res) => { try { res.json({ success: true, data: await getDataGenerationJob(req.user!, req.params.id, req.params.jobId) }) } catch (error) { return send(error, res) } }))
problemDataGenerationRouter.post('/:id/data-generation-jobs/:jobId/cancel', authenticate, asyncHandler(async (req, res) => { try { res.json({ success: true, data: await cancelDataGenerationJob(req.user!, req.params.id, req.params.jobId) }) } catch (error) { return send(error, res) } }))
problemDataGenerationRouter.post('/:id/data-generation-jobs/:jobId/promote', authenticate, asyncHandler(async (req, res) => { try { res.json({ success: true, data: await promoteDataGenerationJob({ user: req.user!, problemId: req.params.id, jobId: req.params.jobId, expectedLatestRevisionId: String(req.body?.expectedLatestRevisionId || ''), caseIds: req.body?.caseIds, assignments: req.body?.assignments }) }) } catch (error) { return send(error, res) } }))
