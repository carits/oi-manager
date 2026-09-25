import { Router, type Response } from 'express'
import type { AuthRequest } from '../../middleware/auth'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { TrainingContracts } from '@oi-manager/contracts'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../../lib/api-contract'
import { trainingMetrics } from './training-metrics'
import {
  TrainingEngineError,
  assertTrainingScopeContextForUser,
  assertTrainingSessionContextForUser,
  assertTrainingTemplateContextForUser,
  archiveTrainingSession,
  createTrainingSessionTemplate,
  createTrainingHint,
  deleteTrainingHint,
  createTrainingSession,
  deleteTrainingSessionTemplate,
  changeTrainingStageGroup,
  cloneTrainingStage,
  endTrainingStage,
  executeStageTransition,
  executeTrainingGroupRuntimeAction,
  executeTrainingGroupRuntimeBatch,
  splitTrainingGroup,
  mergeTrainingGroup,
  executeTrainingCommand,
  extendTrainingStageTime,
  getTrainingDesign,
  getTrainingDesignProblem,
  getCoachDashboard,
  getTrainingDraft,
  getTrainingReport,
  getTrainingStageGroupSuggestions,
  getTrainingPeerProgress,
  getTrainingRoster,
  getTrainingGrouping,
  replaceTrainingGrouping,
  replaceTrainingStageGroupMatrix,
  changeTrainingGrouping,
  getTrainingWorkspace,
  joinTrainingSession,
  listAvailableHints,
  listTrainingEvents,
  listTrainingSessionTemplates,
  listTrainingSessions,
  moveTrainingStageParticipant,
  openTrainingHint,
  previewTrainingParticipants,
  publishTrainingSession,
  recordHeartbeat,
  recordStrategyDecision,
  replaceTrainingStructure,
  replaceTrainingRoster,
  saveTrainingDraft,
  submitTrainingSolution,
  updateTrainingHint,
  validateTrainingStructure,
} from './training-engine.service'

export const trainingEngineRouter = Router()

function sendError(error: unknown, res: Response) {
  if (sendContractError(error, res)) return
  if (error instanceof TrainingEngineError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, ...(error.details === undefined ? {} : { data: error.details }) })
  throw error
}

function isGlobalTrainingAdmin(user: NonNullable<AuthRequest['user']>) {
  return user.accountRole === 'platform_admin' || user.accountRole === 'super_admin'
}

async function assertTrainingScopeContext(req: AuthRequest, scope: { organizationId?: string | null; teamId?: string | null }) {
  await assertTrainingScopeContextForUser(req.user!, scope)
}

async function assertTrainingSessionContext(req: AuthRequest, sessionId: string) {
  await assertTrainingSessionContextForUser(req.user!, sessionId)
}

async function assertTrainingTemplateContext(req: AuthRequest, templateId: string) {
  await assertTrainingTemplateContextForUser(req.user!, templateId)
}

