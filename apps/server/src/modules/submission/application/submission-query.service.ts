import { prisma } from '../../../prisma'
import yaml from 'js-yaml'
import { resolveJudgePresentationConfig } from '../../../lib/judge-mode'
import {
  canAccessTraining,
  canManageTraining,
  requireTrainingStarted,
} from '../../training/training.helpers'
import {
  getTrainingRuntimeStatus,
  shouldHideTrainingProblemSource,
} from '../../training/training.visibility'
import {
  CURRENT_JUDGE_RUN_SELECT,
  currentJudgeResultWhere,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'
import { resolveSubmissionIoSnapshot, submissionIoDto } from '../../judge/domain/submission-io'
import { findActivityForSubmission } from '../../contest/contest-query.facade'
import { organizationRoleFromRoleKeys } from '../../authorization/capabilities'

export interface SubmissionQueryContext {
  userId: string
  organizationRole?: 'student' | 'teacher' | 'school_principal' | null
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

  // Internal Judge-backed workflows (for example solution/editorial verification)
  // deliberately reuse Submission/JudgeRun for execution, but are not user
  // submissions. Keep them out of the ordinary submission ledger for every
  // role, including global administrators; their owning domain exposes a
  // dedicated, audited review surface instead.
  where.submitScope = { not: 'solution_verification' }

  if (!context.isGlobalAdmin && (context.isPersonal || context.organizationRole === 'student')) {
    where.userId = context.userId
  } else if (!context.isGlobalAdmin && (context.organizationRole === 'teacher' || context.organizationRole === 'school_principal')) {
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
        User: {
          select: {
            username: true,
            OrganizationMembership: {
              where: { status: 'active' },
              select: {
                organizationId: true,
                RoleAssignments: { select: { roleKey: true } },
              },
            },
          },
        },
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
      const membership = submission.User.OrganizationMembership.find(item => item.organizationId === submission.organizationId)
      const organizationRole = membership
        ? organizationRoleFromRoleKeys(membership.RoleAssignments.map(item => item.roleKey))
        : null
      return {
        id: submission.id,
        userId: submission.userId,
        userType: context.isPersonal
          ? 'user'
          : organizationRole === 'student'
            ? 'student'
            : organizationRole === 'teacher' || organizationRole === 'school_principal'
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
async function requireVisibleSubmission(
  context: SubmissionQueryContext,
  submissionId: number,
  expectedTrainingId?: number,
) {
  if (!Number.isSafeInteger(submissionId) || submissionId <= 0) throw notFound()
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      User: { select: { username: true, avatar: true } },
      OjAccount: { select: { username: true } },
      CanonicalContest: { select: { publicId: true } },
      CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT },
    },
  })
  if (!submission) throw notFound()

  let training: {
    id: number
    teamId: string | null
    organizationId: string | null
    createdBy: string
    format: string
    type: string
    status: string
    startTime: Date
    endTime: Date
    problemIdVisible: boolean
    scope: string
  } | null = null
  let hasContestManagerAccess = false
  const activityPublicId = expectedTrainingId
    ?? submission.trainingId
    ?? submission.CanonicalContest?.publicId
    ?? null
  if (activityPublicId !== null) {
    const activity = await findActivityForSubmission(activityPublicId)
    if (!activity) throw notFound()
    if (expectedTrainingId !== undefined) {
      if (activity.source === 'contest') {
        if (submission.canonicalContestId !== activity.contest.id) throw notFound()
      } else if (submission.trainingId !== activity.activity.id) {
        throw notFound()
      }
    }
    training = activity.activity
    hasContestManagerAccess = context.isGlobalAdmin || await canManageTraining(context.userId, training)

    if (!hasContestManagerAccess) {
      if (!await canAccessTraining(context.userId, training)) {
        throw new SubmissionQueryError(403, 'SUBMISSION_FORBIDDEN', '无权查看该提交记录')
      }
      const notStarted = await requireTrainingStarted(training, context.userId)
      if (notStarted) {
        throw new SubmissionQueryError(403, 'TRAINING_NOT_STARTED', notStarted)
      }
      if (submission.userId !== context.userId) {
        throw new SubmissionQueryError(403, 'SUBMISSION_FORBIDDEN', '无权查看他人评测记录')
      }
    }
  }
  if (activityPublicId === null && !context.isGlobalAdmin) {
    if (
      submission.workspaceScope !== context.workspaceScope
      || (context.workspaceScope === 'campus' && submission.organizationId !== context.organizationId)
    ) throw notFound()
    if (context.isPersonal) {
      if (submission.userId !== context.userId) throw notFound()
    } else if (context.organizationRole === 'student' && submission.userId !== context.userId) {
      throw new SubmissionQueryError(403, 'SUBMISSION_FORBIDDEN', '无权查看该提交记录')
    } else if (context.organizationRole === 'teacher' || context.organizationRole === 'school_principal') {
      if (!context.organizationId) throw new SubmissionQueryError(403, 'SUBMISSION_FORBIDDEN', '无权查看该提交记录')
      const membership = await prisma.organizationMembership.findFirst({
        where: { organizationId: context.organizationId, userId: submission.userId, status: 'active' },
        select: { id: true },
      })
      if (!membership) throw new SubmissionQueryError(403, 'SUBMISSION_FORBIDDEN', '无权查看该提交记录')
    }
  }
  return { submission, training, hasContestManagerAccess }
}

