import { prisma } from '../../../prisma'
import yaml from 'js-yaml'
import { logger } from '../../../lib/logger'
import {
  IdempotencyConflictError,
  requestFingerprint,
  runIdempotent,
} from '../../../lib/idempotency'
import { findUsableProblemByExternalId } from '../../problem/problem.access'
import { ensureInitialTestSetRevision } from '../../problem/problem.testset-revision.service'
import {
  createQueuedSubmissionWithRun,
  rejudgeSubmissionWithRun,
} from '../../judge/application/judge-run.service'
import { normalizeSubmissionIo, SubmissionIoError } from '../../judge/domain/submission-io'

export interface SubmissionCommandContext {
  userId: string
  organizationRole?: 'student' | 'teacher' | 'school_principal' | null
  workspaceScope: string
  organizationId?: string | null
  isGlobalAdmin: boolean
  authUser: any
}

export class SubmissionCommandError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SubmissionCommandError'
  }
}

export interface LocalSubmissionInput {
  problemId?: unknown
  oj?: unknown
  language?: unknown
  code?: unknown
  submitMethod?: unknown
  inputFilename?: unknown
  outputFilename?: unknown
  idempotencyKey?: string | null
}

export async function submitLocalCode(context: SubmissionCommandContext, input: LocalSubmissionInput) {
  const problemId = typeof input.problemId === 'string' || typeof input.problemId === 'number' ? String(input.problemId) : ''
  const oj = typeof input.oj === 'string' ? input.oj : ''
  const language = typeof input.language === 'string' ? input.language : ''
  const code = typeof input.code === 'string' ? input.code : ''
  if (!problemId || !oj || !language || !code.trim()) {
    throw new SubmissionCommandError(400, 'INVALID_SUBMISSION', '缺少必要参数')
  }
  if (input.submitMethod === 'archive') {
    throw new SubmissionCommandError(400, 'USE_ARCHIVE_SYNC', '远程记录请使用平台绑定中的同步归档功能')
  }
  if (context.organizationRole === 'student' && context.workspaceScope !== 'personal') {
    throw new SubmissionCommandError(403, 'TEACHER_ONLY', '校园学生请从作业或比赛提交')
  }

  const problem = await findUsableProblemByExternalId(context.authUser, oj, problemId)
  if (!problem) throw new SubmissionCommandError(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  const testdataCount = await prisma.testdataFile.count({ where: { problemId: problem.id } })
  if (!problem.judgeConfig?.trim() || testdataCount === 0) {
    throw new SubmissionCommandError(409, 'LOCAL_JUDGE_NOT_CONFIGURED', '该题尚未配置完整的本地评测配置和测试数据，请联系题目管理员')
  }

  let revision
  try {
    revision = await ensureInitialTestSetRevision(problem.id, context.userId)
  } catch (error: any) {
    throw new SubmissionCommandError(409, 'TEST_SET_REVISION_REQUIRED', error.message)
  }

  let submissionIo
  try {
    const config = yaml.load(revision?.judgeConfig || problem.judgeConfig || '{}') as any
    submissionIo = normalizeSubmissionIo({
      inputFilename: input.inputFilename,
      outputFilename: input.outputFilename,
      problemType: config?.type,
    })
  } catch (error) {
    if (error instanceof SubmissionIoError) {
      throw new SubmissionCommandError(422, error.code, error.message)
    }
    throw error
  }

  const fingerprint = requestFingerprint({ problemId, oj, language, code, submitMethod: 'local', ...submissionIo })
  let submissionResult
  try {
    submissionResult = await runIdempotent(
      `problem-submit:${context.userId}`,
      input.idempotencyKey || null,
      fingerprint,
      () => createQueuedSubmissionWithRun({
        userId: context.userId,
        workspaceScope: context.workspaceScope,
        organizationId: context.organizationId || null,
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
        testSetRevisionId: revision?.id || null,
        judgeConfigHash: revision?.judgeConfigHash || null,
        ...submissionIo,
      }, { requestedBy: context.userId }),
    )
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      throw new SubmissionCommandError(409, 'IDEMPOTENCY_CONFLICT', error.message)
    }
    throw error
  }

  const submission = submissionResult.value
  if (problem.platform === 'carits' && !submission.ojRemoteId) {
    await prisma.submission.update({ where: { id: submission.id }, data: { ojRemoteId: String(submission.id) } })
  }
  logger.info('local_submission_queued', {
    action: 'submit',
    metadata: { submissionId: submission.id, userId: context.userId, sourcePlatform: problem.platform, problemId: problem.problemId },
  })
  return { submissionId: submission.id, replayed: submissionResult.replayed }
}

export async function rejudgeLocalCode(context: SubmissionCommandContext, submissionId: number) {
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    throw new SubmissionCommandError(400, 'INVALID_SUBMISSION_ID', '缺少 submissionId')
  }
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { userId: true, workspaceScope: true, organizationId: true, submitMethod: true, problemInternalId: true },
  })
  if (
    !submission
    || submission.workspaceScope !== context.workspaceScope
    || (context.workspaceScope === 'campus' && submission.organizationId !== context.organizationId)
    || (!context.isGlobalAdmin && submission.userId !== context.userId)
  ) {
    throw new SubmissionCommandError(404, 'SUBMISSION_NOT_FOUND', '提交记录不存在')
  }
  if (submission.submitMethod === 'archive') return { success: false, message: '远程归档记录不支持重新评测' }
  if (!submission.problemInternalId) return { success: false, message: '提交缺少题目内部 ID' }
  const queued = await rejudgeSubmissionWithRun(submissionId, context.userId)
  if (!queued) return { success: false, message: '提交正在排队或评测中，未重复加入队列' }
  logger.info('rejudge_queued', { action: 'rejudge', metadata: { submissionId } })
  return { success: true, message: '已加入评测队列' }
}
