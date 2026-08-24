import { Router } from 'express'
import { authenticate, getResourceScope, isAdmin, isPersonalContext } from '../middleware/auth'
import { prisma } from '../prisma'
import { logger } from '../lib/logger'
import { rejudgeSubmission } from '../ws/judge'
import {
  IdempotencyConflictError,
  readIdempotencyKey,
  requestFingerprint,
  runIdempotent,
} from '../lib/idempotency'
import { findUsableProblemByExternalId } from '../modules/problem/problem.access'

export const submitRouter = Router()

/**
 * POST /api/submit
 *
 * `oj` identifies the problem source. It never selects the execution backend:
 * every code submission is evaluated by the local judge. Remote submissions are
 * imported separately by platform archive endpoints with submitMethod=archive.
 */
submitRouter.post('/', authenticate, async (req: any, res) => {
  try {
    const { problemId, oj, language, code } = req.body
    const userId = req.user.userId

    if (!problemId || !oj || !language || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ success: false, message: '缺少必要参数' })
    }

    if (req.body.submitMethod === 'archive') {
      return res.status(400).json({
        success: false,
        code: 'USE_ARCHIVE_SYNC',
        message: '远程记录请使用平台绑定中的同步归档功能',
      })
    }

    if (req.user.role === 'student' && !isPersonalContext(req.user)) {
      return res.status(403).json({ success: false, code: 'TEACHER_ONLY', message: '校园学生请从作业或比赛提交' })
    }

    const problem = await findUsableProblemByExternalId(req.user, String(oj), String(problemId))
    if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
    const testdataCount = await prisma.testdataFile.count({ where: { problemId: problem.id } })
    if (!problem.judgeConfig?.trim() || testdataCount === 0) {
      return res.status(409).json({
        success: false,
        code: 'LOCAL_JUDGE_NOT_CONFIGURED',
        message: '该题尚未配置完整的本地评测配置和测试数据，请联系题目管理员',
      })
    }

    const idempotencyKey = readIdempotencyKey(req)
    const fingerprint = requestFingerprint({ problemId, oj, language, code, submitMethod: 'local' })
    let submissionResult
    try {
      submissionResult = await runIdempotent(
        `problem-submit:${userId}`,
        idempotencyKey,
        fingerprint,
        () => prisma.submission.create({
          data: {
            userId,
            workspaceScope: getResourceScope(req.user),
            organizationId: req.user.organizationId || null,
            oj: problem.platform,
            problemId: problem.problemId,
            problemInternalId: problem.id,
            language,
            code,
            codeLength: Buffer.byteLength(code, 'utf8'),
            result: 'queuing',
            submitMethod: 'local',
            submitScope: 'problem',
            isGlobalVisible: true,
          },
        }),
      )
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return res.status(409).json({ success: false, code: 'IDEMPOTENCY_CONFLICT', message: error.message })
      }
      throw error
    }

    const submission = submissionResult.value
    if (problem.platform === 'carits' && !submission.ojRemoteId) {
      await prisma.submission.update({ where: { id: submission.id }, data: { ojRemoteId: String(submission.id) } })
    }

    logger.info('local_submission_queued', {
      action: 'submit',
      metadata: { submissionId: submission.id, userId, sourcePlatform: problem.platform, problemId: problem.problemId },
    })
    return res.json({
      success: true,
      data: { submissionId: submission.id, replayed: submissionResult.replayed || undefined },
      message: submissionResult.replayed ? '已返回同一次提交的结果' : '已加入本地评测队列',
    })
  } catch (error: any) {
    logger.error('submit_error', { action: 'submit', metadata: { error: error.message } })
    return res.status(500).json({ success: false, message: '提交失败' })
  }
})

/** POST /api/submit/rejudge - requeue a local submission. */
submitRouter.post('/rejudge', authenticate, async (req: any, res) => {
  try {
    const submissionId = Number(req.body?.submissionId)
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ success: false, message: '缺少 submissionId' })
    }
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { userId: true, workspaceScope: true, organizationId: true },
    })
    const workspaceScope = getResourceScope(req.user)
    if (
      !submission
      || submission.workspaceScope !== workspaceScope
      || (workspaceScope === 'campus' && submission.organizationId !== req.user.organizationId)
      || (!isAdmin(req.user.role) && submission.userId !== req.user.userId)
    ) {
      return res.status(404).json({ success: false, message: '提交记录不存在' })
    }
    return res.json(await rejudgeSubmission(submissionId))
  } catch (error: any) {
    logger.error('rejudge_error', { action: 'rejudge', metadata: { error: error.message } })
    return res.status(500).json({ success: false, message: '重评失败' })
  }
})
