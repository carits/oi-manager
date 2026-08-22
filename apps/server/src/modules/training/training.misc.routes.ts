/**
 * Training Misc Routes
 * 题解、附件、题目解析路由
 */

import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { getAdapter, getSupportedPlatforms } from '../../oj-adapters'
import {
  canAccessTraining,
  canManageTraining,
  parseTrainingId,
  requireTrainingStarted,
} from './training.helpers'
import { findAccessibleProblem, findUsableProblemByExternalId } from '../problem/problem.access'
import { fileService } from '../../lib/storage'
import { shouldHideTrainingProblemSource } from './training.visibility'
import { buildContestProblemStatus } from './training.problem-status'

export const trainingMiscRouter = Router()

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

/**
 * GET /api/trainings/:id/overview
 * Return the metadata and visible problem summaries needed by the first
 * viewport in one bounded request.
 */
trainingMiscRouter.get('/trainings/:id/overview', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = parseTrainingId(req.params.id)
  const userId = req.user!.userId
  const training = await prisma.training.findUnique({
    where: { id },
    include: {
      _count: { select: { TrainingParticipant: true, TrainingProblem: true } },
      TrainingProblem: {
        include: {
          Problem: {
            select: {
              id: true,
              title: true,
              platform: true,
              problemId: true,
              difficulty: true,
              timeLimit: true,
              memoryLimit: true,
              _count: { select: { ProblemAttachment: true } },
            },
          },
          TrainingSolution: { select: { id: true, visible: true } },
          _count: { select: { TrainingAttachment: true } },
        },
        orderBy: { orderIndex: 'asc' },
      },
    },
  })

  if (!training) {
    return res.status(404).json({ success: false, message: '训练不存在' })
  }
  if (!await canAccessTraining(userId, training)) {
    return res.status(403).json({ success: false, message: '无权查看该训练' })
  }

  const now = new Date()
  const computedStatus =
    now < training.startTime
      ? 'upcoming'
      : now <= training.endTime
        ? 'ongoing'
        : 'finished'
  if (computedStatus !== training.status) {
    await prisma.training.update({
      where: { id },
      data: { status: computedStatus },
    })
    if (computedStatus === 'finished' && training.type === 'contest') {
      await prisma.submission.updateMany({
        where: {
          submitScope: 'contest',
          contestId: id,
          isGlobalVisible: false,
        },
        data: { isGlobalVisible: true },
      })
    }
  }
  const isAdmin = await canManageTraining(userId, training)
  const canSeeProblems = computedStatus !== 'upcoming' || isAdmin
  const submissions = canSeeProblems
    ? await prisma.submission.findMany({
        where: {
          submitScope: training.type === 'contest' ? 'contest' : 'training',
          trainingId: id,
          userId,
        },
        select: {
          trainingProblemId: true,
          oj: true,
          problemId: true,
          score: true,
          result: true,
        },
        orderBy: { createdAt: 'asc' },
      })
    : []
  const bestByProblem = new Map<string, { score: number; result: string }>()
  for (const submission of submissions) {
    const problemKey =
      submission.trainingProblemId || `${submission.oj}:${submission.problemId}`
    const score = submission.score ?? 0
    const current = bestByProblem.get(problemKey)
    if (
      !current ||
      score > current.score ||
      (score === current.score &&
        submission.result === 'accepted' &&
        current.result !== 'accepted')
    ) {
      bestByProblem.set(problemKey, {
        score,
        result: submission.result,
      })
    }
  }
  const platformLabelMap = new Map<string, string>([
    ...getSupportedPlatforms().map(platform => [platform.platform, platform.name] as [string, string]),
    ['carits', 'Carits'],
  ])
  const hideOiStatus = training.format === 'oi' && computedStatus !== 'finished' && !isAdmin
  const hideProblemIdentity = shouldHideTrainingProblemSource(training, isAdmin)

  const problems = canSeeProblems
    ? training.TrainingProblem.map(problem => {
        const attachmentCount =
          (problem.Problem._count?.ProblemAttachment ?? 0) +
          problem._count.TrainingAttachment
        const summary = {
          id: problem.id,
          points: problem.points,
          hasSolution: Boolean(problem.TrainingSolution),
          solutionVisible: problem.TrainingSolution?.visible ?? false,
          attachmentCount,
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
        const matchingSubmissions = submissions.filter(submission =>
          submission.problemId === problem.id || submission.problemId === platformProblemId || submission.problemId === `${platform}:${platformProblemId}`,
        )
        const status = buildContestProblemStatus(training.format, matchingSubmissions)
        let problemUrl: string | null = null

        try {
          problemUrl = platform === 'carits'
            ? '__carits__'
            : platform
              ? getAdapter(platform as any).getProblemUrl(platformProblemId)
              : null
        } catch {
          problemUrl = null
        }

        const showPlatform = !hideProblemIdentity
        return {
          id: problem.id,
          points: problem.points,
          problemSourceHidden: hideProblemIdentity,
          orderIndex: problem.orderIndex,
          ...(showPlatform ? {
            alias: problem.alias,
            title: problem.Problem.title,
            problemTitle: problem.Problem.title,
          } : {}),
          ...(showPlatform ? {
            platform,
            platformProblemId,
            problemTableId: problem.Problem.id,
            platformLabel: platformLabelMap.get(platform as any) || platform || '',
            problemUrl,
          } : {}),
          hasSubmitted: status.hasSubmitted,
          bestScore: hideOiStatus ? null : status.bestScore,
          bestResult: hideOiStatus ? null : status.bestResult,
          latestResult: hideOiStatus ? null : status.latestResult,
          hasAccepted: status.hasAccepted,
          displayStatus: hideOiStatus ? (status.hasSubmitted ? 'submitted' : null) : status.displayStatus,
        }
      })
    : []

  res.json({
    success: true,
    data: {
      training: {
        id: training.id,
        teamId: training.teamId,
        organizationId: training.organizationId,
        title: training.title,
        description: training.description,
        format: training.format,
        startTime: training.startTime.toISOString(),
        endTime: training.endTime.toISOString(),
        status: computedStatus,
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
    },
  })
}, '获取训练概览失败'))

