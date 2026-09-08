import { Router } from 'express'
import type { AuthRequest } from '../../middleware/auth'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { BUILTIN_TRAINING_TEMPLATES } from './training-engine.templates'
import {
  TrainingEngineError,
  archiveTrainingSession,
  createTrainingHint,
  createTrainingSession,
  executeTrainingCommand,
  getCoachDashboard,
  getTrainingDraft,
  getTrainingReport,
  getTrainingPeerProgress,
  getTrainingRoster,
  getTrainingWorkspace,
  joinTrainingSession,
  listAvailableHints,
  listTrainingEvents,
  listTrainingSessions,
  openTrainingHint,
  publishTrainingSession,
  recordHeartbeat,
  recordStrategyDecision,
  replaceTrainingStructure,
  replaceTrainingRoster,
  saveTrainingDraft,
  submitTrainingSolution,
} from './training-engine.service'

export const trainingEngineRouter = Router()

function sendError(error: unknown, res: any) {
  if (error instanceof TrainingEngineError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
  throw error
}

trainingEngineRouter.get('/training-session-templates', authenticate, (_req, res) => res.json({ success: true, data: BUILTIN_TRAINING_TEMPLATES }))

trainingEngineRouter.get('/training-sessions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await listTrainingSessions(req.user!.userId, req.query) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.status(201).json({ success: true, data: await createTrainingSession(req.user!.userId, req.body) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await getTrainingWorkspace(req.user!.userId, req.params.id) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.put('/training-sessions/:id/structure', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await replaceTrainingStructure(req.user!.userId, req.params.id, req.body) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/publish', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await publishTrainingSession(req.user!.userId, req.params.id, Number(req.body?.expectedRevision)) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.put('/training-sessions/:id/roster', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await replaceTrainingRoster(req.user!.userId, req.params.id, req.body) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/roster', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await getTrainingRoster(req.user!.userId, req.params.id) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/archive', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await archiveTrainingSession(req.user!.userId, req.params.id, Number(req.body?.expectedRevision)) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/join', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await joinTrainingSession(req.user!.userId, req.params.id) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/commands', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await executeTrainingCommand(req.user!.userId, req.params.id, req.body) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/heartbeat', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await recordHeartbeat(req.user!.userId, req.params.id, req.body) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/drafts/:problemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await getTrainingDraft(req.user!.userId, req.params.id, req.params.problemId) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.put('/training-sessions/:id/drafts/:problemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await saveTrainingDraft(req.user!.userId, req.params.id, req.params.problemId, req.body) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/submit', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.status(201).json({ success: true, data: await submitTrainingSolution(req.user!.userId, req.params.id, req.body) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/hints', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.status(201).json({ success: true, data: await createTrainingHint(req.user!.userId, req.params.id, req.body) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/problems/:stageProblemId/hints', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await listAvailableHints(req.user!.userId, req.params.id, req.params.stageProblemId) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/hints/:hintId/open', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await openTrainingHint(req.user!.userId, req.params.id, req.params.hintId) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/strategy-decisions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.status(201).json({ success: true, data: await recordStrategyDecision(req.user!.userId, req.params.id, req.body) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/coach-dashboard', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await getCoachDashboard(req.user!.userId, req.params.id) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/report', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await getTrainingReport(req.user!.userId, req.params.id) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/peer-progress', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { res.json({ success: true, data: await getTrainingPeerProgress(req.user!.userId, req.params.id) }) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/events', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.userId
  const sessionId = req.params.id
  let cursor = Math.max(0, Number(req.headers['last-event-id'] || req.query.afterSeq || 0) || 0)
  try { await listTrainingEvents(userId, sessionId, cursor) } catch (error) { return sendError(error, res) }
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write(`event: ready\ndata: ${JSON.stringify({ cursor })}\n\n`)
  let closed = false, busy = false
  const poll = async () => {
    if (closed || busy) return
    busy = true
    try {
      const events = await listTrainingEvents(userId, sessionId, cursor)
      for (const event of events) {
        cursor = event.seq
        res.write(`id: ${event.seq}\nevent: training\ndata: ${JSON.stringify({ type: event.type, targetType: event.targetType, targetId: event.targetId, payload: event.payload, createdAt: event.createdAt })}\n\n`)
      }
    } catch {
      res.write(`event: resync_required\ndata: ${JSON.stringify({ cursor })}\n\n`)
    } finally { busy = false }
  }
  const pollTimer = setInterval(() => void poll(), 1000)
  const heartbeatTimer = setInterval(() => res.write(': heartbeat\n\n'), 20_000)
  req.once('close', () => { closed = true; clearInterval(pollTimer); clearInterval(heartbeatTimer) })
}))
