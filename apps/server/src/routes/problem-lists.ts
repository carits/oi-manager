/**
 * 题单管理 API
 * @description 飞书文档式权限的题单管理系统
 * 3 级结构：题单 (ProblemList) → 章节 (Section) → 题目条目 (Entry)
 * UI 层面：所有章节和题目渲染在同一个页面上，章节仅作二级标题分组
 */

import { Router } from 'express'
import { prisma } from '../prisma'
import {
  authenticate,
  getMembershipType,
  getResourceScope,
  isPersonalMode,
  isPersonalWorkspace,
} from '../middleware/auth'
import logger from '../lib/logger'
import { asyncHandler } from '../lib/asyncHandler'
import { parsePagination, paginatedResponse } from '../lib/pagination'
import { populateSnapshotData } from '../modules/training/training.helpers'
import { v4 as uuidv4 } from 'uuid'
import { findAccessibleProblem, findUsableProblemByExternalId } from '../modules/problem/problem.access'
import { fileService } from '../lib/storage'

export const problemListsRouter = Router()

// ==================== 工具函数 ====================

/**
 * 生成题单 ID（7位随机数字，碰撞时加一位）
 */
async function generateListId(length = 7): Promise<string> {
  const min = Math.pow(10, length - 1)
  const max = Math.pow(10, length) - 1
  let id = String(min + Math.floor(Math.random() * (max - min + 1)))
  // 检查是否已存在，碰撞则加一位重试
  while (await prisma.problemList.findUnique({ where: { id } })) {
    length++
    id = await generateListId(length)
  }
  return id
}

type Permission = 'admin' | 'edit' | 'view'

/** 权限优先级排序 */
const PERM_ORDER: Record<string, number> = { admin: 3, edit: 2, view: 1 }

