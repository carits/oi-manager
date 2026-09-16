import { Router } from 'express'
import { authenticate, getAccountRole, getResourceScope, isAdmin } from '../middleware/auth'
import { logger } from '../lib/logger'
import { readIdempotencyKey } from '../lib/idempotency'
import {
  rejudgeLocalCode,
  SubmissionCommandContext,
  SubmissionCommandError,
  submitLocalCode,
} from '../modules/submission/application/submission-command.service'

export const submitRouter = Router()

function commandContext(req: any): SubmissionCommandContext {
  return {
    userId: req.user.userId,
    organizationRole: req.user.organizationRole || null,
    workspaceScope: getResourceScope(req.user),
    organizationId: req.user.organizationId || null,
    isGlobalAdmin: isAdmin(getAccountRole(req.user)!),
    authUser: req.user,
  }
}

function sendCommandError(res: any, error: unknown, fallbackMessage: string) {
  if (error instanceof SubmissionCommandError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
  }
  logger.error('submission_command_error', {
    action: 'submit',
    metadata: { error: error instanceof Error ? error.message : String(error) },
  })
  return res.status(500).json({ success: false, message: fallbackMessage })
}

/** Every source platform uses the local Judge. */
submitRouter.post('/', authenticate, async (req: any, res) => {
  try {
    const result = await submitLocalCode(commandContext(req), {
      ...req.body,
      idempotencyKey: readIdempotencyKey(req),
    })
    return res.json({
      success: true,
      data: { submissionId: result.submissionId, replayed: result.replayed || undefined },
      message: result.replayed ? '已返回同一次提交的结果' : '已加入本地评测队列',
    })
  } catch (error) {
    return sendCommandError(res, error, '提交失败')
  }
})

submitRouter.post('/rejudge', authenticate, async (req: any, res) => {
  try {
    const result = await rejudgeLocalCode(commandContext(req), Number(req.body?.submissionId))
    return res.json(result)
  } catch (error) {
    return sendCommandError(res, error, '重评失败')
  }
})
