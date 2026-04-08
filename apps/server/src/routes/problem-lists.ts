/**
 * 题单管理 API
 * @description 飞书文档式权限的题单管理系统
 * 3 级结构：题单 (ProblemList) → 章节 (Section) → 题目条目 (Entry)
 * UI 层面：所有章节和题目渲染在同一个页面上，章节仅作二级标题分组
 */

import { Router } from 'express'
import { prisma } from '../prisma'
import { authenticate } from '../middleware/auth'
import logger from '../lib/logger'

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
    select: { ownerId: true }
  })
  if (!list) return null

  // owner 全权
  if (list.ownerId === user.userId) return 'admin'

  // 查分享
  const shares = await prisma.problemListShare.findMany({
    where: { problemListId }
  })

  let best: Permission | null = null

  for (const share of shares) {
    let matched = false
    if (share.targetType === 'teacher' && share.targetId === user.teacherId) {
      matched = true
    } else if (share.targetType === 'student' && share.targetId === user.studentId) {
      matched = true
    }

    if (matched) {
      best = maxPerm(best, share.permission as Permission)
    }
  }

  // 查学校收录：如果题单被收录到用户所在学校，给 view 权限
  const userSchoolId = await getUserSchoolId(user)
  if (userSchoolId) {
    const schoolLink = await prisma.schoolProblemList.findUnique({
      where: { schoolId_problemListId: { schoolId: userSchoolId, problemListId } }
    })
    if (schoolLink) {
      best = maxPerm(best, 'view')
    }
  }

  // 查团队收录：如果题单被收录到用户所在的团队，给 view 权限
  const teacherId = user.teacherId
  const studentId = user.studentId
  if (teacherId || studentId) {
    const teamIds = (await prisma.teamMember.findMany({
      where: {
        OR: [
          ...(teacherId ? [{ userId: teacherId, userType: 'teacher' }] : []),
          ...(studentId ? [{ userId: studentId, userType: 'student' }] : [])
        ],
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
  if (user.teacherId) {
    const t = await prisma.teacher.findUnique({ where: { id: user.teacherId }, select: { schoolId: true } })
    return t?.schoolId || null
  }
  if (user.studentId) {
    const s = await prisma.student.findUnique({ where: { id: user.studentId }, select: { schoolId: true } })
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
    select: { Section: { select: { problemListId: true } } }
  })
  return entry?.Section?.problemListId || null
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
problemListsRouter.get('/', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const userId = req.user.userId
    const { tab = 'all', page = '1', pageSize = '20', keyword = '' } = req.query as Record<string, string>
    const p = parseInt(page)
    const ps = parseInt(pageSize)

    const where: any = {}

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
          OR: [
            { targetType: 'teacher', targetId: req.user.teacherId || '__none__' },
            { targetType: 'student', targetId: req.user.studentId || '__none__' },
          ]
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
        skip: (p - 1) * ps,
        take: ps,
        include: {
          _count: { select: { Sections: true } }
        }
      }),
      prisma.problemList.count({ where })
    ])

    // 计算每个题单的总题目数（跨章节）
    const listIds = lists.map(l => l.id)
    const entryCounts = await prisma.problemListEntry.groupBy({
      by: ['sectionId'],
      where: {
        Section: { problemListId: { in: listIds } }
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
        OR: [
          { targetType: 'teacher', targetId: req.user.teacherId || '__none__' },
          { targetType: 'student', targetId: req.user.studentId || '__none__' },
        ]
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
        page: p,
        pageSize: ps,
        total,
        totalPages: Math.ceil(total / ps)
      }
    })
  } catch (error) {
    logger.error('get_problem_lists_error', error)
    res.status(500).json({ success: false, message: '获取题单列表失败' })
  }
})

/**
 * POST /api/problem-lists
 * 创建题单（同时创建一个默认章节）
 */
problemListsRouter.post('/', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const { title, description, visibility } = req.body
    if (!title || !title.trim()) {
      res.status(400).json({ success: false, message: '标题不能为空' })
      return
    }

    const schoolId = await getUserSchoolId(req.user as NonNullable<Express.Request['user']>)
    const ownerType = req.user.teacherId ? 'teacher' : 'student'

    const list = await prisma.problemList.create({
      data: {
        id: await generateListId(),
        title: title.trim(),
        description: description?.trim() || null,
        schoolId,
        ownerId: req.user.userId,
        ownerType,
        visibility: visibility || 'private',
        Sections: {
          create: { title: '默认章节', sortOrder: 0 }
        }
      },
      include: { Sections: true }
    })

    res.json({ success: true, data: list })
  } catch (error) {
    logger.error('create_problem_list_error', error)
    res.status(500).json({ success: false, message: '创建题单失败' })
  }
})

/**
 * GET /api/problem-lists/:id
 * 题单详情（含章节 → 题目条目）
 */
