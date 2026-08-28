import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import {
  createProblemHackAttempt,
  getProblemHackAttempt,
  getProblemHackConfig,
  listProblemHackAttempts,
  ProblemHackRouteError,
  retryProblemHackAttempt,
  saveProblemHackConfig,
} from './application/problem-hack-route.service'

export const problemHackRouter = Router()

function sendHackError(error: unknown, res: any) {
  if (!(error instanceof ProblemHackRouteError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
    ...(error.data !== undefined ? { data: error.data } : {}),
  })
}

problemHackRouter.get('/:id/hack-config', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getProblemHackConfig(req.user!, req.params.id)
    return res.json({ success: true, data })
  } catch (error) {
    return sendHackError(error, res)
  }
}))

problemHackRouter.put('/:id/hack-config', authenticate, asyncHandler(async (req, res) => {
  try {
    const result = await saveProblemHackConfig({
      user: req.user!,
      problemId: req.params.id,
      body: req.body,
    })
    return res.json({ success: true, data: result.config, message: result.message })
  } catch (error) {
    return sendHackError(error, res)
  }
}))

problemHackRouter.post('/:id/hacks', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await createProblemHackAttempt({
      user: req.user!,
      problemId: req.params.id,
      body: req.body,
    })
    return res.status(202).json({
      success: true,
      data,
      message: 'Hack 已加入独立评测队列',
    })
  } catch (error) {
    return sendHackError(error, res)
  }
}))

problemHackRouter.get('/:id/hacks', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await listProblemHackAttempts({
      user: req.user!,
      problemId: req.params.id,
      pageValue: req.query.page,
      pageSizeValue: req.query.pageSize,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendHackError(error, res)
  }
}))

problemHackRouter.get('/:id/hacks/:hackId', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await getProblemHackAttempt(req.user!, req.params.id, req.params.hackId)
    return res.json({ success: true, data })
  } catch (error) {
    return sendHackError(error, res)
  }
}))

problemHackRouter.post('/:id/hacks/:hackId/retry', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await retryProblemHackAttempt(req.user!, req.params.id, req.params.hackId)
    return res.json({ success: true, data, message: 'Hack 已重新加入队列' })
  } catch (error) {
    return sendHackError(error, res)
  }
}))
