import crypto from 'crypto'
/**
 * 题单管理 API
 * @description 飞书文档式权限的题单管理系统
 * 3 级结构：题单 (ProblemList) → 章节 (Section) → 题目条目 (Entry)
 * UI 层面：所有章节和题目渲染在同一个页面上，章节仅作二级标题分组
 */

import { Router, type Response } from 'express'
import { prisma } from '../prisma'
import {
  authenticate,
  getMembershipType,
  getResourceScope,
  isPersonalContextForTeams,
  isPersonalContext,
} from '../middleware/auth'
import logger from '../lib/logger'
import { asyncHandler } from '../lib/asyncHandler'
import { parsePagination } from '../lib/pagination'
import { populateSnapshotData } from '../modules/training/training.helpers'
import { v4 as uuidv4 } from 'uuid'
import { ensureInitialTestSetRevision } from '../modules/problem/problem.testset-revision.service'
import { fileService } from '../lib/storage'
import {
  collectManagedProblemFileIds,
  extractManagedProblemFileId,
  getProblemListPermission,
  problemListFileUrl,
  rewriteProblemListFileUrls,
} from '../modules/problem-list/application/problem-list-access.service'
import {
  createProblemList,
  deleteProblemList,
  getProblemListDetail,
  listProblemLists,
  ProblemListApplicationError,
  updateProblemList,
} from '../modules/problem-list/application/problem-list-crud.service'
import {
  addProblemListSection,
  deleteProblemListSection,
  reorderProblemListSections,
  updateProblemListSection,
} from '../modules/problem-list/application/problem-list-section.service'
import {
  addProblemListEntry,
  deleteProblemListEntry,
  reorderProblemListEntries,
  resolveProblemListEntries,
  updateProblemListEntry,
} from '../modules/problem-list/application/problem-list-entry.service'
import {
  deleteProblemListShare,
  listProblemListShareCandidates,
  listProblemListShares,
  upsertProblemListShare,
} from '../modules/problem-list/application/problem-list-share.service'
import type { AuthRequest } from '../middleware/auth'

export const problemListsRouter = Router()

function problemListEndpoint(label: string, handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (error instanceof ProblemListApplicationError) {
        return res.status(error.statusCode).json({
          success: false,
          ...(error.code ? { code: error.code } : {}),
          ...(error.data !== undefined ? { data: error.data } : {}),
          message: error.message,
        })
      }
      throw error
    }
  }, label)
}

// ==================== 题单 CRUD ====================

/**
 * GET /api/problem-lists
 * 获取题单列表（我的 + 共享给我的）
 */
problemListsRouter.get('/', authenticate, problemListEndpoint('获取题单列表失败', async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query)
  res.json({ success: true, data: await listProblemLists(req.user!, req.query, page, pageSize, skip) })
}))

/**
 * POST /api/problem-lists
 * 创建题单（同时创建一个默认章节）
 */
problemListsRouter.post('/', authenticate, problemListEndpoint('创建题单失败', async (req, res) => {
  res.json({ success: true, data: await createProblemList(req.user!, req.body) })
}))

/**
 * GET /api/problem-lists/:id
 * 题单详情（含章节 → 题目条目）
 */
problemListsRouter.get('/:id', authenticate, problemListEndpoint('获取题单详情失败', async (req, res) => {
  res.json({ success: true, data: await getProblemListDetail(req.user!, req.params.id) })
}))

/**
 * GET /api/problem-lists/:id/entries/:entryId/problem
 * Read a published statement through an authorized problem-list context.
 */