const managedProblemFilePatterns = [
  /\/api\/files\/([^/?#]+)\/(?:download|public)/g,
  /\/api\/files\/download\/([^/?#]+)/g,
]

function extractManagedProblemFileId(value: string | null | undefined): string | null {
  if (!value) return null
  for (const pattern of managedProblemFilePatterns) {
    pattern.lastIndex = 0
    const match = pattern.exec(value)
    if (match?.[1]) return match[1]
  }
  return null
}

function problemListFileUrl(listId: string, entryId: string, value: string | null | undefined) {
  const fileId = extractManagedProblemFileId(value)
  return fileId ? `/api/problem-lists/${listId}/entries/${entryId}/files/${fileId}` : value ?? null
}

function rewriteProblemListFileUrls(listId: string, entryId: string, content: string | null | undefined) {
  if (!content) return content ?? null
  let rewritten = content
  for (const pattern of managedProblemFilePatterns) {
    pattern.lastIndex = 0
    rewritten = rewritten.replace(pattern, (_url, fileId: string) =>
      `/api/problem-lists/${listId}/entries/${entryId}/files/${fileId}`)
  }
  return rewritten
}

/** 取两个权限中更高的 */
function maxPerm(a: Permission | null, b: Permission | null): Permission | null {
  if (!a) return b
  if (!b) return a
  return PERM_ORDER[a] >= PERM_ORDER[b] ? a : b
}

/**
 * 获取用户对题单的权限
 * 1. owner → admin
 * 2. 查题单级分享（school > team > teacher/student 逐级匹配）
 */
async function getProblemListPermission(
  problemListId: string,
  user: NonNullable<Express.Request['user']>
): Promise<Permission | null> {
  const list = await prisma.problemList.findUnique({
    where: { id: problemListId },
    select: { ownerId: true, scope: true }
  })
  if (!list) return null
  if (list.scope !== getResourceScope(user)) return null

  // owner 全权
  if (list.ownerId === user.userId) return 'admin'

  // 查分享
  const shares = await prisma.problemListShare.findMany({
    where: { problemListId }
  })

  let best: Permission | null = null

  for (const share of shares) {
    let matched = false
    if (share.targetType === getMembershipType(user) && share.targetId === user.userId) {
      matched = true
    }

    if (matched) {
      best = maxPerm(best, share.permission as Permission)
    }
  }

  // 查学校收录：如果题单被收录到用户所在学校，给 view 权限
  // 校园模式下学生不能通过 SchoolProblemList 获得自动 view 权限
  const userSchoolId = isPersonalWorkspace(user) ? null : await getUserSchoolId(user)
  if (userSchoolId && user.role !== 'student') {
    const schoolLink = await prisma.schoolProblemList.findUnique({
      where: { schoolId_problemListId: { schoolId: userSchoolId, problemListId } }
    })
    if (schoolLink) {
      best = maxPerm(best, 'view')
    }
  }

  // 查团队收录：如果题单被收录到用户所在的团队，给 view 权限
  const userId = user.userId
  const userType = getMembershipType(user)
  if (userId) {
    const teamIds = (await prisma.teamMember.findMany({
      where: {
        userId,
        userType,
        status: 'active'
      },
      select: { teamId: true }
    })).map(m => m.teamId)

    if (teamIds.length > 0) {
      const teamLink = await prisma.teamProblemList.findFirst({
        where: { teamId: { in: teamIds }, problemListId }
      })
      if (teamLink) {
        best = maxPerm(best, 'view')
      }
    }
  }

  return best
}

/** 获取用户的 schoolId */
async function getUserSchoolId(user: NonNullable<Express.Request['user']>): Promise<string | null> {
  if (user.role === 'teacher' || user.role === 'school_principal') {
    const t = await prisma.teacher.findUnique({ where: { id: user.userId }, select: { schoolId: true } })
    return t?.schoolId || null
  }
  if (user.role === 'student') {
    const s = await prisma.student.findUnique({ where: { id: user.userId }, select: { schoolId: true } })
    return s?.schoolId || null
  }
  return null
}

/** 乐观锁校验：比对 expectedUpdatedAt 与数据库当前 updatedAt */
function checkOptimisticLock(expectedUpdatedAt: string | undefined, currentUpdatedAt: string | Date): boolean {
  if (!expectedUpdatedAt) return true // 不传则跳过校验（向后兼容）
  return new Date(currentUpdatedAt).getTime() === new Date(expectedUpdatedAt).getTime()
}

/** 从 entryId 反查题单 ID（用于权限校验） */
async function getEntryListId(entryId: string): Promise<string | null> {
  const entry = await prisma.problemListEntry.findUnique({
    where: { id: entryId },
    select: { ProblemListSection: { select: { problemListId: true } } }
  })
  return entry?.ProblemListSection?.problemListId || null
}

/** 从 sectionId 反查题单 ID */
async function getSectionListId(sectionId: string): Promise<string | null> {
  const section = await prisma.problemListSection.findUnique({
    where: { id: sectionId },
    select: { problemListId: true }
  })
  return section?.problemListId || null
}

// ==================== 题单 CRUD ====================

/**
 * GET /api/problem-lists
 * 获取题单列表（我的 + 共享给我的）
 */
problemListsRouter.get('/', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const userId = req.user.userId
    const scope = getResourceScope(req.user)
    const memberType = getMembershipType(req.user)
    const { tab = 'all', keyword = '' } = req.query as Record<string, string>
    const { page, pageSize, skip } = parsePagination(req.query)

    const where: any = { scope }

    if (tab === 'mine') {
      where.ownerId = userId
    } else if (tab === 'shared') {
      where.ownerId = { not: userId }
      where.NOT = { ownerId: userId }
    }

    if (keyword) {
      where.title = { contains: keyword }
    }

    // 如果不是"我的"，需要筛选共享给我的
    if (tab !== 'mine') {
      const sharedListIds = await prisma.problemListShare.findMany({
        where: {
          targetType: memberType,
          targetId: req.user.userId || '__none__',
        },
        select: { problemListId: true }
      })

      if (tab === 'shared') {
        where.id = { in: sharedListIds.map(s => s.problemListId) }
      } else {
        // all: 我的 + 共享的
        where.OR = [
          { ownerId: userId },
          { id: { in: sharedListIds.map(s => s.problemListId) } }
        ]
        delete where.ownerId
        delete where.NOT
      }
    }

    const [lists, total] = await Promise.all([
      prisma.problemList.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
        include: {
          _count: { select: { ProblemListSection: true } }
        }
      }),
      prisma.problemList.count({ where })
    ])

    // 计算每个题单的总题目数（跨章节）
    const listIds = lists.map(l => l.id)
    const entryCounts = await prisma.problemListEntry.groupBy({
      by: ['sectionId'],
      where: {
        ProblemListSection: { problemListId: { in: listIds } }
      },
      _count: true
    })

    // 建立 sectionId → listId 映射
    const sections = await prisma.problemListSection.findMany({
      where: { problemListId: { in: listIds } },
      select: { id: true, problemListId: true }
    })
    const sectionToList = new Map(sections.map(s => [s.id, s.problemListId]))

    // 汇总每个题单的总题目数
    const totalCounts = new Map<string, number>()
    for (const ec of entryCounts) {
      const listId = sectionToList.get(ec.sectionId)
      if (listId) {
        totalCounts.set(listId, (totalCounts.get(listId) || 0) + ec._count)
      }
    }

    const result = lists.map(l => ({
      ...l,
      _count: { Entries: totalCounts.get(l.id) || 0 }
    }))

    // 计算当前用户对每个题单的权限
    const userShares = await prisma.problemListShare.findMany({
      where: {
        problemListId: { in: listIds },
        targetType: memberType,
        targetId: req.user.userId || '__none__',
      },
      select: { problemListId: true, permission: true }
    })
    const shareMap = new Map(userShares.map(s => [s.problemListId, s.permission]))

    const enriched = result.map(l => ({
      ...l,
      _permission: l.ownerId === userId ? 'admin' : (shareMap.get(l.id) || 'view')
    }))

    res.json({
      success: true,
      data: {
        lists: enriched,
        ...paginatedResponse(enriched, total, page, pageSize),
      }
    })
}, '获取题单列表失败'))

