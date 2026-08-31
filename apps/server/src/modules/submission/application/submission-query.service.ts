import { prisma } from '../../../prisma'
import yaml from 'js-yaml'
import { fetchAndStoreCfCode } from '../../../lib/cf-code-fetcher'
import { resolveJudgePresentationConfig } from '../../../lib/judge-mode'
import { canManageTraining } from '../../training/training.helpers'
import {
  CURRENT_JUDGE_RUN_SELECT,
  currentJudgeResultWhere,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'
import { resolveSubmissionIoSnapshot, submissionIoDto } from '../../judge/domain/submission-io'

export interface SubmissionQueryContext {
  userId: string
  role: string
  workspaceScope: string
  organizationId?: string | null
  isGlobalAdmin: boolean
  isPersonal: boolean
}

export class SubmissionQueryError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message)
    this.name = 'SubmissionQueryError'
  }
}

export interface SubmissionListInput {
  username?: string
  oj?: string
  problemId?: string
  result?: string
  language?: string
  page?: string
  pageSize?: string
}

function notFound() {
  return new SubmissionQueryError(404, 'SUBMISSION_NOT_FOUND', '提交记录不存在')
}

export async function listSubmissions(context: SubmissionQueryContext, input: SubmissionListInput) {
  const page = Math.max(Number.parseInt(input.page || '1', 10) || 1, 1)
  const pageSize = Math.min(Math.max(Number.parseInt(input.pageSize || '20', 10) || 20, 1), 100)
  const where: any = context.isGlobalAdmin
    ? {}
    : {
        isGlobalVisible: true,
        workspaceScope: context.workspaceScope,
        organizationId: context.workspaceScope === 'campus' ? context.organizationId || '__missing_organization__' : null,
      }

  if (!context.isGlobalAdmin && (context.isPersonal || context.role === 'student')) {
    where.userId = context.userId
  } else if (!context.isGlobalAdmin && (context.role === 'teacher' || context.role === 'school_principal')) {
    if (!context.organizationId) {
      return { submissions: [], page, totalPages: 0, total: 0, scope: context.workspaceScope }
    }
    const members = await prisma.organizationMembership.findMany({
      where: { organizationId: context.organizationId, status: 'active' },
      select: { userId: true },
    })
    where.userId = { in: members.map(member => member.userId) }
  }

  if (input.username) where.User = { username: { contains: input.username } }
  if (input.oj) where.oj = input.oj
  if (input.problemId) where.problemId = { contains: input.problemId }
  if (input.result) where.AND = [...(where.AND || []), currentJudgeResultWhere(input.result)]
  if (input.language) where.language = input.language

  const [total, submissions] = await prisma.$transaction([
    prisma.submission.count({ where }),
    prisma.submission.findMany({
      where,
      include: {
        User: { select: { username: true, role: true } },
        CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  const internalIds = [...new Set(submissions.map(item => item.problemInternalId).filter((id): id is string => Boolean(id)))]
  const problemVisibility = new Map<string, string>()
  if (internalIds.length) {
    const problems = await prisma.problem.findMany({
      where: { id: { in: internalIds } },
      select: { id: true, visibility: true },
    })
    for (const problem of problems) problemVisibility.set(problem.id, problem.visibility)
  }

  const lookup = new Map<string, string>()
  const byPlatform = new Map<string, Set<string>>()
  for (const submission of submissions) {
    if (submission.problemInternalId) continue
    const ids = byPlatform.get(submission.oj) || new Set<string>()
    ids.add(submission.problemId)
    byPlatform.set(submission.oj, ids)
  }
  for (const [platform, ids] of byPlatform) {
    const problems = await prisma.problem.findMany({
      where: { libraryScope: 'platform', platform, problemId: { in: [...ids] } },
      select: { id: true, problemId: true, visibility: true },
    })
    for (const problem of problems) {
      lookup.set(`${platform}:${problem.problemId}`, problem.id)
      problemVisibility.set(problem.id, problem.visibility)
    }
  }

  return {
    submissions: submissions.map(rawSubmission => {
      const submission = projectSubmissionJudgeResult(rawSubmission)
      const problemInternalId = submission.problemInternalId || lookup.get(`${submission.oj}:${submission.problemId}`) || null
      return {
        id: submission.id,
        userId: submission.userId,
        userType: context.isPersonal
          ? 'user'
          : submission.User.role === 'student'
            ? 'student'
            : submission.User.role === 'teacher' || submission.User.role === 'school_principal'
              ? 'teacher'
              : 'user',
        username: submission.User.username,
        oj: submission.oj,
        problemId: submission.problemId,
        problemInternalId,
        problemVisibility: problemInternalId ? problemVisibility.get(problemInternalId) || null : null,
        result: submission.result,
        score: submission.score,
        timeUsed: submission.timeUsed,
        memoryUsed: submission.memoryUsed,
        codeLength: submission.codeLength,
        language: submission.language,
        ojRemoteId: submission.ojRemoteId,
        submittedAt: submission.createdAt.toISOString(),
        submitScope: submission.submitScope,
      }
    }),
    page,
    totalPages: Math.ceil(total / pageSize),
    total,
    scope: context.isGlobalAdmin ? 'all' : context.workspaceScope,
  }
}

async function requireVisibleSubmission(context: SubmissionQueryContext, submissionId: number) {
  if (!Number.isSafeInteger(submissionId) || submissionId <= 0) throw notFound()
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      User: { select: { username: true, avatar: true, role: true } },
      OjAccount: { select: { username: true } },
      CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT },
    },
  })
  if (!submission) throw notFound()

  let hasContestManagerAccess = false
  if (submission.trainingId) {
    const training = await prisma.training.findUnique({
      where: { id: submission.trainingId },
      select: { id: true, teamId: true, organizationId: true, createdBy: true },
    })
    if (training) hasContestManagerAccess = await canManageTraining(context.userId, training)
  }
  if (!context.isGlobalAdmin && !hasContestManagerAccess) {
    if (
      submission.workspaceScope !== context.workspaceScope
      || (context.workspaceScope === 'campus' && submission.organizationId !== context.organizationId)
    ) throw notFound()
    if (context.isPersonal) {
      if (submission.userId !== context.userId) throw notFound()
    } else if (context.role === 'student' && submission.userId !== context.userId) {
      throw new SubmissionQueryError(403, 'SUBMISSION_FORBIDDEN', '无权查看该提交记录')
    } else if (context.role === 'teacher' || context.role === 'school_principal') {
      if (!context.organizationId) throw new SubmissionQueryError(403, 'SUBMISSION_FORBIDDEN', '无权查看该提交记录')
      const membership = await prisma.organizationMembership.findFirst({
        where: { organizationId: context.organizationId, userId: submission.userId, status: 'active' },
        select: { id: true },
      })
      if (!membership) throw new SubmissionQueryError(403, 'SUBMISSION_FORBIDDEN', '无权查看该提交记录')
    }
  }
  return submission
}

function parseJson(value: string | null) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

export async function getSubmissionDetail(context: SubmissionQueryContext, submissionId: number) {
  const submission = projectSubmissionJudgeResult(await requireVisibleSubmission(context, submissionId))
  let problemTitle: string | null = null
  let problemJudgeConfig: string | null = null
  let problemAlias: string | null = null
  let problemOrderIndex: number | null = null
  let trainingProblemId: string | null = submission.trainingProblemId || null
  let contestFormat: string | null = null

  if (submission.problemInternalId) {
    const problem = await prisma.problem.findUnique({
      where: { id: submission.problemInternalId },
      select: { title: true, libraryScope: true, organizationId: true, judgeConfig: true },
    })
    if (
      problem?.libraryScope === 'school'
      && !context.isGlobalAdmin
      && (context.role === 'teacher' || context.role === 'school_principal')
      && problem.organizationId !== context.organizationId
    ) throw notFound()
    problemTitle = problem?.title || null
    problemJudgeConfig = problem?.judgeConfig || null
  }

  if (submission.trainingId) {
    const training = await prisma.training.findUnique({ where: { id: submission.trainingId }, select: { format: true } })
    contestFormat = training?.format || null
    const trainingProblem = submission.trainingProblemId
      ? await prisma.trainingProblem.findFirst({
          where: { id: submission.trainingProblemId, trainingId: submission.trainingId },
          select: { id: true, alias: true, orderIndex: true, judgeConfigSnapshot: true, Problem: { select: { judgeConfig: true, title: true } } },
        })
      : await prisma.trainingProblem.findFirst({
          where: { trainingId: submission.trainingId, Problem: { problemId: submission.problemId } },
          select: { id: true, alias: true, orderIndex: true, judgeConfigSnapshot: true, Problem: { select: { judgeConfig: true, title: true } } },
        })
    if (trainingProblem) {
      trainingProblemId = trainingProblem.id
      problemAlias = trainingProblem.alias
      problemOrderIndex = trainingProblem.orderIndex
      problemJudgeConfig = trainingProblem.judgeConfigSnapshot || trainingProblem.Problem.judgeConfig || problemJudgeConfig
      problemTitle ||= trainingProblem.Problem.title || null
    }
  }

  const judgePresentation = resolveJudgePresentationConfig(problemJudgeConfig)
  let judgeConfig: any = {}
  try { judgeConfig = yaml.load(problemJudgeConfig || '{}') || {} } catch {}
  const resolvedIo = resolveSubmissionIoSnapshot(submission, judgeConfig)
  return {
    id: submission.id,
    username: submission.User.username,
    submitterName: submission.User.username,
    submitterAvatar: submission.User.avatar,
    oj: submission.oj,
    problemId: submission.problemId,
    problemTitle,
    result: submission.result,
    timeUsed: submission.timeUsed,
    memoryUsed: submission.memoryUsed,
    wallTimeUsed: submission.wallTimeUsed,
    timeoutReason: submission.timeoutReason,
    metricSource: submission.metricSource,
    score: submission.score,
    cases: parseJson(submission.cases),
    subtasks: parseJson(submission.subtasks),
    codeLength: submission.codeLength,
    language: submission.language,
    code: submission.code,
    submitMethod: submission.submitMethod,
    ojRemoteId: submission.ojRemoteId,
    ojAccountUsername: submission.OjAccount?.username,
    submittedAt: submission.createdAt.toISOString(),
    errorMessage: submission.errorMessage,
    judgeMode: judgePresentation.mode,
    judgeConfig: problemJudgeConfig ? { mode: judgePresentation.mode } : undefined,
    trainingId: submission.trainingId,
    trainingProblemId,
    problemAlias,
    problemOrderIndex,
    contestFormat,
    io: submissionIoDto(resolvedIo.inputFile, resolvedIo.outputFile),
  }
}

export async function refetchSubmissionCode(context: SubmissionQueryContext, submissionId: number) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, oj: true, ojRemoteId: true, userId: true, workspaceScope: true, organizationId: true, code: true, codeLength: true },
  })
  if (
    !submission
    || (!context.isGlobalAdmin && (
      submission.workspaceScope !== context.workspaceScope
      || (context.workspaceScope === 'campus' && submission.organizationId !== context.organizationId)
      || submission.userId !== context.userId
    ))
  ) throw notFound()
  if (submission.oj !== 'codeforces') throw new SubmissionQueryError(400, 'UNSUPPORTED_OJ', '仅支持 Codeforces 提交的代码抓取')
  if (!submission.ojRemoteId) throw new SubmissionQueryError(400, 'REMOTE_ID_REQUIRED', '缺少远程提交 ID')

  await prisma.submission.update({ where: { id: submissionId }, data: { code: '', codeLength: 0 } })
  try {
    const fetched = await fetchAndStoreCfCode(submissionId)
    if (!fetched) throw new SubmissionQueryError(502, 'CODE_FETCH_FAILED', '抓取源代码失败，请稍后重试')
  } catch (error) {
    await prisma.submission.updateMany({
      where: { id: submissionId, code: '' },
      data: { code: submission.code, codeLength: submission.codeLength },
    })
    throw error
  }
  const updated = await prisma.submission.findUnique({ where: { id: submissionId }, select: { code: true, codeLength: true } })
  return { code: updated?.code || '', codeLength: updated?.codeLength || 0 }
}