/**
 * GET /api/trainings/:id/solutions
 * Return all visible solutions in one response so the browser never performs
 * one request per problem.
 */
trainingMiscRouter.get('/trainings/:id/solutions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = parseTrainingId(req.params.id)
  const userId = req.user!.userId
  const training = await prisma.training.findUnique({ where: { id } })

  if (!training) {
    return res.status(404).json({ success: false, message: '训练不存在' })
  }
  if (!await canAccessTraining(userId, training)) {
    return res.status(403).json({ success: false, message: '无权限' })
  }

  const isAdmin = await canManageTraining(userId, training)
  const showSolution =
    isAdmin || training.solutionVisible ||
    training.status === 'finished' || new Date() > training.endTime

  if (!showSolution) {
    return res.json({ success: true, data: {} })
  }

  const problems = await prisma.trainingProblem.findMany({
    where: { trainingId: id },
    select: {
      id: true,
      TrainingSolution: {
        select: { content: true, visible: true },
      },
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
            select: {
              content: true,
              format: true,
              language: true,
              fileUrl: true,
            },
          },
        },
      },
    },
    orderBy: { orderIndex: 'asc' },
  })

  const solutions: Record<string, {
    content: string
    visible: boolean
    source: 'canonical' | 'user' | 'training' | 'none' | 'problem'
    solutionType?: string
    solutionPdfUrl?: string | null
    format?: string
    language?: string | null
    fileUrl?: string | null
    contentRevision?: number
    snapshotId?: string
    authorUsername?: string | null
  }> = {}

  for (const item of problems) {
    const snapshot = item.ContentSnapshot[0]
    if (snapshot) {
      if (snapshot.sourceType !== 'none') {
        solutions[item.id] = {
          content: snapshot.content ? rewriteTrainingFileUrls(id, item.id, snapshot.content) : '',
          visible: true,
          source: snapshot.sourceType as 'canonical' | 'user' | 'training',
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

  res.json({ success: true, data: solutions })
}, '查询题解失败'))

/**
 * GET /api/trainings/:id/attachments
 * Return original-problem and training-specific attachments in one response.
 */
trainingMiscRouter.get('/trainings/:id/attachments', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = parseTrainingId(req.params.id)
  const userId = req.user!.userId
  const training = await prisma.training.findUnique({ where: { id } })

  if (!training) {
    return res.status(404).json({ success: false, message: '训练不存在' })
  }
  if (!await canAccessTraining(userId, training)) {
    return res.status(403).json({ success: false, message: '无权限' })
  }

  const notStarted = await requireTrainingStarted(training, userId)
  if (notStarted) {
    return res.status(403).json({ success: false, message: notStarted })
  }

  const problems = await prisma.trainingProblem.findMany({
    where: { trainingId: id },
    select: {
      id: true,
      TrainingAttachment: {
        orderBy: { uploadedAt: 'desc' },
        select: {
          id: true,
          fileName: true,
          fileUrl: true,
          fileSize: true,
          uploadedBy: true,
          uploadedAt: true,
        },
      },
      Problem: {
        select: {
          ProblemAttachment: {
            orderBy: { uploadedAt: 'desc' },
            select: {
              id: true,
              fileName: true,
              fileUrl: true,
              fileSize: true,
              uploadedAt: true,
            },
          },
        },
      },
    },
    orderBy: { orderIndex: 'asc' },
  })

  const isAdmin = await canManageTraining(userId, training)
  const hideProblemIdentity = shouldHideTrainingProblemSource(training, isAdmin)
  const attachments = Object.fromEntries(problems.map(item => [
    item.id,
    [
      ...item.TrainingAttachment.map((file, index) => ({
        ...file,
        ...(hideProblemIdentity ? { fileName: `比赛附件 ${index + 1}` } : {}),
        uploadedAt: file.uploadedAt.toISOString(),
      })),
      ...item.Problem.ProblemAttachment.map((file, index) => ({
        ...file,
        ...(hideProblemIdentity ? { fileName: `比赛附件 ${item.TrainingAttachment.length + index + 1}` } : {}),
        fileUrl: trainingFileUrl(id, item.id, file.fileUrl),
        uploadedBy: '',
        uploadedAt: file.uploadedAt.toISOString(),
      })),
    ],
  ]))

  res.json({ success: true, data: attachments })
}, '查询附件失败'))