/**
 * POST /api/problem-lists
 * 创建题单（同时创建一个默认章节）
 */
problemListsRouter.post('/', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    // 校园模式：学生不能创建题单；个人模式可以
    if (req.user.role === 'student' && !isPersonalMode(req.user)) {
      res.status(403).json({ success: false, message: '校园模式下学生不能创建题单' })
      return
    }

    const { title, description, visibility } = req.body
    if (!title || !title.trim()) {
      res.status(400).json({ success: false, message: '标题不能为空' })
      return
    }

    const scope = getResourceScope(req.user)
    const schoolId = scope === 'campus'
      ? await getUserSchoolId(req.user as NonNullable<Express.Request['user']>)
      : null
    const ownerType = getMembershipType(req.user)

    const list = await prisma.problemList.create({
      data: {
        id: await generateListId(),
        title: title.trim(),
        description: description?.trim() || null,
        schoolId,
        scope,
        ownerId: req.user.userId,
        ownerType,
        visibility: visibility || 'private',
        ProblemListSection: {
          create: { id: crypto.randomUUID(), title: '默认章节', sortOrder: 0 }
        }
      },
      include: { ProblemListSection: true }
    })

    res.json({ success: true, data: list })
}, '创建题单失败'))

/**
 * GET /api/problem-lists/:id
 * 题单详情（含章节 → 题目条目）
 */
problemListsRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const list = await prisma.problemList.findUnique({
      where: { id: req.params.id },
      include: {
        ProblemListSection: {
          orderBy: { sortOrder: 'asc' },
          include: {
            ProblemListEntry: {
              orderBy: { sortOrder: 'asc' },
              include: {
                Problem: {
                  select: {
                    id: true,
                    platform: true,
                    problemId: true,
                    title: true,
                    difficulty: true,
                    ojBindings: true,
                  }
                }
              }
            }
          }
        },
        ProblemListShare: true
      }
    })

    if (!list || list.scope !== getResourceScope(req.user)) {
      res.status(404).json({ success: false, message: '题单不存在' })
      return
    }

    // 权限检查
    const perm = await getProblemListPermission(req.params.id, req.user as NonNullable<Express.Request['user']>)
    if (!perm) {
      res.status(403).json({ success: false, message: '无权限查看' })
      return
    }

    // Enrich Shares with targetName, targetAvatar, targetUsername
    const enrichedShares = await Promise.all((list.ProblemListShare || []).map(async (share) => {
      let targetName = ''
      let targetAvatar: string | null = null
      let targetUsername = ''
      if (share.targetType === 'teacher') {
        const t = await prisma.teacher.findUnique({ where: { id: share.targetId }, select: { name: true, avatar: true, User: { select: { username: true } } } })
        targetName = t?.name || share.targetId
        targetAvatar = t?.avatar || null
        targetUsername = t?.User?.username || ''
      } else if (share.targetType === 'student') {
        const s = await prisma.student.findUnique({ where: { id: share.targetId }, select: { name: true, avatar: true, User: { select: { username: true } } } })
        targetName = s?.name || share.targetId
        targetAvatar = s?.avatar || null
        targetUsername = s?.User?.username || ''
      } else if (share.targetType === 'user') {
        const u = await prisma.user.findUnique({ where: { id: share.targetId }, select: { username: true, avatar: true } })
        targetName = u?.username || share.targetId
        targetAvatar = u?.avatar || null
        targetUsername = u?.username || ''
      } else {
        targetName = share.targetId
      }
      return { ...share, targetName, targetAvatar, targetUsername }
    }))

    // 学生视角脱敏
    const isStudent = req.user.role === 'student' && !isPersonalWorkspace(req.user)
    const sanitizedList = isStudent ? {
      ...list,
      ProblemListSection: list.ProblemListSection.map((section: any) => ({
        ...section,
        ProblemListEntry: section.ProblemListEntry.map((entry: any) => sanitizeEntryForStudent(entry)),
      })),
      ProblemListShare: [], // 学生不需要看分享列表
    } : list

    res.json({ success: true, data: { ...sanitizedList, Shares: isStudent ? [] : enrichedShares, _permission: perm || 'admin' } })
}, '获取题单详情失败'))

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
      ProblemListSection: { select: { ProblemList: { select: { scope: true, schoolId: true } } } },
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
      (list.scope !== 'campus' || !list.schoolId || list.schoolId !== entry.Problem.schoolId)) {
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
      ProblemListSection: { select: { ProblemList: { select: { scope: true, schoolId: true } } } },
      Problem: {
        select: {
          id: true,
          status: true,
          libraryScope: true,
          schoolId: true,
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
      (list.scope !== 'campus' || !list.schoolId || list.schoolId !== entry.Problem.schoolId)) {
    return res.status(404).json({ success: false, message: '资源不存在' })
  }

  const allowedIds = new Set<string>()
  const allowUrl = (url: string | null | undefined) => {
    const id = extractManagedProblemFileId(url)
    if (id) allowedIds.add(id)
  }
  const allowContent = (content: string | null | undefined) => {
    if (!content) return
    for (const pattern of managedProblemFilePatterns) {
      pattern.lastIndex = 0
      for (const match of content.matchAll(pattern)) if (match[1]) allowedIds.add(match[1])
    }
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

/** 学生视角题单详情脱敏：只保留 title 和 difficulty */
function sanitizeProblemForStudent(problem: any): any {
  return {
    title: problem.title,
    difficulty: problem.difficulty,
  }
}

/** 学生视角条目脱敏：隐藏 problemId */
function sanitizeEntryForStudent(entry: any): any {
  const { problemId, ...rest } = entry
  return {
    ...rest,
    problemId: undefined,
    Problem: entry.Problem ? sanitizeProblemForStudent(entry.Problem) : undefined,
  }
}

/**
 * PUT /api/problem-lists/:id
 * 更新题单元信息
 */
problemListsRouter.put('/:id', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    // 校园模式：学生不能编辑题单；个人模式可以编辑自己的
    if (req.user.role === 'student' && !isPersonalMode(req.user)) {
      res.status(403).json({ success: false, message: '校园模式下学生不能编辑题单' })
      return
    }

    const list = await prisma.problemList.findUnique({ where: { id: req.params.id } })
    if (!list) {
      res.status(404).json({ success: false, message: '题单不存在' })
      return
    }

    const perm = await getProblemListPermission(req.params.id, req.user as NonNullable<Express.Request['user']>)
    if (perm !== 'admin' && perm !== 'edit') {
      res.status(403).json({ success: false, message: '无权限编辑' })
      return
    }

    // 乐观锁校验
    const { title, description, visibility, sortOrder, coverUrl, expectedUpdatedAt } = req.body
    if (!checkOptimisticLock(expectedUpdatedAt, list.updatedAt)) {
      res.status(409).json({ success: false, message: '题单已被其他人修改，请刷新后重试', code: 'CONFLICT' })
      return
    }
    const data: any = {}
    if (title !== undefined) data.title = title.trim()
    if (description !== undefined) data.description = description?.trim() || null
    if (visibility !== undefined) data.visibility = visibility
    if (sortOrder !== undefined) data.sortOrder = sortOrder
    if (coverUrl !== undefined) data.coverUrl = coverUrl

    const updated = await prisma.problemList.update({
      where: { id: req.params.id },
      data
    })

    res.json({ success: true, data: updated })
}, '更新题单失败'))

/**
 * DELETE /api/problem-lists/:id
 * 硬删除题单（级联删除章节→条目→分享）
 */
problemListsRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    // 校园模式：学生不能删除题单；个人模式可以删除自己的
    if (req.user.role === 'student' && !isPersonalMode(req.user)) {
      res.status(403).json({ success: false, message: '校园模式下学生不能删除题单' })
      return
    }

    const list = await prisma.problemList.findUnique({ where: { id: req.params.id } })
    if (!list) {
      res.status(404).json({ success: false, message: '题单不存在' })
      return
    }

    if (list.ownerId !== req.user.userId) {
      res.status(403).json({ success: false, message: '只有创建者可以删除题单' })
      return
    }

    // 检查题单是否被学校或团队收录
    const [schoolLink, teamLink] = await Promise.all([
      prisma.schoolProblemList.findFirst({ where: { problemListId: list.id } }),
      prisma.teamProblemList.findFirst({ where: { problemListId: list.id } })
    ])
    if (schoolLink || teamLink) {
      res.status(403).json({ success: false, message: '该题单已被学校或团队收录，请先从题单库中移除后再删除' })
      return
    }

    // 硬删除（Prisma schema 中已配置 onDelete: Cascade）
    await prisma.problemList.delete({ where: { id: req.params.id } })

    res.json({ success: true, message: '删除成功' })
}, '删除题单失败'))

// ==================== 章节 CRUD ====================

/**
 * POST /api/problem-lists/:id/sections
 * 添加章节
 */
problemListsRouter.post('/:id/sections', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const perm = await getProblemListPermission(req.params.id, req.user as NonNullable<Express.Request['user']>)
    if (perm !== 'admin' && perm !== 'edit') {
      res.status(403).json({ success: false, message: '无权限添加章节' })
      return
    }

    const { title } = req.body as { title: string }
    if (!title || !title.trim()) {
      res.status(400).json({ success: false, message: '章节标题不能为空' })
      return
    }

    // 获取当前最大 sortOrder
    const maxSection = await prisma.problemListSection.findFirst({
      where: { problemListId: req.params.id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true }
    })

    const section = await prisma.problemListSection.create({
      data: {
        id: crypto.randomUUID(),
        problemListId: req.params.id,
        title: title.trim(),
        sortOrder: (maxSection?.sortOrder ?? -1) + 1
      }
    })

    res.json({ success: true, data: section })
}, '添加章节失败'))

/**
 * PUT /api/problem-lists/sections/:sectionId
 * 更新章节（标题 / sortOrder）
 */
