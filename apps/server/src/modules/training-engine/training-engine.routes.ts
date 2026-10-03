import { Router, type Response } from 'express'
import type { AuthRequest } from '../../middleware/auth'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { TrainingContracts } from '@oi-manager/contracts'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../../lib/api-contract'
import { resolveTrainingEventStreamOrganizationId } from './training-engine.event-stream'
import { trainingMetrics } from './training-metrics'
import {
  TrainingEngineError,
  advanceTrainingRound,
  archiveTrainingSession,
  assertTrainingScopeContextForUser,
  assertTrainingSessionContextForUser,
  changeTrainingGrouping,
  createTrainingSession,
  deleteTrainingNextRound,
  executeTrainingCommand,
  getCoachDashboard,
  getTrainingDraft,
  getTrainingPeerProgress,
  getTrainingReport,
  getTrainingWorkspace,
  joinTrainingSession,
  listTrainingEvents,
  listTrainingSessions,
  previewTrainingParticipants,
  putTrainingNextRound,
  recordHeartbeat,
  replaceCurrentAssignments,
  replaceTrainingGrouping,
  saveTrainingDraft,
  submitTrainingSolution,
} from './training-engine.service'

export const trainingEngineRouter = Router()

function sendError(error: unknown, res: Response) {
  if (sendContractError(error, res)) return
  if (error instanceof TrainingEngineError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, ...(error.details === undefined ? {} : { data: error.details }) })
  }
  throw error
}

function isGlobalTrainingAdmin(user: NonNullable<AuthRequest['user']>) {
  return user.accountRole === 'platform_admin' || user.accountRole === 'super_admin'
}

trainingEngineRouter.get('/training-sessions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const query = parseContractQuery(TrainingContracts.listSessions, req.query)
    await assertTrainingScopeContextForUser(req.user!, query)
    const activeOrganizationId = isGlobalTrainingAdmin(req.user!) ? undefined : req.user!.organizationId || null
    sendContractData(res, TrainingContracts.listSessions, await listTrainingSessions(req.user!.userId, query, activeOrganizationId))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(TrainingContracts.createSession, req.body)
    await assertTrainingScopeContextForUser(req.user!, body)
    sendContractData(res, TrainingContracts.createSession, await createTrainingSession(req.user!.userId, body), 201)
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/participant-preview', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(TrainingContracts.previewParticipants, req.body)
    await assertTrainingScopeContextForUser(req.user!, body)
    sendContractData(res, TrainingContracts.previewParticipants, await previewTrainingParticipants(req.user!.userId, body))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.use('/training-sessions/:id/events', (req, _res, next) => {
  const organizationId = resolveTrainingEventStreamOrganizationId(req.query.organizationId)
  if (!req.get('x-oi-organization-id') && organizationId) req.headers['x-oi-organization-id'] = organizationId
  next()
})

trainingEngineRouter.use('/training-sessions/:id', authenticate, asyncHandler(async (request, _res, next) => {
  const req = request as AuthRequest
  await assertTrainingSessionContextForUser(req.user!, req.params.id)
  next()
}, '校验训练场次组织上下文失败'))

trainingEngineRouter.get('/training-sessions/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const workspace = await getTrainingWorkspace(req.user!.userId, req.params.id)
    trainingMetrics.observeSession(req.params.id, workspace.session.status)
    sendContractData(res, TrainingContracts.getWorkspace, workspace)
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.put('/training-sessions/:id/assignments', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendContractData(res, TrainingContracts.replaceAssignments, await replaceCurrentAssignments(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.replaceAssignments, req.body)))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.put('/training-sessions/:id/next-round', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendContractData(res, TrainingContracts.putNextRound, await putTrainingNextRound(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.putNextRound, req.body)))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.delete('/training-sessions/:id/next-round', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendContractData(res, TrainingContracts.deleteNextRound, await deleteTrainingNextRound(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.deleteNextRound, req.body)))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/rounds/advance', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendContractData(res, TrainingContracts.advanceRound, await advanceTrainingRound(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.advanceRound, req.body)))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.put('/training-sessions/:id/grouping', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendContractData(res, TrainingContracts.replaceGrouping, await replaceTrainingGrouping(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.replaceGrouping, req.body)))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/grouping/change', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendContractData(res, TrainingContracts.changeGrouping, await changeTrainingGrouping(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.changeGrouping, req.body)))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/commands', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await executeTrainingCommand(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.executeCommand, req.body))
    trainingMetrics.recordCommand(true)
    sendContractData(res, TrainingContracts.executeCommand, result)
  } catch (error) {
    trainingMetrics.recordCommand(false)
    return sendError(error, res)
  }
}))

trainingEngineRouter.post('/training-sessions/:id/archive', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(TrainingContracts.archiveSession, req.body)
    sendContractData(res, TrainingContracts.archiveSession, await archiveTrainingSession(req.user!.userId, req.params.id, body.expectedRevision))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/join', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    parseContractBody(TrainingContracts.joinSession, req.body)
    sendContractData(res, TrainingContracts.joinSession, await joinTrainingSession(req.user!.userId, req.params.id))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.put('/training-sessions/:id/drafts/:sessionProblemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendContractData(res, TrainingContracts.saveDraft, await saveTrainingDraft(req.user!.userId, req.params.id, req.params.sessionProblemId, parseContractBody(TrainingContracts.saveDraft, req.body)))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/drafts/:sessionProblemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendContractData(res, TrainingContracts.getDraft, await getTrainingDraft(req.user!.userId, req.params.id, req.params.sessionProblemId))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/heartbeat', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendContractData(res, TrainingContracts.heartbeat, await recordHeartbeat(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.heartbeat, req.body)))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/submit', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    sendContractData(res, TrainingContracts.submit, await submitTrainingSolution(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.submit, req.body)), 201)
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/coach-dashboard', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.getCoachDashboard, await getCoachDashboard(req.user!.userId, req.params.id)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/report', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.getReport, await getTrainingReport(req.user!.userId, req.params.id)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/peer-progress', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const query = parseContractQuery(TrainingContracts.getPeerProgress, req.query)
    sendContractData(res, TrainingContracts.getPeerProgress, await getTrainingPeerProgress(req.user!.userId, req.params.id, query.groupId))
  } catch (error) { return sendError(error, res) }
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
  trainingMetrics.openSseConnection()
  res.write(`event: ready\ndata: ${JSON.stringify({ cursor })}\n\n`)
  let closed = false
  let busy = false
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
  req.once('close', () => {
    if (closed) return
    closed = true
    trainingMetrics.closeSseConnection()
    clearInterval(pollTimer)
    clearInterval(heartbeatTimer)
  })
}))