trainingEngineRouter.get('/training-session-templates', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const query = parseContractQuery(TrainingContracts.listTemplates, req.query)
    await assertTrainingScopeContext(req, query)
    sendContractData(res, TrainingContracts.listTemplates, await listTrainingSessionTemplates(req.user!.userId, query))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.delete('/training-session-templates/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    await assertTrainingTemplateContext(req, req.params.id)
    sendContractData(res, TrainingContracts.deleteTemplate, await deleteTrainingSessionTemplate(req.user!.userId, req.params.id))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const query = parseContractQuery(TrainingContracts.listSessions, req.query)
    await assertTrainingScopeContext(req, query)
    const activeOrganizationId = isGlobalTrainingAdmin(req.user!) ? undefined : req.user!.organizationId || null
    sendContractData(res, TrainingContracts.listSessions, await listTrainingSessions(req.user!.userId, query, activeOrganizationId))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(TrainingContracts.createSession, req.body)
    await assertTrainingScopeContext(req, body)
    sendContractData(res, TrainingContracts.createSession, await createTrainingSession(req.user!.userId, body), 201)
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/templates', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    await assertTrainingSessionContext(req, req.params.id)
    sendContractData(res, TrainingContracts.createTemplate, await createTrainingSessionTemplate(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.createTemplate, req.body)), 201)
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/participant-preview', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(TrainingContracts.previewParticipants, req.body)
    await assertTrainingScopeContext(req, body)
    sendContractData(res, TrainingContracts.previewParticipants, await previewTrainingParticipants(req.user!.userId, body))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.use('/training-sessions/:id', authenticate, asyncHandler(async (request, _res, next) => {
  const req = request as AuthRequest
  await assertTrainingSessionContext(req, req.params.id)
  next()
}, '校验训练场次组织上下文失败'))

trainingEngineRouter.get('/training-sessions/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const workspace = await getTrainingWorkspace(req.user!.userId, req.params.id)
    trainingMetrics.observeSession(req.params.id, workspace.session.status)
    trainingMetrics.recordWorkspaceQueries(1)
    sendContractData(res, TrainingContracts.getWorkspace, workspace)
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/design', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.getDesign, await getTrainingDesign(req.user!.userId, req.params.id)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/design-problems/:problemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.getDesignProblem, await getTrainingDesignProblem(req.user!.userId, req.params.id, req.params.problemId)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/structure/validate', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.validateStructure, await validateTrainingStructure(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.validateStructure, req.body))) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.put('/training-sessions/:id/structure', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(TrainingContracts.replaceStructure, req.body)
    await replaceTrainingStructure(req.user!.userId, req.params.id, body)
    sendContractData(res, TrainingContracts.replaceStructure, await getTrainingDesign(req.user!.userId, req.params.id))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/publish', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { const body = parseContractBody(TrainingContracts.publish, req.body); sendContractData(res, TrainingContracts.publish, await publishTrainingSession(req.user!.userId, req.params.id, body.expectedRevision)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.put('/training-sessions/:id/roster', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.replaceRoster, await replaceTrainingRoster(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.replaceRoster, req.body))) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/roster', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.getRoster, await getTrainingRoster(req.user!.userId, req.params.id)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/grouping', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.getGrouping, await getTrainingGrouping(req.user!.userId, req.params.id)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.put('/training-sessions/:id/grouping', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.replaceGrouping, await replaceTrainingGrouping(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.replaceGrouping, req.body))) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/grouping/change', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.changeGrouping, await changeTrainingGrouping(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.changeGrouping, req.body))) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.put('/training-sessions/:id/stage-group-matrix', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.replaceStageGroupMatrix, await replaceTrainingStageGroupMatrix(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.replaceStageGroupMatrix, req.body))) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/archive', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { const body = parseContractBody(TrainingContracts.archiveSession, req.body); sendContractData(res, TrainingContracts.archiveSession, await archiveTrainingSession(req.user!.userId, req.params.id, body.expectedRevision)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/join', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { parseContractBody(TrainingContracts.joinSession, req.body); sendContractData(res, TrainingContracts.joinSession, await joinTrainingSession(req.user!.userId, req.params.id)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/commands', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await executeTrainingCommand(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.executeCommand, req.body))
    trainingMetrics.recordCommand(true)
    const status = result && 'session' in result ? result.session.status : result?.status
    if (status) trainingMetrics.observeSession(req.params.id, status)
    sendContractData(res, TrainingContracts.executeCommand, result)
  } catch (error) {
    trainingMetrics.recordCommand(false)
    return sendError(error, res)
  }
}))