problemListsRouter.get('/:id', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const list = await prisma.problemList.findUnique({
      where: { id: req.params.id },
      include: {
        Sections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            Entries: {
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
        Shares: true
      }
    })

    if (!list) {
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
    const enrichedShares = await Promise.all((list.Shares || []).map(async (share) => {
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
      } else {
        targetName = share.targetId
      }
      return { ...share, targetName, targetAvatar, targetUsername }
    }))

    res.json({ success: true, data: { ...list, Shares: enrichedShares, _permission: perm || 'admin' } })
  } catch (error) {
    logger.error('get_problem_list_error', error)
    res.status(500).json({ success: false, message: '获取题单详情失败' })
  }
})

/**
 * PUT /api/problem-lists/:id
 * 更新题单元信息
 */
problemListsRouter.put('/:id', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
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
  } catch (error) {
    logger.error('update_problem_list_error', error)
    res.status(500).json({ success: false, message: '更新题单失败' })
  }
})

/**
 * DELETE /api/problem-lists/:id
 * 硬删除题单（级联删除章节→条目→分享）
 */
problemListsRouter.delete('/:id', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
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
  } catch (error) {
    logger.error('delete_problem_list_error', error)
    res.status(500).json({ success: false, message: '删除题单失败' })
  }
})

// ==================== 章节 CRUD ====================

/**
 * POST /api/problem-lists/:id/sections
 * 添加章节
 */
problemListsRouter.post('/:id/sections', authenticate, async (req, res) => {
  try {
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
        problemListId: req.params.id,
        title: title.trim(),
        sortOrder: (maxSection?.sortOrder ?? -1) + 1
      }
    })

    res.json({ success: true, data: section })
  } catch (error) {
    logger.error('create_section_error', error)
    res.status(500).json({ success: false, message: '添加章节失败' })
  }
})

/**
 * PUT /api/problem-lists/sections/:sectionId
 * 更新章节（标题 / sortOrder）
 */
problemListsRouter.put('/sections/:sectionId', authenticate, async (req, res) => {
  try {
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
  } catch (error) {
    logger.error('update_section_error', error)
    res.status(500).json({ success: false, message: '更新章节失败' })
  }
})

/**
 * DELETE /api/problem-lists/sections/:sectionId
 * 删除章节（级联删除其下所有条目）
 */
problemListsRouter.delete('/sections/:sectionId', authenticate, async (req, res) => {
  try {
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
  } catch (error) {
    logger.error('delete_section_error', error)
    res.status(500).json({ success: false, message: '删除章节失败' })
  }
})

/**
 * PUT /api/problem-lists/:id/sections/reorder
 * 重排章节顺序
 */
problemListsRouter.put('/:id/sections/reorder', authenticate, async (req, res) => {
  try {
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
  } catch (error) {
    logger.error('reorder_sections_error', error)
    res.status(500).json({ success: false, message: '排序失败' })
  }
})

// ==================== 题目条目 CRUD ====================

/**
 * POST /api/problem-lists/sections/:sectionId/entries/single
 * 单条添加题目到指定章节（VJudge 逐行输入）
 */
problemListsRouter.post('/sections/:sectionId/entries/single', authenticate, async (req, res) => {
  try {
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
      const p = await prisma.problem.findUnique({ where: { id: directProblemId } })
      if (!p) {
        res.status(404).json({ success: false, message: '题目不存在' })
        return
      }
      if (p.visibility !== 'public' && p.ownerId !== req.user.userId) {
        res.status(403).json({ success: false, message: '无权访问该题目' })
        return
      }
      problemId = p.id
      problemTitle = p.title
      found = true
    } else if (ojName === 'carits') {
      // Carits 平台：按 platform + problemId 查本地题库
      const matched = await prisma.problem.findUnique({ where: { platform_problemId: { platform: 'carits', problemId } } })
      if (matched && (matched.visibility === 'public' || matched.ownerId === req.user.userId)) {
        problemId = matched.id
        problemTitle = matched.title
        found = true
      } else {
        res.status(404).json({ success: false, message: '题库中未找到该题目，或无权访问' })
        return
      }
    } else {
      // 外部 OJ：按 platform + problemId 直接查
      const p = await prisma.problem.findUnique({
        where: { platform_problemId: { platform: ojName, problemId } }
      })

      if (p && (p.visibility === 'public' || p.ownerId === req.user.userId)) {
        problemId = p.id
        problemTitle = p.title
        found = true
      }

      if (!found) {
        res.status(404).json({ success: false, message: '题库中未找到该题目' })
        return
      }
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
  } catch (error) {
    logger.error('add_single_entry_error', error)
    res.status(500).json({ success: false, message: '添加题目失败' })
  }
})

/**
 * POST /api/problem-lists/:id/entries/resolve
 * 批量解析题号 → 查找/创建 Problem 记录（不创建 Entry，仅预览）
 */
