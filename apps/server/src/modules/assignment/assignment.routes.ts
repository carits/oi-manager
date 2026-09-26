import { Router, type Response } from 'express'
import { AssignmentContracts } from '@oi-manager/contracts'
import type { AuthRequest } from '../../middleware/auth'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../../lib/api-contract'
import {
  AssignmentError,
  adjustAssignmentScore,
  assertAssignmentOrganizationContext,
  createAssignmentCorrection,
  createAssignmentFeedback,
  createAssignment,
  getAssignment,
  getAssignmentProgress,
  getAssignmentWorkspace,
  listAssignments,
  publishAssignment,
  replaceAssignmentProblems,
  replaceAssignmentRoster,
  reverseAssignmentScoreAdjustment,
  submitAssignmentSolution,
  setManualAssignmentProblemCompletion,
  transitionAssignment,
  updateAssignment,
  validateAssignmentStructure,
} from './assignment.service'

export const assignmentRouter = Router()

function sendError(error: unknown, res: Response) {
  if (sendContractError(error, res)) return res
  if (error instanceof AssignmentError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message, ...(error.details === undefined ? {} : { data: error.details }) })
  }
  throw error
}

assignmentRouter.use('/assignments', authenticate)

assignmentRouter.get('/assignments', asyncHandler(async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user!.organizationId
    if (organizationId && req.query.organizationId && String(req.query.organizationId) !== organizationId) {
      return res.status(403).json({ success: false, code: 'ORGANIZATION_CONTEXT_REQUIRED', message: '不能在当前学校上下文查看其他学校的作业' })
    }
    const query = organizationId ? { ...req.query, organizationId } : req.query
    return res.json({ success: true, data: await listAssignments(req.user!.userId, query) })
  }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.post('/assignments', asyncHandler(async (req: AuthRequest, res) => {
  try {
    const parsed = parseContractBody(AssignmentContracts.create, req.body)
    const organizationId = req.user!.organizationId
    if (organizationId && parsed.organizationId && parsed.organizationId !== organizationId) {
      return res.status(403).json({ success: false, code: 'ORGANIZATION_CONTEXT_REQUIRED', message: '不能在当前学校上下文为其他学校创建作业' })
    }
    const body = organizationId ? { ...parsed, organizationId } : parsed
    return sendContractData(res, AssignmentContracts.create, await createAssignment(req.user!.userId, body), 201)
  }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.use('/assignments/:id', asyncHandler(async (req: AuthRequest, res, next) => {
  const organizationId = req.user!.organizationId
  if (!organizationId) return next()
  await assertAssignmentOrganizationContext(req.params.id, organizationId)
  next()
}, '校验作业组织上下文失败'))

assignmentRouter.get('/assignments/:id', asyncHandler(async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await getAssignment(req.user!.userId, req.params.id) }) }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.get('/assignments/:id/workspace', asyncHandler(async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await getAssignmentWorkspace(req.user!.userId, req.params.id) }) }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.patch('/assignments/:id', asyncHandler(async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await updateAssignment(req.user!.userId, req.params.id, req.body) }) }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.put('/assignments/:id/problems', asyncHandler(async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await replaceAssignmentProblems(req.user!.userId, req.params.id, req.body) }) }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.put('/assignments/:id/roster', asyncHandler(async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await replaceAssignmentRoster(req.user!.userId, req.params.id, req.body) }) }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.post('/assignments/:id/validate', asyncHandler(async (req: AuthRequest, res) => {
  try { return sendContractData(res, AssignmentContracts.validate, await validateAssignmentStructure(req.user!.userId, req.params.id)) }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.post('/assignments/:id/publish', asyncHandler(async (req: AuthRequest, res) => {
  try { return res.json({ success: true, data: await publishAssignment(req.user!.userId, req.params.id, Number(req.body?.expectedRevision)) }) }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.post('/assignments/:id/submit', asyncHandler(async (req: AuthRequest, res) => {
  try { return res.status(201).json({ success: true, data: await submitAssignmentSolution(req.user!.userId, req.params.id, req.body) }) }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.get('/assignments/:id/progress', asyncHandler(async (req: AuthRequest, res) => {
  try {
    const query = parseContractQuery(AssignmentContracts.progress, req.query)
    return sendContractData(res, AssignmentContracts.progress, await getAssignmentProgress(req.user!.userId, req.params.id, query))
  }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.post('/assignments/:id/progress/:progressId/manual-completion', asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(AssignmentContracts.manualCompletion, req.body)
    return sendContractData(res, AssignmentContracts.manualCompletion, await setManualAssignmentProblemCompletion(req.user!.userId, req.params.id, req.params.progressId, body))
  }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.post('/assignments/:id/corrections', asyncHandler(async (req: AuthRequest, res) => {
  try { return res.status(201).json({ success: true, data: await createAssignmentCorrection(req.user!.userId, req.params.id, req.body) }) }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.post('/assignments/:id/feedback', asyncHandler(async (req: AuthRequest, res) => {
  try { return res.status(201).json({ success: true, data: await createAssignmentFeedback(req.user!.userId, req.params.id, req.body) }) }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.post('/assignments/:id/score-adjustments', asyncHandler(async (req: AuthRequest, res) => {
  try { return res.status(201).json({ success: true, data: await adjustAssignmentScore(req.user!.userId, req.params.id, req.body) }) }
  catch (error) { return sendError(error, res) }
}))

assignmentRouter.post('/assignments/:id/score-adjustments/:adjustmentId/reverse', asyncHandler(async (req: AuthRequest, res) => {
  try { return res.status(201).json({ success: true, data: await reverseAssignmentScoreAdjustment(req.user!.userId, req.params.id, req.params.adjustmentId, req.body) }) }
  catch (error) { return sendError(error, res) }
}))

function lifecycle(action: 'close' | 'review' | 'release' | 'archive' | 'cancel') {
  return asyncHandler(async (req: AuthRequest, res) => {
    try { return res.json({ success: true, data: await transitionAssignment(req.user!.userId, req.params.id, action, Number(req.body?.expectedRevision)) }) }
    catch (error) { return sendError(error, res) }
  })
}

assignmentRouter.post('/assignments/:id/close', lifecycle('close'))
assignmentRouter.post('/assignments/:id/review', lifecycle('review'))
assignmentRouter.post('/assignments/:id/release', lifecycle('release'))
assignmentRouter.post('/assignments/:id/archive', lifecycle('archive'))
assignmentRouter.post('/assignments/:id/cancel', lifecycle('cancel'))
