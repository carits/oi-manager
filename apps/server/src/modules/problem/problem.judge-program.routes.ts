import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { createJudgeProgram, createJudgeProgramVersion, JudgeProgramError, listJudgePrograms, updateJudgeProgram } from './problem.judge-program.service'
export const problemJudgeProgramRouter = Router()
function send(error: unknown, res: any) { if (!(error instanceof JudgeProgramError)) throw error; return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message }) }
problemJudgeProgramRouter.get('/:id/judge-programs', authenticate, asyncHandler(async (req, res) => { try { res.json({ success: true, data: await listJudgePrograms(req.user!, req.params.id) }) } catch (error) { return send(error, res) } }))
problemJudgeProgramRouter.post('/:id/judge-programs', authenticate, asyncHandler(async (req, res) => { try { res.status(201).json({ success: true, data: await createJudgeProgram({ user: req.user!, problemId: req.params.id, ...req.body }) }) } catch (error) { return send(error, res) } }))
problemJudgeProgramRouter.post('/:id/judge-programs/:programId/versions', authenticate, asyncHandler(async (req, res) => { try { res.status(201).json({ success: true, data: await createJudgeProgramVersion({ user: req.user!, problemId: req.params.id, programId: req.params.programId, ...req.body }) }) } catch (error) { return send(error, res) } }))
problemJudgeProgramRouter.patch('/:id/judge-programs/:programId', authenticate, asyncHandler(async (req, res) => { try { res.json({ success: true, data: await updateJudgeProgram({ user: req.user!, problemId: req.params.id, programId: req.params.programId, ...req.body }) }) } catch (error) { return send(error, res) } }))