problemListsRouter.get('/:id/entries/:entryId/problem', authenticate, asyncHandler(async (req, res) => {
  const user = req.user!
  const permission = await getProblemListPermission(req.params.id, user)
  if (!permission) return res.status(404).json({ success: false, message: '资源不存在' })

  const entry = await prisma.problemListEntry.findFirst({
    where: { id: req.params.entryId, ProblemListSection: { problemListId: req.params.id } },
    include: {
      ProblemListSection: { select: { ProblemList: { select: { scope: true, organizationId: true } } } },
      Problem: {
        include: {
          ProblemStatement: { where: { type: 'statement', isVisible: true }, orderBy: [{ format: 'asc' }, { language: 'asc' }] },
          ProblemAttachment: { orderBy: { uploadedAt: 'asc' } },
        },
      },
    },
  })
  if (!entry || entry.Problem.status !== 'published') {
    return res.status(404).json({ success: false, message: '资源不存在' })
  }
  const list = entry.ProblemListSection.ProblemList
  if (entry.Problem.libraryScope === 'school' &&
      (list.scope !== 'campus' || !list.organizationId || list.organizationId !== entry.Problem.organizationId)) {
    return res.status(404).json({ success: false, message: '资源不存在' })
  }

  const problem = entry.Problem
  res.json({
    success: true,
    data: {
      id: entry.id,
      title: entry.alias || problem.title,
      difficulty: problem.difficulty,
      timeLimit: problem.timeLimit,
      memoryLimit: problem.memoryLimit,
      description: rewriteProblemListFileUrls(req.params.id, entry.id, problem.description),
      statementType: problem.statementType,
      statementPdfUrl: problemListFileUrl(req.params.id, entry.id, problem.statementPdfUrl),
      statements: problem.ProblemStatement.map(statement => ({
        id: statement.id,
        format: statement.format,
        language: statement.language,
        content: rewriteProblemListFileUrls(req.params.id, entry.id, statement.content),
        fileUrl: problemListFileUrl(req.params.id, entry.id, statement.fileUrl),
      })),
      attachments: problem.ProblemAttachment.map(attachment => ({
        id: attachment.id,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        description: attachment.description,
        fileUrl: problemListFileUrl(req.params.id, entry.id, attachment.fileUrl),
      })),
    },
  })
}, '获取题单题面失败'))

/**
 * GET /api/problem-lists/:id/entries/:entryId/files/:fileId
 * Download only a file referenced by the authorized statement or attachment.
 */
