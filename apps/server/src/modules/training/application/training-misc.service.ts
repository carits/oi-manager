import { prisma } from '../../../prisma'
import { fileService } from '../../../lib/storage'
import { getAdapter, getSupportedPlatforms } from '../../../oj-adapters'
import {
  canAccessTraining,
  canManageTraining,
  requireTrainingStarted,
} from '../training.helpers'
import { shouldHideTrainingProblemSource } from '../training.visibility'
import { buildContestProblemStatus } from '../training.problem-status'
import { synchronizeTrainingStatus } from './training-crud.service'
import {
  CURRENT_JUDGE_RUN_SELECT,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'
import {
  findActivityRuntimeForAccess,
  findActivityRuntimeForOverview,
} from '../../contest/contest-query.facade'

export class TrainingMiscError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
function fail(statusCode: number, code: string, message: string): never {
  throw new TrainingMiscError(statusCode, code, message)
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

function trainingFileUrl(trainingId: number, trainingProblemId: string, fileUrl: string | null | undefined) {
  const fileId = extractManagedFileId(fileUrl)
  return fileId
    ? `/api/trainings/${trainingId}/problems/${trainingProblemId}/files/${fileId}`
    : fileUrl ?? null
}

function rewriteTrainingFileUrls(trainingId: number, trainingProblemId: string, content: string) {
  let rewritten = content
  for (const pattern of managedFilePatterns) {
    pattern.lastIndex = 0
    rewritten = rewritten.replace(pattern, (_url, fileId: string) =>
      `/api/trainings/${trainingId}/problems/${trainingProblemId}/files/${fileId}`)
  }
  return rewritten
}

async function requireAccessibleTraining(id: number, userId: string, hidden = false) {
  const training = (await findActivityRuntimeForAccess(id))?.runtime || null
  if (!training || !await canAccessTraining(userId, training)) {
    fail(hidden ? 404 : training ? 403 : 404, hidden ? 'RESOURCE_NOT_FOUND' : training ? 'TRAINING_ACCESS_DENIED' : 'TRAINING_NOT_FOUND', hidden ? '资源不存在' : training ? '无权限' : '训练不存在')
  }
  return training
}

export async function getTrainingOverview(id: number, userId: string) {
  const training = (await findActivityRuntimeForOverview(id))?.runtime || null
  if (!training) fail(404, 'TRAINING_NOT_FOUND', '训练不存在')
  if (!await canAccessTraining(userId, training)) fail(403, 'TRAINING_ACCESS_DENIED', '无权查看该训练')

  const status = await synchronizeTrainingStatus(training, new Date())
  const isAdmin = await canManageTraining(userId, training)
  const canSeeProblems = status !== 'upcoming' || isAdmin
  const submissions = canSeeProblems
    ? await prisma.submission.findMany({
        where: {
          submitScope: training.type === 'contest' ? 'contest' : 'training',
          trainingId: id,
          userId,
        },
        select: {
          trainingProblemId: true, oj: true, problemId: true, score: true, result: true,
          CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT },
        },
        orderBy: { createdAt: 'asc' },
      }).then(rows => rows.map(projectSubmissionJudgeResult))
    : []
  const platformLabels = new Map<string, string>([
    ...getSupportedPlatforms().map(platform => [platform.platform, platform.name] as [string, string]),
    ['carits', 'Carits'],
  ])
  const hideOiStatus = training.format === 'oi' && status !== 'finished' && !isAdmin
  const hideProblemIdentity = shouldHideTrainingProblemSource(training, isAdmin)
  const problems = canSeeProblems
    ? training.TrainingProblem.map(problem => {
        const summary = {
          id: problem.id,
          points: problem.points,
          hasSolution: Boolean(problem.TrainingSolution),
          solutionVisible: problem.TrainingSolution?.visible ?? false,
          attachmentCount: (problem.Problem._count?.ProblemAttachment ?? 0) + problem._count.TrainingAttachment,
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
    ? training.TrainingProblem.map(problem => {
        const platform = problem.Problem.platform
        const platformProblemId = problem.Problem.problemId
        const matching = submissions.filter(submission =>
          submission.trainingProblemId === problem.id ||
          submission.problemId === platformProblemId ||
          submission.problemId === `${platform}:${platformProblemId}`)
        const itemStatus = buildContestProblemStatus(training.format, matching)
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
    training: {
      id: training.id,
      teamId: training.teamId,
      organizationId: training.organizationId,
      title: training.title,
      description: training.description,
      format: training.format,
      startTime: training.startTime.toISOString(),
      endTime: training.endTime.toISOString(),
      status,
      createdBy: training.createdBy,
      problemIdVisible: training.problemIdVisible,
      solutionVisible: training.solutionVisible,
      includeAdminInRanking: training.includeAdminInRanking,
      type: training.type,
      sourceTrainingId: training.sourceTrainingId,
      problemCount: training._count.TrainingProblem,
      participantCount: training._count.TrainingParticipant,
      isAdmin,
      createdAt: training.createdAt.toISOString(),
    },
    problems,
    problemStatus,
  }
}

export async function getTrainingSolutions(id: number, userId: string) {
  const training = await requireAccessibleTraining(id, userId)
  const isAdmin = await canManageTraining(userId, training)
  if (!(isAdmin || training.solutionVisible || training.status === 'finished' || new Date() > training.endTime)) {
    return {}
  }
  const problems = await prisma.trainingProblem.findMany({
    where: { trainingId: id },
    select: {
      id: true,
      TrainingSolution: { select: { content: true, visible: true } },
      ContentSnapshot: {
        where: { kind: 'solution' },
        orderBy: [{ revision: 'desc' }, { selectedAt: 'desc' }],
        take: 1,
      },
      Problem: {
        select: {
          solutionType: true,
          solutionMarkdown: true,
          solutionPdfUrl: true,
          ProblemStatement: {
            where: { type: 'solution', isVisible: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { content: true, format: true, language: true, fileUrl: true },
          },
        },
      },
    },
    orderBy: { orderIndex: 'asc' },
  })
  const solutions: Record<string, any> = {}
  for (const item of problems) {
    const snapshot = item.ContentSnapshot[0]
    if (snapshot) {
      if (snapshot.sourceType !== 'none') {
        solutions[item.id] = {
          content: snapshot.content ? rewriteTrainingFileUrls(id, item.id, snapshot.content) : '',
          visible: true,
          source: snapshot.sourceType,
          solutionType: snapshot.format,
          format: snapshot.format,
          language: snapshot.language,
          fileUrl: snapshot.snapshotFileId
            ? `/api/trainings/${id}/problems/${item.id}/content-snapshot/solution/file`
            : null,
          contentRevision: snapshot.revision,
          snapshotId: snapshot.id,
          authorUsername: snapshot.sourceType === 'user' ? snapshot.authorUsernameSnapshot : null,
        }
      }
      continue
    }
    if (item.TrainingSolution && (item.TrainingSolution.visible || isAdmin)) {
      solutions[item.id] = {
        content: rewriteTrainingFileUrls(id, item.id, item.TrainingSolution.content),
        visible: item.TrainingSolution.visible,
        source: 'training',
      }
      continue
    }
    if (item.Problem.solutionType !== 'none' && item.Problem.solutionMarkdown) {
      solutions[item.id] = {
        content: rewriteTrainingFileUrls(id, item.id, item.Problem.solutionMarkdown),
        visible: true,
        source: 'problem',
        solutionType: item.Problem.solutionType,
        solutionPdfUrl: trainingFileUrl(id, item.id, item.Problem.solutionPdfUrl),
      }
      continue
    }
    const statement = item.Problem.ProblemStatement[0]
    if (statement?.content) {
      solutions[item.id] = {
        content: rewriteTrainingFileUrls(id, item.id, statement.content),
        visible: true,
        source: 'problem',
        format: statement.format,
        language: statement.language,
        fileUrl: trainingFileUrl(id, item.id, statement.fileUrl),
      }
    }
  }
  return solutions
}

export async function getTrainingAttachments(id: number, userId: string) {
  const training = await requireAccessibleTraining(id, userId)
  const notStarted = await requireTrainingStarted(training, userId)
  if (notStarted) fail(403, 'TRAINING_NOT_STARTED', notStarted)
  const problems = await prisma.trainingProblem.findMany({
    where: { trainingId: id },
    select: {
      id: true,
      TrainingAttachment: {
        orderBy: { uploadedAt: 'desc' },
        select: { id: true, fileName: true, fileUrl: true, fileSize: true, uploadedBy: true, uploadedAt: true },
      },
      Problem: {
        select: {
          ProblemAttachment: {
            orderBy: { uploadedAt: 'desc' },
            select: { id: true, fileName: true, fileUrl: true, fileSize: true, uploadedAt: true },
          },
        },
      },
    },
    orderBy: { orderIndex: 'asc' },
  })
  const isAdmin = await canManageTraining(userId, training)
  const hideIdentity = shouldHideTrainingProblemSource(training, isAdmin)
  return Object.fromEntries(problems.map(item => [
    item.id,
    [
      ...item.TrainingAttachment.map((file, index) => ({
        ...file,
        ...(hideIdentity ? { fileName: `比赛附件 ${index + 1}` } : {}),
        uploadedAt: file.uploadedAt.toISOString(),
      })),
      ...item.Problem.ProblemAttachment.map((file, index) => ({
        ...file,
        ...(hideIdentity ? { fileName: `比赛附件 ${item.TrainingAttachment.length + index + 1}` } : {}),
        fileUrl: trainingFileUrl(id, item.id, file.fileUrl),
        uploadedBy: '',
        uploadedAt: file.uploadedAt.toISOString(),
      })),
    ],
  ]))
}

export async function getTrainingProblemSolution(id: number, trainingProblemId: string, userId: string) {
  const training = await requireAccessibleTraining(id, userId)
  const isAdmin = await canManageTraining(userId, training)
  const showSolution = isAdmin || training.solutionVisible || training.status === 'finished' || new Date() > training.endTime
  if (!showSolution) return { data: null, message: '题解将在比赛结束后显示' }
  const trainingProblem = await prisma.trainingProblem.findFirst({
    where: { id: trainingProblemId, trainingId: id },
    include: { Problem: true },
  })
  if (!trainingProblem) return { data: null }
  const problem = trainingProblem.Problem
  if (problem.solutionType !== 'none' && problem.solutionMarkdown) {
    return { data: {
      content: rewriteTrainingFileUrls(id, trainingProblemId, problem.solutionMarkdown),
      solutionType: problem.solutionType,
      solutionPdfUrl: trainingFileUrl(id, trainingProblemId, problem.solutionPdfUrl),
      source: 'problem',
    } }
  }
  const solution = await prisma.problemStatement.findFirst({
    where: { problemId: problem.id, type: 'solution', isVisible: true },
    orderBy: { createdAt: 'asc' },
  })
  return { data: solution?.content ? {
    content: rewriteTrainingFileUrls(id, trainingProblemId, solution.content),
    format: solution.format,
    language: solution.language,
    fileUrl: trainingFileUrl(id, trainingProblemId, solution.fileUrl),
    source: 'problem',
  } : null }
}

export async function getTrainingProblemAttachments(id: number, trainingProblemId: string, userId: string) {
  const training = await requireAccessibleTraining(id, userId)
  const notStarted = await requireTrainingStarted(training, userId)
  if (notStarted) fail(403, 'TRAINING_NOT_STARTED', notStarted)
  const problem = await prisma.trainingProblem.findFirst({
    where: { id: trainingProblemId, trainingId: id },
    select: {
      Problem: {
        select: {
          ProblemAttachment: { orderBy: { uploadedAt: 'desc' } },
        },
      },
    },
  })
  if (!problem) return []
  return problem.Problem.ProblemAttachment.map(attachment => ({
    id: attachment.id,
    fileName: attachment.fileName,
    fileUrl: trainingFileUrl(id, trainingProblemId, attachment.fileUrl),
    fileSize: attachment.fileSize,
    uploadedAt: attachment.uploadedAt.toISOString(),
  }))
}

export async function downloadTrainingProblemFile(params: {
  trainingId: number
  trainingProblemId: string
  fileId: string
  userId: string
}) {
  const training = await requireAccessibleTraining(params.trainingId, params.userId, true)
  const notStarted = await requireTrainingStarted(training, params.userId)
  if (notStarted) fail(403, 'TRAINING_NOT_STARTED', notStarted)
  const trainingProblem = await prisma.trainingProblem.findFirst({
    where: { id: params.trainingProblemId, trainingId: params.trainingId },
    select: {
      problemId: true,
      Problem: {
        select: {
          description: true,
          statementPdfUrl: true,
          solutionMarkdown: true,
          solutionPdfUrl: true,
          ProblemAttachment: { select: { fileUrl: true } },
          ProblemStatement: {
            where: { isVisible: true }, select: { type: true, content: true, fileUrl: true },
          },
        },
      },
    },
  })
  const file = await fileService.getFile(params.fileId)
  if (!trainingProblem || !file || file.status !== 'active' ||
      file.ownerType !== 'problem' || file.ownerId !== trainingProblem.problemId ||
      file.category === 'testdata') {
    fail(404, 'RESOURCE_NOT_FOUND', '资源不存在')
  }
  const isAdmin = await canManageTraining(params.userId, training)
  const showSolution = isAdmin || training.solutionVisible || training.status === 'finished' || new Date() > training.endTime
  const allowedIds = new Set<string>()
  const allowUrl = (url: string | null | undefined) => {
    const fileId = extractManagedFileId(url)
    if (fileId) allowedIds.add(fileId)
  }
  const allowContent = (content: string | null | undefined) => {
    if (!content) return
    for (const pattern of managedFilePatterns) {
      pattern.lastIndex = 0
      for (const match of content.matchAll(pattern)) if (match[1]) allowedIds.add(match[1])
    }
  }
  allowUrl(trainingProblem.Problem.statementPdfUrl)
  allowContent(trainingProblem.Problem.description)
  for (const attachment of trainingProblem.Problem.ProblemAttachment) allowUrl(attachment.fileUrl)
  for (const statement of trainingProblem.Problem.ProblemStatement) {
    if (statement.type === 'solution' && !showSolution) continue
    allowUrl(statement.fileUrl)
    allowContent(statement.content)
  }
  if (showSolution) {
    allowUrl(trainingProblem.Problem.solutionPdfUrl)
    allowContent(trainingProblem.Problem.solutionMarkdown)
  }
  if (!allowedIds.has(params.fileId)) fail(404, 'RESOURCE_NOT_FOUND', '资源不存在')
  const download = await fileService.download(params.fileId)
  return {
    ...download,
    disposition: file.category === 'attachment' ? 'attachment' : 'inline',
  }
}