/**
 * GET /api/trainings/:id/problems/:problemId/solution
 * 获取训练题目的题解（只读，同步原题目题解，所有人可见）
 */
trainingMiscRouter.get('/trainings/:id/problems/:problemId/solution', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    // 检查题解可见性：solutionVisible=true 或 训练已结束
    const showSolution = training.solutionVisible || training.status === 'finished' || new Date() > training.endTime
    if (!showSolution) {
      // 非管理员且题解不可见，返回提示信息
      const isAdmin = await canManageTraining(userId, training)
      if (!isAdmin) {
        return res.json({ success: true, data: null, message: '题解将在比赛结束后显示' })
      }
    }

    // 查询训练题目关联的原题目
    const trainingProblem = await prisma.trainingProblem.findUnique({
      where: { id: problemId },
      include: { Problem: true }
    })

    if (!trainingProblem) {
      return res.json({ success: true, data: null })
    }

    const problem = trainingProblem.Problem

    // 1. 检查 Problem 表的 solutionMarkdown (旧版本存储方式)
    if (problem.solutionType !== 'none' && problem.solutionMarkdown) {
      return res.json({
        success: true,
        data: {
          content: problem.solutionMarkdown,
          solutionType: problem.solutionType,
          solutionPdfUrl: problem.solutionPdfUrl,
          source: 'problem'
        }
      })
    }

    // 2. 检查 ProblemStatement 表中 type='solution' 的记录（新版本存储方式）
    const solutionStatement = await prisma.problemStatement.findFirst({
      where: {
        problemId: problem.id,
        type: 'solution',
        isVisible: true
      },
      orderBy: { createdAt: 'asc' }
    })

    if (solutionStatement && solutionStatement.content) {
      return res.json({
        success: true,
        data: {
          content: solutionStatement.content,
          format: solutionStatement.format,
          language: solutionStatement.language,
          fileUrl: solutionStatement.fileUrl,
          source: 'problem'
        }
      })
    }

    // 没有找到题解
    res.json({ success: true, data: null })
}, '查询失败'))

/**
 * GET /api/trainings/:id/problems/:problemId/attachments
 * 获取训练题目附件（只读，同步原题目附件，所有人可见）
 */
trainingMiscRouter.get('/trainings/:id/problems/:problemId/attachments', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await prisma.training.findUnique({ where: { id } })
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限' })
    }

    const notStarted = await requireTrainingStarted(training, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    // 获取训练题目关联的原始题目 ID
    const trainingProblem = await prisma.trainingProblem.findUnique({
      where: { id: problemId },
      select: { problemId: true },
    })

    // 只获取原始题目附件（训练模块不存储独立附件）
    let problemAttachments: any[] = []
    if (trainingProblem?.problemId) {
      problemAttachments = await prisma.problemAttachment.findMany({
        where: { problemId: trainingProblem.problemId },
        orderBy: { uploadedAt: 'desc' },
      })
    }

    const allAttachments = problemAttachments.map(a => ({
      id: a.id,
      fileName: a.fileName,
      fileUrl: trainingFileUrl(id, problemId, a.fileUrl),
      fileSize: a.fileSize,
      uploadedAt: a.uploadedAt.toISOString(),
    }))

    res.json({ success: true, data: allAttachments })
}, '查询失败'))