problemListsRouter.get('/:id/entries/:entryId/files/:fileId', authenticate, asyncHandler(async (req, res) => {
  const user = req.user!
  const permission = await getProblemListPermission(req.params.id, user)
  if (!permission) return res.status(404).json({ success: false, message: '资源不存在' })

  const entry = await prisma.problemListEntry.findFirst({
    where: { id: req.params.entryId, ProblemListSection: { problemListId: req.params.id } },
    include: {
      ProblemListSection: { select: { ProblemList: { select: { scope: true, organizationId: true } } } },
      Problem: {
        select: {
          id: true,
          status: true,
          libraryScope: true,
          organizationId: true,
          description: true,
          statementPdfUrl: true,
          ProblemStatement: { where: { type: 'statement', isVisible: true }, select: { content: true, fileUrl: true } },
          ProblemAttachment: { select: { fileUrl: true } },
        },
      },
    },
  })
  const file = await fileService.getFile(req.params.fileId)
  if (!entry || entry.Problem.status !== 'published' || !file || file.status !== 'active' ||
      file.ownerType !== 'problem' || file.ownerId !== entry.Problem.id || file.category === 'testdata') {
    return res.status(404).json({ success: false, message: '资源不存在' })
  }
  const list = entry.ProblemListSection.ProblemList
  if (entry.Problem.libraryScope === 'school' &&
      (list.scope !== 'campus' || !list.organizationId || list.organizationId !== entry.Problem.organizationId)) {
    return res.status(404).json({ success: false, message: '资源不存在' })
  }

  const allowedIds = new Set<string>()
  const allowUrl = (url: string | null | undefined) => {
    const id = extractManagedProblemFileId(url)
    if (id) allowedIds.add(id)
  }
  const allowContent = (content: string | null | undefined) => {
    for (const id of collectManagedProblemFileIds(content)) allowedIds.add(id)
  }
  allowContent(entry.Problem.description)
  allowUrl(entry.Problem.statementPdfUrl)
  for (const statement of entry.Problem.ProblemStatement) {
    allowContent(statement.content)
    allowUrl(statement.fileUrl)
  }
  for (const attachment of entry.Problem.ProblemAttachment) allowUrl(attachment.fileUrl)
  if (!allowedIds.has(req.params.fileId)) {
    return res.status(404).json({ success: false, message: '资源不存在' })
  }

  const download = await fileService.download(file.id)
  const disposition = file.category === 'attachment' ? 'attachment' : 'inline'
  res.setHeader('Content-Type', download.mimeType)
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(download.originalName)}`)
  res.setHeader('Content-Length', download.buffer.length)
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(download.buffer)
}, '下载题单题目资源失败'))

/**
 * PUT /api/problem-lists/:id
 * 更新题单元信息
 */
problemListsRouter.put('/:id', authenticate, problemListEndpoint('更新题单失败', async (req, res) => {
  res.json({ success: true, data: await updateProblemList(req.user!, req.params.id, req.body) })
}))

/**
 * DELETE /api/problem-lists/:id
 * 硬删除题单（级联删除章节→条目→分享）
 */
problemListsRouter.delete('/:id', authenticate, problemListEndpoint('删除题单失败', async (req, res) => {
  await deleteProblemList(req.user!, req.params.id)
  res.json({ success: true, message: '删除成功' })
}))

// ==================== 章节 CRUD ====================

/**
 * POST /api/problem-lists/:id/sections
 * 添加章节
 */
problemListsRouter.post('/:id/sections', authenticate, problemListEndpoint('添加章节失败', async (req, res) => {
  res.json({ success: true, data: await addProblemListSection(req.user!, req.params.id, req.body) })
}))

/**
 * PUT /api/problem-lists/sections/:sectionId
 * 更新章节（标题 / sortOrder）
 */
problemListsRouter.put('/sections/:sectionId', authenticate, problemListEndpoint('更新章节失败', async (req, res) => {
  res.json({ success: true, data: await updateProblemListSection(req.user!, req.params.sectionId, req.body) })
}))

/**
 * DELETE /api/problem-lists/sections/:sectionId
 * 删除章节（级联删除其下所有条目）
 */
problemListsRouter.delete('/sections/:sectionId', authenticate, problemListEndpoint('删除章节失败', async (req, res) => {
  await deleteProblemListSection(req.user!, req.params.sectionId)
  res.json({ success: true, message: '删除成功' })
}))

/**
 * PUT /api/problem-lists/:id/sections/reorder
 * 重排章节顺序
 */
problemListsRouter.put('/:id/sections/reorder', authenticate, problemListEndpoint('排序失败', async (req, res) => {
  await reorderProblemListSections(req.user!, req.params.id, req.body.sectionIds)
  res.json({ success: true })
}))

// ==================== 题目条目 CRUD ====================

/**
 * POST /api/problem-lists/sections/:sectionId/entries/single
 * 单条添加题目到指定章节（VJudge 逐行输入）
 */
problemListsRouter.post('/sections/:sectionId/entries/single', authenticate, problemListEndpoint('添加题目失败', async (req, res) => {
  res.json({ success: true, data: await addProblemListEntry(req.user!, req.params.sectionId, req.body) })
}))

/**
 * POST /api/problem-lists/:id/entries/resolve
 * 批量解析题号 → 查找/创建 Problem 记录（不创建 Entry，仅预览）
 */
problemListsRouter.post('/:id/entries/resolve', authenticate, problemListEndpoint('解析题号失败', async (req, res) => {
  res.json({ success: true, data: await resolveProblemListEntries(req.user!, req.params.id, req.body.items) })
}))

/**
 * PUT /api/problem-lists/entries/:entryId
 * 更新条目（alias / notes / sortOrder）
 */
problemListsRouter.put('/entries/:entryId', authenticate, problemListEndpoint('更新条目失败', async (req, res) => {
  res.json({ success: true, data: await updateProblemListEntry(req.user!, req.params.entryId, req.body) })
}))
problemListsRouter.delete('/entries/:entryId', authenticate, problemListEndpoint('删除条目失败', async (req, res) => {
  await deleteProblemListEntry(req.user!, req.params.entryId)
  res.json({ success: true, message: '删除成功' })
}))

/**
 * PUT /api/problem-lists/sections/:sectionId/entries/reorder
 * 重排某章节内的条目顺序
 */
problemListsRouter.put('/sections/:sectionId/entries/reorder', authenticate, problemListEndpoint('排序失败', async (req, res) => {
  await reorderProblemListEntries(req.user!, req.params.sectionId, req.body.entryIds)
  res.json({ success: true })
}))


/**
 * GET /api/problem-lists/:id/shares
 * 获取题单分享列表
 */
problemListsRouter.get('/:id/shares', authenticate, problemListEndpoint('获取分享列表失败', async (req, res) => {
  res.json({ success: true, data: await listProblemListShares(req.user!, req.params.id) })
}))

/**
 * GET /api/problem-lists/:id/share-candidates
 * 搜索本校可分享的教师/学生
 */
problemListsRouter.get('/:id/share-candidates', authenticate, problemListEndpoint('搜索失败', async (req, res) => {
  res.json({ success: true, data: await listProblemListShareCandidates(req.user!, req.params.id, req.query) })
}))

/**
 * POST /api/problem-lists/:id/shares
 * 添加/更新分享
 */
problemListsRouter.post('/:id/shares', authenticate, problemListEndpoint('添加分享失败', async (req, res) => {
  res.json({ success: true, data: await upsertProblemListShare(req.user!, req.params.id, req.body) })
}))

/**
 * DELETE /api/problem-lists/:id/shares/:shareId
 * 移除分享
 */
problemListsRouter.delete('/:id/shares/:shareId', authenticate, problemListEndpoint('移除分享失败', async (req, res) => {
  await deleteProblemListShare(req.user!, req.params.id, req.params.shareId)
  res.json({ success: true, message: '移除成功' })
}))

/**
 * POST /api/problem-lists/:id/publish-homework
 * 将题单发布为作业（平铺所有条目，不保留章节结构）
 */
problemListsRouter.post('/:id/publish-homework', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未登录' })
    }

    const userId = req.user.userId
    const userRole = req.user.role

    // 作业属于校园工作区；个人团队使用比赛/训练能力。
    if (isPersonalContext(req.user)) {
      return res.status(403).json({
        success: false,
        code: 'WORKSPACE_MODE_REQUIRED',
        message: '个人工作区不能发布校园作业',
      })
    }
    if (userRole === 'student') {
      return res.status(403).json({ success: false, message: '学生不能发布作业' })
    }

    const { teamId, title, startTime, endTime, format } = req.body

    if (!teamId) {
      return res.status(400).json({ success: false, message: '必须选择团队' })
    }
    if (!startTime || !endTime) {
      return res.status(400).json({ success: false, message: '必须设置开始和结束时间' })
    }

    // 检查题单权限
    const perm = await getProblemListPermission(req.params.id, req.user as NonNullable<Express.Request['user']>)
    if (!perm || perm === 'view') {
      return res.status(403).json({ success: false, message: '需要编辑权限才能发布作业' })
    }

    // 检查团队权限
    const team = await prisma.team.findUnique({ where: { id: teamId } })
    if (!team || team.scope !== getResourceScope(req.user)) {
      return res.status(404).json({ success: false, message: '团队不存在' })
    }

    // 检查用户是团队管理员
    const member = await prisma.teamMember.findFirst({
      where: { teamId, userId, status: 'active', role: { in: ['owner', 'admin'] } }
    })
    if (!member && userRole !== 'super_admin') {
      return res.status(403).json({ success: false, message: '只有团队管理员可以发布作业' })
    }

    // 获取题单所有条目（平铺，不保留章节）
    const problemList = await prisma.problemList.findUnique({
      where: { id: req.params.id },
      include: {
        ProblemListSection: {
          orderBy: { sortOrder: 'asc' },
          include: {
            ProblemListEntry: {
              orderBy: { sortOrder: 'asc' },
              include: {
                Problem: {
                  include: { ProblemStatement: { where: { isVisible: true } } }
                }
              }
            }
          }
        }
      }
    })

    if (!problemList) {
      return res.status(404).json({ success: false, message: '题单不存在' })
    }

    // 平铺所有条目
    const allEntries = problemList.ProblemListSection.flatMap((s: any) => s.ProblemListEntry)
    if (allEntries.length === 0) {
      return res.status(400).json({ success: false, message: '题单中没有题目，无法发布' })
    }

    // 创建 Training.type = 'homework'
    const homeworkTitle = title || `${problemList.title} - 作业`
    const training = await prisma.training.create({
      data: {
        title: homeworkTitle,
        description: `由题单「${problemList.title}」发布`,
        teamId,
        organizationId: team.organizationId,
        scope: team.scope,
        type: 'homework',
        format: format || 'ioi',
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        status: 'upcoming',
        createdBy: userId,
        problemIdVisible: false,
        solutionVisible: false,
        includeAdminInRanking: false,
      }
    })

    for (const entry of allEntries) await ensureInitialTestSetRevision(entry.problemId, userId)
    const revisionProblems = await prisma.problem.findMany({
      where: { id: { in: allEntries.map((entry: any) => entry.problemId) } },
      include: { LatestTestSetRevision: true },
    })
    const revisionByProblem = new Map(revisionProblems.map(problem => [problem.id, problem]))

    // 为每个条目创建 TrainingProblem（含固定测试版本快照）
    const problemsData = allEntries.map((entry: any, index: number) => {
      const revisionProblem = revisionByProblem.get(entry.problemId)
      const snapshotData = populateSnapshotData({ ...entry.Problem, ...revisionProblem })
      return {
        id: uuidv4(),
        trainingId: training.id,
        problemId: entry.problemId,
        alias: entry.alias || String.fromCharCode(65 + index), // A, B, C...
        orderIndex: index,
        points: null,
        ...snapshotData,
      }
    })

    await prisma.trainingProblem.createMany({ data: problemsData })

    res.json({ success: true, data: { trainingId: training.id, title: homeworkTitle, problemCount: problemsData.length } })
}, '发布作业失败'))