problemListsRouter.put('/sections/:sectionId', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const listId = await getSectionListId(req.params.sectionId)
    if (!listId) {
      res.status(404).json({ success: false, message: '章节不存在' })
      return
    }

    const perm = await getProblemListPermission(listId, req.user as NonNullable<Express.Request['user']>)
    if (perm !== 'admin' && perm !== 'edit') {
      res.status(403).json({ success: false, message: '无权限编辑' })
      return
    }

    // 乐观锁校验（基于题单级 updatedAt）
    const { title, sortOrder, expectedUpdatedAt } = req.body
    if (expectedUpdatedAt) {
      const currentList = await prisma.problemList.findUnique({ where: { id: listId }, select: { updatedAt: true } })
      if (!checkOptimisticLock(expectedUpdatedAt, currentList!.updatedAt)) {
        res.status(409).json({ success: false, message: '题单已被其他人修改，请刷新后重试', code: 'CONFLICT' })
        return
      }
    }
    const data: any = {}
    if (title !== undefined) data.title = title.trim()
    if (sortOrder !== undefined) data.sortOrder = sortOrder

    const updated = await prisma.problemListSection.update({
      where: { id: req.params.sectionId },
      data
    })

    res.json({ success: true, data: updated })
}, '更新章节失败'))

/**
 * DELETE /api/problem-lists/sections/:sectionId
 * 删除章节（级联删除其下所有条目）
 */
problemListsRouter.delete('/sections/:sectionId', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const listId = await getSectionListId(req.params.sectionId)
    if (!listId) {
      res.status(404).json({ success: false, message: '章节不存在' })
      return
    }

    const perm = await getProblemListPermission(listId, req.user as NonNullable<Express.Request['user']>)
    if (perm !== 'admin' && perm !== 'edit') {
      res.status(403).json({ success: false, message: '无权限删除' })
      return
    }

    // 检查是否是最后一个章节
    const sectionCount = await prisma.problemListSection.count({
      where: { problemListId: listId }
    })
    if (sectionCount <= 1) {
      res.status(400).json({ success: false, message: '至少保留一个章节' })
      return
    }

    await prisma.problemListSection.delete({ where: { id: req.params.sectionId } })
    res.json({ success: true, message: '删除成功' })
}, '删除章节失败'))

/**
 * PUT /api/problem-lists/:id/sections/reorder
 * 重排章节顺序
 */
problemListsRouter.put('/:id/sections/reorder', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const perm = await getProblemListPermission(req.params.id, req.user as NonNullable<Express.Request['user']>)
    if (perm !== 'admin' && perm !== 'edit') {
      res.status(403).json({ success: false, message: '无权限排序' })
      return
    }

    const { sectionIds } = req.body as { sectionIds: string[] }
    if (!Array.isArray(sectionIds)) {
      res.status(400).json({ success: false, message: '参数错误' })
      return
    }

    await prisma.$transaction(
      sectionIds.map((id: string, index: number) =>
        prisma.problemListSection.update({
          where: { id },
          data: { sortOrder: index }
        })
      )
    )

    res.json({ success: true })
}, '排序失败'))

// ==================== 题目条目 CRUD ====================

/**
 * POST /api/problem-lists/sections/:sectionId/entries/single
 * 单条添加题目到指定章节（VJudge 逐行输入）
 */