problemListsRouter.post('/:id/entries/resolve', authenticate, async (req, res) => {
  try {
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
        let p = await prisma.problem.findUnique({ where: { id: item.problemCode } }).catch(() => null)
        if (!p) {
          p = await prisma.problem.findUnique({ where: { platform_problemId: { platform: 'carits', problemId: item.problemCode } } })
        }
        if (p && (p.visibility === 'public' || p.ownerId === req.user.userId)) matched = { id: p.id, title: p.title }
      } else {
        // 外部 OJ：按 platform + problemId 直接查
        const p = await prisma.problem.findUnique({
          where: { platform_problemId: { platform: item.ojName, problemId: item.problemCode } }
        })
        if (p && (p.visibility === 'public' || p.ownerId === req.user.userId)) {
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
  } catch (error) {
    logger.error('resolve_entries_error', error)
    res.status(500).json({ success: false, message: '解析题号失败' })
  }
})

/**
 * PUT /api/problem-lists/entries/:entryId
 * 更新条目（alias / notes / sortOrder）
 */
problemListsRouter.put('/entries/:entryId', authenticate, async (req, res) => {
  try {
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
  } catch (error) {
    logger.error('update_entry_error', error)
    res.status(500).json({ success: false, message: '更新条目失败' })
  }
})

/**
 * DELETE /api/problem-lists/entries/:entryId
 * 删除条目
 */
problemListsRouter.delete('/entries/:entryId', authenticate, async (req, res) => {
  try {
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
  } catch (error) {
    logger.error('delete_entry_error', error)
    res.status(500).json({ success: false, message: '删除条目失败' })
  }
})

/**
 * PUT /api/problem-lists/sections/:sectionId/entries/reorder
 * 重排某章节内的条目顺序
 */
problemListsRouter.put('/sections/:sectionId/entries/reorder', authenticate, async (req, res) => {
  try {
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
  } catch (error) {
    logger.error('reorder_entries_error', error)
    res.status(500).json({ success: false, message: '排序失败' })
  }
})

// ==================== 分享管理 ====================

/**
 * GET /api/problem-lists/:id/shares
 * 获取题单分享列表
 */
problemListsRouter.get('/:id/shares', authenticate, async (req, res) => {
  try {
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
      } else {
        targetName = share.targetId
      }

      return { ...share, targetName, targetAvatar: avatar, targetUsername: username }
    }))

    res.json({ success: true, data: enrichedShares })
  } catch (error) {
    logger.error('get_shares_error', error)
    res.status(500).json({ success: false, message: '获取分享列表失败' })
  }
})

/**
 * GET /api/problem-lists/:id/share-candidates
 * 搜索本校可分享的教师/学生
 */
problemListsRouter.get('/:id/share-candidates', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const list = await prisma.problemList.findUnique({ where: { id: req.params.id } })
    if (!list) {
      res.status(404).json({ success: false, message: '题单不存在' })
      return
    }

    if (list.ownerId !== req.user.userId) {
      res.status(403).json({ success: false, message: '只有创建者可以管理分享' })
      return
    }

    const { type = 'teacher', keyword = '' } = req.query as { type?: string; keyword?: string }
    const schoolId = list.schoolId

    // 已分享的人
    const existingShares = await prisma.problemListShare.findMany({
      where: { problemListId: req.params.id, targetType: type },
      select: { targetId: true }
    })
    const excludeIds = new Set(existingShares.map(s => s.targetId))
    excludeIds.add(list.ownerId) // 排除 owner 自己

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
  } catch (error) {
    logger.error('share_candidates_error', error)
    res.status(500).json({ success: false, message: '搜索失败' })
  }
})

/**
 * POST /api/problem-lists/:id/shares
 * 添加/更新分享
 */
problemListsRouter.post('/:id/shares', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const list = await prisma.problemList.findUnique({ where: { id: req.params.id } })
    if (!list) {
      res.status(404).json({ success: false, message: '题单不存在' })
      return
    }

    if (list.ownerId !== req.user.userId) {
      res.status(403).json({ success: false, message: '只有创建者可以管理分享' })
      return
    }

    const { targetType, targetId, permission } = req.body
    if (!['teacher', 'student'].includes(targetType)) {
      res.status(400).json({ success: false, message: '只能分享给教师或学生' })
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
  } catch (error) {
    logger.error('create_share_error', error)
    res.status(500).json({ success: false, message: '添加分享失败' })
  }
})

/**
 * DELETE /api/problem-lists/:id/shares/:shareId
 * 移除分享
 */
problemListsRouter.delete('/:id/shares/:shareId', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: '未登录' })
      return
    }

    const list = await prisma.problemList.findUnique({ where: { id: req.params.id } })
    if (!list) {
      res.status(404).json({ success: false, message: '题单不存在' })
      return
    }

    if (list.ownerId !== req.user.userId) {
      res.status(403).json({ success: false, message: '只有创建者可以管理分享' })
      return
    }

    await prisma.problemListShare.delete({ where: { id: req.params.shareId } })
    res.json({ success: true, message: '移除成功' })
  } catch (error) {
    logger.error('delete_share_error', error)
    res.status(500).json({ success: false, message: '移除分享失败' })
  }
})