/**
 * Download a problem asset only through an authorized training context.
 * Raw organization-library file URLs remain inaccessible to students.
 */
trainingMiscRouter.get('/trainings/:id/problems/:problemId/files/:fileId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = parseTrainingId(req.params.id)
  const { problemId: trainingProblemId, fileId } = req.params
  const userId = req.user!.userId
  const training = await prisma.training.findUnique({ where: { id } })

  if (!training || !await canAccessTraining(userId, training)) {
    return res.status(404).json({ success: false, message: '资源不存在' })
  }
  const notStarted = await requireTrainingStarted(training, userId)
  if (notStarted) {
    return res.status(403).json({ success: false, message: notStarted })
  }

  const trainingProblem = await prisma.trainingProblem.findFirst({
    where: { id: trainingProblemId, trainingId: id },
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
            where: { isVisible: true },
            select: { type: true, content: true, fileUrl: true },
          },
        },
      },
    },
  })
  const file = await fileService.getFile(fileId)
  if (!trainingProblem || !file || file.status !== 'active' ||
      file.ownerType !== 'problem' || file.ownerId !== trainingProblem.problemId ||
      file.category === 'testdata') {
    return res.status(404).json({ success: false, message: '资源不存在' })
  }

  const isAdmin = await canManageTraining(userId, training)
  const showSolution = isAdmin || training.solutionVisible ||
    training.status === 'finished' || new Date() > training.endTime
  const allowedIds = new Set<string>()
  const allowUrl = (url: string | null | undefined) => {
    const managedId = extractManagedFileId(url)
    if (managedId) allowedIds.add(managedId)
  }
  const allowContent = (content: string | null | undefined) => {
    if (!content) return
    for (const pattern of managedFilePatterns) {
      pattern.lastIndex = 0
      for (const match of content.matchAll(pattern)) {
        if (match[1]) allowedIds.add(match[1])
      }
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
  if (!allowedIds.has(fileId)) {
    return res.status(404).json({ success: false, message: '资源不存在' })
  }

  const download = await fileService.download(fileId)
  const disposition = file.category === 'attachment' ? 'attachment' : 'inline'
  res.setHeader('Content-Type', download.mimeType)
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(download.originalName)}`)
  res.setHeader('Content-Length', download.buffer.length)
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(download.buffer)
}, '下载训练题目资源失败'))

/**
 * POST /api/trainings/resolve-problems
 * 批量解析 OJ+题号 → 查找 Problem 记录（用于训练创建时的题目检索）
 */
trainingMiscRouter.post('/resolve-problems', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未登录' })
    }

    const { items } = req.body as {
      items: Array<{ ojName: string; problemCode: string }>
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: '参数错误' })
    }

    const resolved: Array<{
      problemId: string
      title: string
      ojName: string
      problemCode: string
      found: boolean
      created: boolean
    }> = []

    for (const item of items) {
      let matched: { id: string; title: string } | null = null

      if (item.ojName === 'carits') {
        // Carits 平台：按 ID 或 problemId 查本地题库
        let p = await findAccessibleProblem(req.user!, item.problemCode, 'use').catch(() => null)
        if (!p) {
          p = await findUsableProblemByExternalId(req.user!, 'carits', item.problemCode)
        }
        if (p) matched = { id: p.id, title: p.title }
      } else {
        // 外部 OJ：按 platform + problemId 直接查
        const p = await findUsableProblemByExternalId(req.user!, item.ojName, item.problemCode)
        if (p) {
          matched = { id: p.id, title: p.title }
        }
      }

      if (matched) {
        resolved.push({
          problemId: matched.id,
          title: matched.title,
          ojName: item.ojName,
          problemCode: item.problemCode,
          found: true,
          created: false,
        })
      } else {
        resolved.push({
          problemId: '',
          title: '题库中未找到',
          ojName: item.ojName,
          problemCode: item.problemCode,
          found: false,
          created: false,
        })
      }
    }

    res.json({ success: true, data: { resolved } })
}, '解析失败'))