problemListsRouter.post('/sections/:sectionId/entries/single', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const listId = await getSectionListId(req.params.sectionId)
    if (!listId) {
      res.status(404).json({ success: false, message: '章节不存在' })
      return
    }

    const perm = await getProblemListPermission(listId, req.user as NonNullable<Express.Request['user']>)
    if (perm !== 'admin' && perm !== 'edit') {
      res.status(403).json({ success: false, message: '无权限添加题目' })
      return
    }

    const { ojName, problemCode, alias, notes, problemId: directProblemId } = req.body as {
      ojName: string
      problemCode: string
      alias?: string
      notes?: string
      problemId?: string
    }

    if (!ojName || !problemCode) {
      res.status(400).json({ success: false, message: 'OJ 平台和题号不能为空' })
      return
    }

    let problemId: string
    let problemTitle: string
    let found = false

    // 如果前端直接传了 problemId（来自 resolve 的结果），跳过搜索直接使用
    if (directProblemId) {
      const p = await findAccessibleProblem(req.user, directProblemId, 'use')
      if (!p) {
        res.status(404).json({ success: false, message: '题目不存在' })
        return
      }
      problemId = p.id
      problemTitle = p.title
      found = true
    } else if (ojName === 'carits') {
      // Carits 平台：按 platform + problemId 查本地题库
      const matched = await findUsableProblemByExternalId(req.user, 'carits', problemCode)
      if (matched) {
        problemId = matched.id
        problemTitle = matched.title
        found = true
      } else {
        res.status(404).json({ success: false, message: '题库中未找到该题目，或无权访问' })
        return
      }
    } else {
      // 外部 OJ：按 platform + problemId 直接查
      const p = await findUsableProblemByExternalId(req.user, ojName, problemCode)

      if (p) {
        problemId = p.id
        problemTitle = p.title
        found = true
      }

      if (!found) {
        res.status(404).json({ success: false, message: '题库中未找到该题目' })
        return
      }
    }

    const [selectedProblem, targetList] = await Promise.all([
      prisma.problem.findUnique({ where: { id: problemId! }, select: { libraryScope: true, schoolId: true } }),
      prisma.problemList.findUnique({ where: { id: listId }, select: { scope: true, schoolId: true } }),
    ])
    if (!selectedProblem || !targetList || (selectedProblem.libraryScope === 'school'
      && (targetList.scope !== 'campus' || targetList.schoolId !== selectedProblem.schoolId))) {
      res.status(404).json({ success: false, message: '题目不存在' })
      return
    }

    // 3. 检查是否已在章节中
    const existing = await prisma.problemListEntry.findUnique({
      where: {
        sectionId_problemId: {
          sectionId: req.params.sectionId,
          problemId: problemId!
        }
      }
    })

    if (existing) {
      res.status(409).json({
        success: false,
        message: '该题目已在此章节中',
        data: { entryId: existing.id, problemId: problemId!, title: problemTitle!, found }
      })
      return
    }

    // 4. 获取当前最大 sortOrder
    const maxSortEntry = await prisma.problemListEntry.findFirst({
      where: { sectionId: req.params.sectionId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true }
    })

    // 5. 创建条目
    const entry = await prisma.problemListEntry.create({
      data: {
        id: crypto.randomUUID(),
        sectionId: req.params.sectionId,
        problemId: problemId!,
        alias: alias?.trim() || null,
        notes: notes?.trim() || null,
        ojName: ojName,
        sortOrder: (maxSortEntry?.sortOrder ?? -1) + 1
      },
      include: {
        Problem: {
          select: {
            id: true,
            platform: true,
            problemId: true,
            title: true,
            difficulty: true,
            ojBindings: true,
          }
        }
      }
    })

    res.json({
      success: true,
      data: { entry, found, created: !found }
    })
}, '添加题目失败'))

/**
 * POST /api/problem-lists/:id/entries/resolve
 * 批量解析题号 → 查找/创建 Problem 记录（不创建 Entry，仅预览）
 */
problemListsRouter.post('/:id/entries/resolve', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const perm = await getProblemListPermission(req.params.id, req.user as NonNullable<Express.Request['user']>)
    if (perm !== 'admin' && perm !== 'edit') {
      res.status(403).json({ success: false, message: '无权限操作' })
      return
    }

    const { items } = req.body as {
      items: Array<{ ojName: string; problemCode: string }>
    }

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, message: '参数错误' })
      return
    }

    // 获取题单下所有已有条目的 problemId
    const sections = await prisma.problemListSection.findMany({
      where: { problemListId: req.params.id },
      select: { id: true }
    })
    const sectionIds = sections.map(s => s.id)

    const existingEntries = await prisma.problemListEntry.findMany({
      where: { sectionId: { in: sectionIds } },
      select: { problemId: true }
    })
    const existingProblemIds = new Set(existingEntries.map(e => e.problemId))

    const resolved: Array<{
      problemId: string
      title: string
      ojName: string
      problemCode: string
      found: boolean
      created: boolean
      duplicate: boolean
    }> = []

    for (const item of items) {
      let matched: { id: string; title: string } | null = null

      if (item.ojName === 'carits') {
        // Carits 平台：按 ID 或 problemId 查本地题库
        let p = await findAccessibleProblem(req.user, item.problemCode, 'use').catch(() => null)
        if (!p) {
          p = await findUsableProblemByExternalId(req.user, 'carits', item.problemCode)
        }
        if (p) matched = { id: p.id, title: p.title }
      } else {
        // 外部 OJ：按 platform + problemId 直接查
        const p = await findUsableProblemByExternalId(req.user, item.ojName, item.problemCode)
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
          duplicate: existingProblemIds.has(matched.id)
        })
      } else if (item.ojName === 'carits') {
        // Carits 平台题目不存在，标记为未找到（不自动创建）
        resolved.push({
          problemId: '',
          title: '题库中未找到',
          ojName: item.ojName,
          problemCode: item.problemCode,
          found: false,
          created: false,
          duplicate: false
        })
      } else {
        // 外部 OJ：未找到匹配，不自动创建，返回 found: false
        resolved.push({
          problemId: '',
          title: '题库中未找到',
          ojName: item.ojName,
          problemCode: item.problemCode,
          found: false,
          created: false,
          duplicate: false
        })
      }
    }

    res.json({ success: true, data: { resolved } })
}, '解析题号失败'))

/**
 * PUT /api/problem-lists/entries/:entryId
 * 更新条目（alias / notes / sortOrder）
 */