function parseJson(value: string | null) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

export async function getSubmissionDetail(
  context: SubmissionQueryContext,
  submissionId: number,
  expectedTrainingId?: number,
) {
  const access = await requireVisibleSubmission(context, submissionId, expectedTrainingId)
  const submission = projectSubmissionJudgeResult(access.submission)
  let problemTitle: string | null = null
  let problemJudgeConfig: string | null = null
  let problemAlias: string | null = null
  let problemOrderIndex: number | null = null
  let trainingProblemId: string | null = submission.trainingProblemId || null
  let contestFormat: string | null = null
  let sourcePlatform: string | null = submission.oj || null
  let sourceProblemId: string | null = submission.problemId || null

  if (submission.problemInternalId) {
    const problem = await prisma.problem.findUnique({
      where: { id: submission.problemInternalId },
      select: { title: true, platform: true, problemId: true, libraryScope: true, organizationId: true, judgeConfig: true },
    })
    if (
      problem?.libraryScope === 'school'
      && !context.isGlobalAdmin
      && (context.organizationRole === 'teacher' || context.organizationRole === 'school_principal')
      && problem.organizationId !== context.organizationId
    ) throw notFound()
    problemTitle = problem?.title || null
    problemJudgeConfig = problem?.judgeConfig || null
    sourcePlatform = problem?.platform || sourcePlatform
    sourceProblemId = problem?.problemId || sourceProblemId
  }

  if (submission.canonicalContestId && access.training) {
    contestFormat = access.training.format || null
    const contestProblem = await prisma.contestProblem.findFirst({
      where: {
        contestId: submission.canonicalContestId,
        OR: [
          ...(submission.canonicalContestProblemId ? [{ id: submission.canonicalContestProblemId }] : []),
          { problemId: submission.problemId },
          { CanonicalProblem: { problemId: submission.problemId } },
        ],
      },
      select: {
        id: true,
        alias: true,
        orderIndex: true,
        title: true,
        ojName: true,
        problemId: true,
        CanonicalProblem: {
          select: { judgeConfig: true, title: true, platform: true, problemId: true },
        },
      },
    })
    if (contestProblem) {
      trainingProblemId = contestProblem.id
      problemAlias = contestProblem.alias
      problemOrderIndex = contestProblem.orderIndex
      problemJudgeConfig = contestProblem.CanonicalProblem?.judgeConfig || problemJudgeConfig
      problemTitle = contestProblem.title || contestProblem.CanonicalProblem?.title || problemTitle
      sourcePlatform = contestProblem.ojName || contestProblem.CanonicalProblem?.platform || sourcePlatform
      sourceProblemId = contestProblem.problemId || contestProblem.CanonicalProblem?.problemId || sourceProblemId
    }
  } else if (submission.trainingId && access.training) {
    contestFormat = access.training.format || null
    const trainingProblem = submission.trainingProblemId
      ? await prisma.trainingProblem.findFirst({
          where: { id: submission.trainingProblemId, trainingId: submission.trainingId },
          select: {
            id: true,
            alias: true,
            orderIndex: true,
            titleSnapshot: true,
            judgeConfigSnapshot: true,
            sourcePlatformSnapshot: true,
            sourceProblemIdSnapshot: true,
            Problem: { select: { judgeConfig: true, title: true, platform: true, problemId: true } },
          },
        })
      : await prisma.trainingProblem.findFirst({
          where: { trainingId: submission.trainingId, Problem: { problemId: submission.problemId } },
          select: {
            id: true,
            alias: true,
            orderIndex: true,
            titleSnapshot: true,
            judgeConfigSnapshot: true,
            sourcePlatformSnapshot: true,
            sourceProblemIdSnapshot: true,
            Problem: { select: { judgeConfig: true, title: true, platform: true, problemId: true } },
          },
        })
    if (trainingProblem) {
      trainingProblemId = trainingProblem.id
      problemAlias = trainingProblem.alias
      problemOrderIndex = trainingProblem.orderIndex
      problemJudgeConfig = trainingProblem.judgeConfigSnapshot || trainingProblem.Problem.judgeConfig || problemJudgeConfig
      problemTitle = trainingProblem.titleSnapshot || trainingProblem.Problem.title || problemTitle
      sourcePlatform = trainingProblem.sourcePlatformSnapshot || trainingProblem.Problem.platform || sourcePlatform
      sourceProblemId = trainingProblem.sourceProblemIdSnapshot || trainingProblem.Problem.problemId || sourceProblemId
    }
  }

  const judgePresentation = resolveJudgePresentationConfig(problemJudgeConfig)
  let judgeConfig: any = {}
  try { judgeConfig = yaml.load(problemJudgeConfig || '{}') || {} } catch {}
  const resolvedIo = resolveSubmissionIoSnapshot(submission, judgeConfig)
  const hideOiDetail = Boolean(
    access.training
    && access.training.format === 'oi'
    && getTrainingRuntimeStatus(access.training) !== 'finished'
    && !access.hasContestManagerAccess,
  )
  const hideProblemIdentity = access.training
    ? shouldHideTrainingProblemSource(access.training, access.hasContestManagerAccess)
    : false
  const isActivitySubmission = Boolean(access.training)
  const canViewCode = !isActivitySubmission
    || submission.userId === context.userId
    || access.hasContestManagerAccess
  const hideRemoteId = Boolean(isActivitySubmission && !access.hasContestManagerAccess)

  return {
    id: submission.id,
    userId: submission.userId,
    username: submission.User.username,
    submitterName: submission.User.username,
    submitterAvatar: submission.User.avatar,
    oj: hideProblemIdentity ? undefined : submission.oj,
    problemId: problemAlias || submission.problemId,
    problemTitle: hideProblemIdentity ? null : problemTitle,
    problemSourceHidden: hideProblemIdentity,
    sourcePlatform: hideProblemIdentity ? undefined : sourcePlatform,
    sourceProblemId: hideProblemIdentity ? undefined : sourceProblemId,
    hidden: hideOiDetail,
    displayResult: hideOiDetail ? 'pending' : submission.result,
    result: hideOiDetail ? null : submission.result,
    timeUsed: hideOiDetail ? null : submission.timeUsed,
    memoryUsed: hideOiDetail ? null : submission.memoryUsed,
    wallTimeUsed: hideOiDetail ? null : submission.wallTimeUsed,
    timeoutReason: hideOiDetail ? null : submission.timeoutReason,
    metricSource: hideOiDetail ? null : submission.metricSource,
    score: hideOiDetail ? null : submission.score,
    cases: hideOiDetail ? null : parseJson(submission.cases),
    subtasks: hideOiDetail ? null : parseJson(submission.subtasks),
    codeLength: submission.codeLength,
    language: submission.language,
    code: canViewCode ? submission.code : null,
    canViewCode,
    submitMethod: submission.submitMethod,
    ojRemoteId: hideRemoteId ? null : submission.ojRemoteId,
    hideRemoteId,
    ojAccountUsername: hideRemoteId ? null : submission.OjAccount?.username,
    submittedAt: submission.createdAt.toISOString(),
    errorMessage: hideOiDetail ? null : submission.errorMessage,
    judgeMode: judgePresentation.mode,
    judgeConfig: problemJudgeConfig ? { mode: judgePresentation.mode } : undefined,
    trainingId: access.training?.id ?? submission.trainingId,
    trainingProblemId,
    problemAlias,
    problemOrderIndex,
    contestFormat,
    io: submissionIoDto(resolvedIo.inputFile, resolvedIo.outputFile),
  }
}
