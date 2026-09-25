import { prisma } from '../../../prisma'
import { fileService } from '../../../lib/storage'
import { getAdapter, getSupportedPlatforms } from '../../../oj-adapters'
import {
  canAccessContest,
  canManageContest,
  requireContestStarted,
} from '../contest.helpers'
import { shouldHideContestProblemSource } from '../contest.visibility'
import { buildContestProblemStatus } from '../contest.problem-status'
import { synchronizeContestStatus } from './contest-crud.service'
import {
  CURRENT_JUDGE_RUN_SELECT,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'
import {
  findActivityForAccess,
  findActivityForOverview,
} from '../../contest/contest-query.facade'

export class ContestMiscError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
function fail(statusCode: number, code: string, message: string): never {
  throw new ContestMiscError(statusCode, code, message)
}

const managedFilePatterns = [
  /\/api\/files\/([^/?#]+)\/(?:download|public)/g,
  /\/api\/files\/download\/([^/?#]+)/g,
]

function extractManagedFileId(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null
  for (const pattern of managedFilePatterns) {
    pattern.lastIndex = 0
    const match = pattern.exec(fileUrl)
    if (match?.[1]) return match[1]
  }
  return null
}

function contestFileUrl(contestId: number, contestProblemId: string, fileUrl: string | null | undefined) {
  const fileId = extractManagedFileId(fileUrl)
  return fileId
    ? `/api/contests/${contestId}/problems/${contestProblemId}/files/${fileId}`
    : fileUrl ?? null
}

function rewriteContestFileUrls(contestId: number, contestProblemId: string, content: string) {
  let rewritten = content
  for (const pattern of managedFilePatterns) {
    pattern.lastIndex = 0
    rewritten = rewritten.replace(pattern, (_url, fileId: string) =>
      `/api/contests/${contestId}/problems/${contestProblemId}/files/${fileId}`)
  }
  return rewritten
}

async function requireAccessibleContest(id: number, userId: string, hidden = false) {
  const contest = (await findActivityForAccess(id))?.activity || null
  if (!contest || !await canAccessContest(userId, contest)) {
    fail(hidden ? 404 : contest ? 403 : 404, hidden ? 'RESOURCE_NOT_FOUND' : contest ? 'TRAINING_ACCESS_DENIED' : 'TRAINING_NOT_FOUND', hidden ? '资源不存在' : contest ? '无权限' : '训练不存在')
  }
  return contest
}

export async function getContestOverview(id: number, userId: string) {
  const contest = (await findActivityForOverview(id))?.activity || null
  if (!contest) fail(404, 'TRAINING_NOT_FOUND', '训练不存在')
  if (!await canAccessContest(userId, contest)) fail(403, 'TRAINING_ACCESS_DENIED', '无权查看该训练')

  const status = await synchronizeContestStatus(contest, new Date())
  const isAdmin = await canManageContest(userId, contest)
  const canSeeProblems = status !== 'upcoming' || isAdmin
  const submissions = canSeeProblems
    ? await prisma.submission.findMany({
        where: {
          submitScope: 'contest',
          canonicalContestId: (contest as any).canonicalContestId,
          userId,
        },
        select: {
          canonicalContestProblemId: true, oj: true, problemId: true,
          CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT },
        },
        orderBy: { createdAt: 'asc' },
      }).then(rows => rows.map(projectSubmissionJudgeResult))
    : []
  const platformLabels = new Map<string, string>([
    ...getSupportedPlatforms().map(platform => [platform.platform, platform.name] as [string, string]),
    ['carits', 'Carits'],
  ])
  const hideOiStatus = contest.format === 'oi' && status !== 'finished' && !isAdmin
  const hideProblemIdentity = shouldHideContestProblemSource(contest, isAdmin)
  const problems = canSeeProblems
    ? contest.ContestProblem.map((problem: any) => {
        const summary = {
          id: problem.id,
          points: problem.points,
          hasSolution: Boolean(problem.ContestSolution),
          solutionVisible: problem.ContestSolution?.visible ?? false,
          attachmentCount: (problem.Problem._count?.ProblemAttachment ?? 0) + problem._count.ContestAttachment,
          problemSourceHidden: hideProblemIdentity,
          orderIndex: problem.orderIndex,
          difficulty: problem.Problem.difficulty,
          timeLimit: problem.Problem.timeLimit,
          memoryLimit: problem.Problem.memoryLimit,
        }
        return hideProblemIdentity ? summary : {
          ...summary,
          alias: problem.alias,
          problemTitle: problem.Problem.title,
          problemId: problem.Problem.id,
          platform: problem.Problem.platform,
          platformProblemId: problem.Problem.problemId,
        }
      })
    : []
  const problemStatus = canSeeProblems
    ? contest.ContestProblem.map((problem: any) => {
        const platform = problem.Problem.platform
        const platformProblemId = problem.Problem.problemId
        const matching = submissions.filter(submission =>
          submission.canonicalContestProblemId === problem.id ||
          submission.problemId === platformProblemId ||
          submission.problemId === `${platform}:${platformProblemId}`)
        const itemStatus = buildContestProblemStatus(contest.format, matching)
        let problemUrl: string | null = null
        try {
          problemUrl = platform === 'carits'
            ? '__carits__'
            : platform ? getAdapter(platform as any).getProblemUrl(platformProblemId) : null
        } catch {
          problemUrl = null
        }
        return {
          id: problem.id,
          points: problem.points,
          problemSourceHidden: hideProblemIdentity,
          orderIndex: problem.orderIndex,
          ...(!hideProblemIdentity ? {
            alias: problem.alias,
            title: problem.Problem.title,
            problemTitle: problem.Problem.title,
            platform,
            platformProblemId,
            problemTableId: problem.Problem.id,
            platformLabel: platformLabels.get(platform as any) || platform || '',
            problemUrl,
          } : {}),
          hasSubmitted: itemStatus.hasSubmitted,
          bestScore: hideOiStatus ? null : itemStatus.bestScore,
          bestResult: hideOiStatus ? null : itemStatus.bestResult,
          latestResult: hideOiStatus ? null : itemStatus.latestResult,
          hasAccepted: itemStatus.hasAccepted,
          displayStatus: hideOiStatus
            ? itemStatus.hasSubmitted ? 'submitted' : null
            : itemStatus.displayStatus,
        }
      })
    : []
  return {
    contest: {
      id: contest.id,
      teamId: contest.teamId,
      organizationId: contest.organizationId,
      title: contest.title,
      description: contest.description,
      format: contest.format,
      startTime: contest.startTime.toISOString(),
      endTime: contest.endTime.toISOString(),
      status,
      createdBy: contest.createdBy,
      problemIdVisible: contest.problemIdVisible,
      solutionVisible: contest.solutionVisible,
      includeAdminInRanking: contest.includeAdminInRanking,
      type: contest.type,
      problemCount: contest._count.ContestProblem,
      participantCount: contest._count.ContestParticipant,
      isAdmin,
      createdAt: contest.createdAt.toISOString(),
    },
    problems,
    problemStatus,
  }
}

export async function getContestSolutions(id: number, userId: string) {
  const contest = await requireAccessibleContest(id, userId)
  const isAdmin = await canManageContest(userId, contest)
  if (!(isAdmin || contest.solutionVisible || contest.status === 'finished' || new Date() > contest.endTime)) return {}
  const contestRow = await prisma.contest.findUnique({ where: { publicId: id }, select: { id: true } })
  if (!contestRow) return {}
  const problems = await prisma.contestProblem.findMany({
    where: { contestId: contestRow.id },
    include: {
      ContestResource: true,
      CanonicalProblem: { include: { ProblemStatement: { where: { type: 'solution', isVisible: true }, orderBy: { createdAt: 'asc' }, take: 1 } } },
    },
    orderBy: { orderIndex: 'asc' },
  })
  const solutions: Record<string, any> = {}
  for (const item of problems) {
    const resource = item.ContestResource.find(file => file.fileType === 'solution')
    if (item.solutionType !== 'none') {
      solutions[item.id] = {
        content: item.solutionMarkdown ? rewriteContestFileUrls(id, item.id, item.solutionMarkdown) : '',
        visible: true, source: 'contest', solutionType: item.solutionType,
        format: item.solutionType, fileUrl: resource?.fileUrl ? contestFileUrl(id, item.id, resource.fileUrl) : null,
      }
      continue
    }
    const canonical = item.CanonicalProblem
    if (canonical?.solutionType !== 'none' && canonical?.solutionMarkdown) {
      solutions[item.id] = {
        content: rewriteContestFileUrls(id, item.id, canonical.solutionMarkdown), visible: true,
        source: 'problem', solutionType: canonical.solutionType,
        solutionPdfUrl: contestFileUrl(id, item.id, canonical.solutionPdfUrl),
      }
      continue
    }
    const statement = canonical?.ProblemStatement[0]
    if (statement?.content) solutions[item.id] = {
      content: rewriteContestFileUrls(id, item.id, statement.content), visible: true,
      source: 'problem', format: statement.format, language: statement.language,
      fileUrl: contestFileUrl(id, item.id, statement.fileUrl),
    }
  }
  return solutions
}

export async function getContestAttachments(id: number, userId: string) {
  const contest = await requireAccessibleContest(id, userId)
  const notStarted = await requireContestStarted(contest, userId)
  if (notStarted) fail(403, 'CONTEST_NOT_STARTED', notStarted)
  const contestRow = await prisma.contest.findUnique({ where: { publicId: id }, select: { id: true } })
  if (!contestRow) return {}
  const problems = await prisma.contestProblem.findMany({
    where: { contestId: contestRow.id },
    include: {
      ContestResource: { where: { fileType: { notIn: ['statement', 'solution'] } }, orderBy: { uploadedAt: 'desc' } },
      CanonicalProblem: { include: { ProblemAttachment: { orderBy: { uploadedAt: 'desc' } } } },
    },
    orderBy: { orderIndex: 'asc' },
  })
  const isAdmin = await canManageContest(userId, contest)
  const hideIdentity = shouldHideContestProblemSource(contest, isAdmin)
  return Object.fromEntries(problems.map(item => [item.id, [
    ...item.ContestResource.map((file, index) => ({
      id: file.id, fileName: hideIdentity ? `比赛附件 ${index + 1}` : file.fileName,
      fileUrl: contestFileUrl(id, item.id, file.fileUrl), fileSize: 0,
      uploadedBy: file.uploadedBy, uploadedAt: file.uploadedAt.toISOString(),
    })),
    ...(item.CanonicalProblem?.ProblemAttachment || []).map((file, index) => ({
      ...file, fileName: hideIdentity ? `比赛附件 ${item.ContestResource.length + index + 1}` : file.fileName,
      fileUrl: contestFileUrl(id, item.id, file.fileUrl), uploadedBy: '', uploadedAt: file.uploadedAt.toISOString(),
    })),
  ]]))
}

export async function getContestProblemSolution(id: number, contestProblemId: string, userId: string) {
  const contest = await requireAccessibleContest(id, userId)
  const isAdmin = await canManageContest(userId, contest)
  const showSolution = isAdmin || contest.solutionVisible || contest.status === 'finished' || new Date() > contest.endTime
  if (!showSolution) return { data: null, message: '题解将在比赛结束后显示' }
  const contestRow = await prisma.contest.findUnique({ where: { publicId: id }, select: { id: true } })
  if (!contestRow) return { data: null }
  const item = await prisma.contestProblem.findFirst({
    where: { id: contestProblemId, contestId: contestRow.id },
    include: { ContestResource: true, CanonicalProblem: { include: { ProblemStatement: { where: { type: 'solution', isVisible: true }, orderBy: { createdAt: 'asc' }, take: 1 } } } },
  })
  if (!item) return { data: null }
  const resource = item.ContestResource.find(file => file.fileType === 'solution')
  if (item.solutionType !== 'none') return { data: {
    content: item.solutionMarkdown ? rewriteContestFileUrls(id, contestProblemId, item.solutionMarkdown) : '',
    solutionType: item.solutionType, fileUrl: resource?.fileUrl ? contestFileUrl(id, contestProblemId, resource.fileUrl) : null,
    source: 'contest',
  } }
  const problem = item.CanonicalProblem
  if (problem?.solutionType !== 'none' && problem?.solutionMarkdown) return { data: {
    content: rewriteContestFileUrls(id, contestProblemId, problem.solutionMarkdown), solutionType: problem.solutionType,
    solutionPdfUrl: contestFileUrl(id, contestProblemId, problem.solutionPdfUrl), source: 'problem',
  } }
  const solution = problem?.ProblemStatement[0]
  return { data: solution?.content ? {
    content: rewriteContestFileUrls(id, contestProblemId, solution.content), format: solution.format,
    language: solution.language, fileUrl: contestFileUrl(id, contestProblemId, solution.fileUrl), source: 'problem',
  } : null }
}

export async function getContestProblemAttachments(id: number, contestProblemId: string, userId: string) {
  const contest = await requireAccessibleContest(id, userId)
  const notStarted = await requireContestStarted(contest, userId)
  if (notStarted) fail(403, 'CONTEST_NOT_STARTED', notStarted)
  const contestRow = await prisma.contest.findUnique({ where: { publicId: id }, select: { id: true } })
  if (!contestRow) return []
  const item = await prisma.contestProblem.findFirst({
    where: { id: contestProblemId, contestId: contestRow.id },
    include: { ContestResource: { where: { fileType: { notIn: ['statement', 'solution'] } } }, CanonicalProblem: { include: { ProblemAttachment: { orderBy: { uploadedAt: 'desc' } } } } },
  })
  if (!item) return []
  return [
    ...item.ContestResource.map(file => ({ id: file.id, fileName: file.fileName, fileUrl: contestFileUrl(id, contestProblemId, file.fileUrl), fileSize: 0, uploadedAt: file.uploadedAt.toISOString() })),
    ...(item.CanonicalProblem?.ProblemAttachment || []).map(file => ({ id: file.id, fileName: file.fileName, fileUrl: contestFileUrl(id, contestProblemId, file.fileUrl), fileSize: file.fileSize, uploadedAt: file.uploadedAt.toISOString() })),
  ]
}

export async function downloadContestProblemFile(params: { contestId: number; contestProblemId: string; fileId: string; userId: string }) {
  const contest = await requireAccessibleContest(params.contestId, params.userId, true)
  const notStarted = await requireContestStarted(contest, params.userId)
  if (notStarted) fail(403, 'CONTEST_NOT_STARTED', notStarted)
  const contestRow = await prisma.contest.findUnique({ where: { publicId: params.contestId }, select: { id: true } })
  const item = contestRow ? await prisma.contestProblem.findFirst({
    where: { id: params.contestProblemId, contestId: contest.id },
    include: {
      ContestResource: true,
      CanonicalProblem: { include: { ProblemAttachment: true, ProblemStatement: { where: { isVisible: true } } } },
    },
  }) : null
  const file = await fileService.getFile(params.fileId)
  if (!item?.canonicalProblemId || !file || file.status !== 'active' || file.category === 'testdata') fail(404, 'RESOURCE_NOT_FOUND', '资源不存在')
  const isAdmin = await canManageContest(params.userId, contest)
  const showSolution = isAdmin || contest.solutionVisible || contest.status === 'finished' || new Date() > contest.endTime
  const allowedIds = new Set<string>()
  const allowUrl = (url: string | null | undefined) => { const id = extractManagedFileId(url); if (id) allowedIds.add(id) }
  const allowContent = (content: string | null | undefined) => {
    if (!content) return
    for (const pattern of managedFilePatterns) { pattern.lastIndex = 0; for (const match of content.matchAll(pattern)) if (match[1]) allowedIds.add(match[1]) }
  }
  for (const resource of item.ContestResource) if (resource.fileType !== 'solution' || showSolution) allowUrl(resource.fileUrl)
  const problem = item.CanonicalProblem
  if (problem) {
    allowUrl(problem.statementPdfUrl); allowContent(problem.description)
    for (const attachment of problem.ProblemAttachment) allowUrl(attachment.fileUrl)
    for (const statement of problem.ProblemStatement) {
      if (statement.type === 'solution' && !showSolution) continue
      allowUrl(statement.fileUrl); allowContent(statement.content)
    }
    if (showSolution) { allowUrl(problem.solutionPdfUrl); allowContent(problem.solutionMarkdown) }
  }
  if (!allowedIds.has(params.fileId)) fail(404, 'RESOURCE_NOT_FOUND', '资源不存在')
  const download = await fileService.download(params.fileId)
  return { ...download, disposition: file.category === 'attachment' ? 'attachment' : 'inline' }
}