problemListsRouter.put('/entries/:entryId', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const listId = await getEntryListId(req.params.entryId)
    if (!listId) {
      res.status(404).json({ success: false, message: '条目不存在' })
      return
    }

    const perm = await getProblemListPermission(listId, req.user as NonNullable<Express.Request['user']>)
    if (perm !== 'admin' && perm !== 'edit') {
      res.status(403).json({ success: false, message: '无权限编辑' })
      return
    }

    // 乐观锁校验（基于题单级 updatedAt）
    const { alias, notes, sortOrder, expectedUpdatedAt } = req.body
    if (expectedUpdatedAt) {
      const currentList = await prisma.problemList.findUnique({ where: { id: listId }, select: { updatedAt: true } })
      if (!checkOptimisticLock(expectedUpdatedAt, currentList!.updatedAt)) {
        res.status(409).json({ success: false, message: '题单已被其他人修改，请刷新后重试', code: 'CONFLICT' })
        return
      }
    }
    const data: any = {}
    if (alias !== undefined) data.alias = alias?.trim() || null
    if (notes !== undefined) data.notes = notes?.trim() || null
    if (sortOrder !== undefined) data.sortOrder = sortOrder

    const updated = await prisma.problemListEntry.update({
      where: { id: req.params.entryId },
      data,
      include: {
        Problem: {
          select: {
            id: true,
            platform: true,
            problemId: true,
            title: true,
            difficulty: true,
            ojBindings: true,
          }
        }
      }
    })

    res.json({ success: true, data: updated })
}, '更新条目失败'))
problemListsRouter.delete('/entries/:entryId', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const listId = await getEntryListId(req.params.entryId)
    if (!listId) {
      res.status(404).json({ success: false, message: '条目不存在' })
      return
    }

    const perm = await getProblemListPermission(listId, req.user as NonNullable<Express.Request['user']>)
    if (perm !== 'admin' && perm !== 'edit') {
      res.status(403).json({ success: false, message: '无权限删除' })
      return
    }

    await prisma.problemListEntry.delete({ where: { id: req.params.entryId } })
    res.json({ success: true, message: '删除成功' })
}, '删除条目失败'))

/**
 * PUT /api/problem-lists/sections/:sectionId/entries/reorder
 * 重排某章节内的条目顺序
 */
problemListsRouter.put('/sections/:sectionId/entries/reorder', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const listId = await getSectionListId(req.params.sectionId)
    if (!listId) {
      res.status(404).json({ success: false, message: '章节不存在' })
      return
    }

    const perm = await getProblemListPermission(listId, req.user as NonNullable<Express.Request['user']>)
    if (perm !== 'admin' && perm !== 'edit') {
      res.status(403).json({ success: false, message: '无权限排序' })
      return
    }

    const { entryIds } = req.body as { entryIds: string[] }
    if (!Array.isArray(entryIds)) {
      res.status(400).json({ success: false, message: '参数错误' })
      return
    }

    await prisma.$transaction(
      entryIds.map((id: string, index: number) =>
        prisma.problemListEntry.update({
          where: { id },
          data: { sortOrder: index }
        })
      )
    )

    res.json({ success: true })
}, '排序失败'))


/**
 * GET /api/problem-lists/:id/shares
 * 获取题单分享列表
 */
problemListsRouter.get('/:id/shares', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const perm = await getProblemListPermission(req.params.id, req.user as NonNullable<Express.Request['user']>)
    if (perm !== 'admin') {
      res.status(403).json({ success: false, message: '无权限管理分享' })
      return
    }

    const shares = await prisma.problemListShare.findMany({
      where: { problemListId: req.params.id },
      orderBy: { createdAt: 'asc' }
    })

    // 解析分享目标名称
    const enrichedShares = await Promise.all(shares.map(async (share) => {
      let targetName = ''
      let avatar: string | null = null
      let username = ''
      if (share.targetType === 'teacher') {
        const t = await prisma.teacher.findUnique({ where: { id: share.targetId }, select: { name: true, avatar: true, User: { select: { username: true } } } })
        targetName = t?.name || share.targetId
        avatar = t?.avatar || null
        username = t?.User?.username || ''
      } else if (share.targetType === 'student') {
        const s = await prisma.student.findUnique({ where: { id: share.targetId }, select: { name: true, avatar: true, User: { select: { username: true } } } })
        targetName = s?.name || share.targetId
        avatar = s?.avatar || null
        username = s?.User?.username || ''
      } else if (share.targetType === 'user') {
        const u = await prisma.user.findUnique({ where: { id: share.targetId }, select: { username: true, avatar: true } })
        targetName = u?.username || share.targetId
        avatar = u?.avatar || null
        username = u?.username || ''
      } else {
        targetName = share.targetId
      }

      return { ...share, targetName, targetAvatar: avatar, targetUsername: username }
    }))

    res.json({ success: true, data: enrichedShares })
}, '获取分享列表失败'))

/**
 * GET /api/problem-lists/:id/share-candidates
 * 搜索本校可分享的教师/学生
 */