trainingEngineRouter.post('/training-sessions/:id/group-runtime/actions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.groupRuntimeAction, await executeTrainingGroupRuntimeAction(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.groupRuntimeAction, req.body))) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/group-runtime/batch', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.groupRuntimeBatch, await executeTrainingGroupRuntimeBatch(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.groupRuntimeBatch, req.body))) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/groups/split', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.splitGroup, await splitTrainingGroup(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.splitGroup, req.body))) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/groups/merge', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.mergeGroup, await mergeTrainingGroup(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.mergeGroup, req.body))) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/stage-transitions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(TrainingContracts.transitionStage, req.body)
    const workspace = await executeStageTransition(req.user!.userId, req.params.id, body)
    trainingMetrics.observeSession(req.params.id, workspace.session.status)
    sendContractData(res, TrainingContracts.transitionStage, workspace)
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/stages/:stageId/end', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(TrainingContracts.endStage, req.body)
    const workspace = await endTrainingStage(req.user!.userId, req.params.id, req.params.stageId, body)
    trainingMetrics.observeSession(req.params.id, workspace.session.status)
    sendContractData(res, TrainingContracts.endStage, workspace)
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/stages/:stageId/clone', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(TrainingContracts.cloneStage, req.body)
    sendContractData(res, TrainingContracts.cloneStage, await cloneTrainingStage(req.user!.userId, req.params.id, req.params.stageId, body))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/stages/:stageId/move-participant', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(TrainingContracts.moveStageParticipant, req.body)
    const workspace = await moveTrainingStageParticipant(req.user!.userId, req.params.id, req.params.stageId, body)
    trainingMetrics.observeSession(req.params.id, workspace.session.status)
    sendContractData(res, TrainingContracts.moveStageParticipant, workspace)
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/stages/:stageId/group-changes', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(TrainingContracts.changeStageGroup, req.body)
    const workspace = await changeTrainingStageGroup(req.user!.userId, req.params.id, req.params.stageId, body)
    trainingMetrics.observeSession(req.params.id, workspace.session.status)
    sendContractData(res, TrainingContracts.changeStageGroup, workspace)
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/stages/:stageId/group-suggestions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.getGroupSuggestions, await getTrainingStageGroupSuggestions(req.user!.userId, req.params.id, req.params.stageId)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/stages/:stageId/time-extensions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(TrainingContracts.extendStageTime, req.body)
    sendContractData(res, TrainingContracts.extendStageTime, await extendTrainingStageTime(req.user!.userId, req.params.id, req.params.stageId, body))
  } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/heartbeat', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.heartbeat, await recordHeartbeat(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.heartbeat, req.body))) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/drafts/:stageProblemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.getDraft, await getTrainingDraft(req.user!.userId, req.params.id, req.params.stageProblemId)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.put('/training-sessions/:id/drafts/:stageProblemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.saveDraft, await saveTrainingDraft(req.user!.userId, req.params.id, req.params.stageProblemId, parseContractBody(TrainingContracts.saveDraft, req.body))) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/submit', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.submit, await submitTrainingSolution(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.submit, req.body)), 201) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/hints', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.createHint, await createTrainingHint(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.createHint, req.body)), 201) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.patch('/training-sessions/:id/hints/:hintId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.updateHint, await updateTrainingHint(req.user!.userId, req.params.id, req.params.hintId, parseContractBody(TrainingContracts.updateHint, req.body))) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.delete('/training-sessions/:id/hints/:hintId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.deleteHint, await deleteTrainingHint(req.user!.userId, req.params.id, req.params.hintId)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/problems/:stageProblemId/hints', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.listHints, await listAvailableHints(req.user!.userId, req.params.id, req.params.stageProblemId)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/hints/:hintId/open', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { parseContractBody(TrainingContracts.openHint, req.body); sendContractData(res, TrainingContracts.openHint, await openTrainingHint(req.user!.userId, req.params.id, req.params.hintId)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.post('/training-sessions/:id/strategy-decisions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.recordStrategy, await recordStrategyDecision(req.user!.userId, req.params.id, parseContractBody(TrainingContracts.recordStrategy, req.body)), 201) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/coach-dashboard', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.getCoachDashboard, await getCoachDashboard(req.user!.userId, req.params.id)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/report', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.getReport, await getTrainingReport(req.user!.userId, req.params.id)) } catch (error) { return sendError(error, res) }
}))

trainingEngineRouter.get('/training-sessions/:id/peer-progress', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try { sendContractData(res, TrainingContracts.getPeerProgress, await getTrainingPeerProgress(req.user!.userId, req.params.id)) } catch (error) { return sendError(error, res) }
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
  req.once('close', () => {
    if (closed) return
    closed = true
    trainingMetrics.closeSseConnection()
    clearInterval(pollTimer)
    clearInterval(heartbeatTimer)
  })
}))