problemListsRouter.get('/:id/share-candidates', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const list = await prisma.problemList.findUnique({ where: { id: req.params.id } })
    if (!list || list.scope !== getResourceScope(req.user)) {
      res.status(404).json({ success: false, message: '题单不存在' })
      return
    }

    if (list.ownerId !== req.user.userId) {
      res.status(403).json({ success: false, message: '只有创建者可以管理分享' })
      return
    }

    const personal = isPersonalWorkspace(req.user)
    const requestedType = typeof req.query.type === 'string' ? req.query.type : 'teacher'
    const type = personal ? 'user' : requestedType
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword : ''
    const schoolId = list.schoolId

    // 已分享的人
    const existingShares = await prisma.problemListShare.findMany({
      where: { problemListId: req.params.id, targetType: type },
      select: { targetId: true }
    })
    const excludeIds = new Set(existingShares.map(s => s.targetId))
    excludeIds.add(list.ownerId) // 排除 owner 自己

    if (personal) {
      const users = await prisma.user.findMany({
        where: {
          id: { notIn: [...excludeIds] },
          status: 'active',
          PersonalProfile: { isNot: null },
          ...(keyword ? { username: { contains: keyword, mode: 'insensitive' } } : {}),
        },
        select: { id: true, username: true, avatar: true },
        orderBy: { username: 'asc' },
        take: 20,
      })
      return res.json({
        success: true,
        data: users.map(user => ({
          id: user.id,
          name: user.username,
          type: 'user',
          username: user.username,
          avatar: user.avatar,
        })),
      })
    }

    const where: any = { schoolId }
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { User: { username: { contains: keyword } } }
      ]
    }

    let candidates: Array<{ id: string; name: string; type: string; username: string }> = []

    if (type === 'teacher') {
      const teachers = await prisma.teacher.findMany({
        where,
        select: { id: true, name: true, User: { select: { username: true, avatar: true } } },
        take: 20
      })
      candidates = teachers
        .filter(t => !excludeIds.has(t.id))
        .map(t => ({ id: t.id, name: t.name, type: 'teacher', username: t.User.username, avatar: t.User.avatar }))
    } else {
      const students = await prisma.student.findMany({
        where,
        select: { id: true, name: true, User: { select: { username: true, avatar: true } } },
        take: 20
      })
      candidates = students
        .filter(s => !excludeIds.has(s.id))
        .map(s => ({ id: s.id, name: s.name, type: 'student', username: s.User.username, avatar: s.User.avatar }))
    }

    res.json({ success: true, data: candidates })
}, '搜索失败'))

/**
 * POST /api/problem-lists/:id/shares
 * 添加/更新分享
 */
problemListsRouter.post('/:id/shares', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    // 校园模式：学生不能管理分享；个人模式可以管理自己的
    if (req.user.role === 'student' && !isPersonalMode(req.user)) {
      res.status(403).json({ success: false, message: '校园模式下学生不能管理题单分享' })
      return
    }

    const list = await prisma.problemList.findUnique({ where: { id: req.params.id } })
    if (!list || list.scope !== getResourceScope(req.user)) {
      res.status(404).json({ success: false, message: '题单不存在' })
      return
    }

    if (list.ownerId !== req.user.userId) {
      res.status(403).json({ success: false, message: '只有创建者可以管理分享' })
      return
    }

    const { targetType, targetId, permission } = req.body
    const allowedTargetTypes = isPersonalWorkspace(req.user) ? ['user'] : ['teacher', 'student']
    if (!allowedTargetTypes.includes(targetType)) {
      res.status(400).json({ success: false, message: '分享对象与当前工作区不匹配' })
      return
    }
    if (!['view', 'edit'].includes(permission)) {
      res.status(400).json({ success: false, message: '无效的权限级别' })
      return
    }

    // upsert
    const share = await prisma.problemListShare.upsert({
      where: {
        problemListId_targetType_targetId: {
          problemListId: req.params.id,
          targetType,
          targetId
        }
      },
      create: {
        id: crypto.randomUUID(),
        problemListId: req.params.id,
        targetType,
        targetId,
        permission,
        sharedBy: req.user.userId
      },
      update: {
        permission,
        sharedBy: req.user.userId
      }
    })

    res.json({ success: true, data: share })
}, '添加分享失败'))

/**
 * DELETE /api/problem-lists/:id/shares/:shareId
 * 移除分享
 */
problemListsRouter.delete('/:id/shares/:shareId', authenticate, asyncHandler(async (req, res) => {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const list = await prisma.problemList.findUnique({ where: { id: req.params.id } })
    if (!list || list.scope !== getResourceScope(req.user)) {
      res.status(404).json({ success: false, message: '题单不存在' })
      return
    }

    if (list.ownerId !== req.user.userId) {
      res.status(403).json({ success: false, message: '只有创建者可以管理分享' })
      return
    }

    await prisma.problemListShare.delete({ where: { id: req.params.shareId } })
    res.json({ success: true, message: '移除成功' })
}, '移除分享失败'))

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
    if (isPersonalWorkspace(req.user)) {
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
        schoolId: team.schoolId,
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

    // 为每个条目创建 TrainingProblem（含快照）
    const problemsData = allEntries.map((entry: any, index: number) => {
      const snapshotData = populateSnapshotData(entry.Problem)
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
