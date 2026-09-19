import crypto from 'crypto'
import { getMembershipType, getResourceScope, isPersonalContext, isPersonalContextForTeams } from '../../../middleware/auth'
import { paginatedResponse } from '../../../lib/pagination'
import { prisma } from '../../../prisma'
import {
  checkProblemListOptimisticLock,
  generateProblemListId,
  getProblemListPermission,
} from './problem-list-access.service'

type AuthUser = NonNullable<Express.Request['user']>

export class ProblemListApplicationError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = 'ProblemListApplicationError'
  }
}

function fail(statusCode: number, message: string, code?: string): never {
  throw new ProblemListApplicationError(statusCode, message, code)
}

export async function listProblemLists(
  user: AuthUser,
  query: Record<string, unknown>,
  page: number,
  pageSize: number,
  skip: number,
) {
  const userId = user.userId
  const scope = getResourceScope(user)
  const memberType = getMembershipType(user)
  const tab = typeof query.tab === 'string' ? query.tab : 'all'
  const keyword = typeof query.keyword === 'string' ? query.keyword : ''
  const where: any = { scope }
  const teamId = typeof query.teamId === 'string' && query.teamId ? query.teamId : null
  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { scope: true } })
    const member = await prisma.teamMember.findFirst({ where: { teamId, userId, status: 'active' }, select: { id: true } })
    if (!team || team.scope !== scope || (!member && (user.accountRole) !== 'super_admin')) fail(403, '无权限查看该团队题单')
    where.TeamProblemList = { some: { teamId } }
  }

  if (!teamId && tab === 'mine') where.ownerId = userId
  else if (tab === 'shared') {
    where.ownerId = { not: userId }
    where.NOT = { ownerId: userId }
  }
  if (keyword) where.title = { contains: keyword }
  if (!teamId && tab !== 'mine') {
    const shared = await prisma.problemListShare.findMany({
      where: { targetType: memberType, targetId: userId || '__none__' },
      select: { problemListId: true },
    })
    const ids = shared.map(item => item.problemListId)
    if (tab === 'shared') where.id = { in: ids }
    else {
      where.OR = [{ ownerId: userId }, { id: { in: ids } }]
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
      include: { _count: { select: { ProblemListSection: true } } },
    }),
    prisma.problemList.count({ where }),
  ])
  const listIds = lists.map(list => list.id)
  const [entryCounts, sections, userShares] = await Promise.all([
    prisma.problemListEntry.groupBy({
      by: ['sectionId'],
      where: { ProblemListSection: { problemListId: { in: listIds } } },
      _count: true,
    }),
    prisma.problemListSection.findMany({
      where: { problemListId: { in: listIds } },
      select: { id: true, problemListId: true },
    }),
    prisma.problemListShare.findMany({
      where: { problemListId: { in: listIds }, targetType: memberType, targetId: userId || '__none__' },
      select: { problemListId: true, permission: true },
    }),
  ])
  const sectionToList = new Map(sections.map(section => [section.id, section.problemListId]))
  const totals = new Map<string, number>()
  for (const count of entryCounts) {
    const listId = sectionToList.get(count.sectionId)
    if (listId) totals.set(listId, (totals.get(listId) || 0) + count._count)
  }
  const shareMap = new Map(userShares.map(share => [share.problemListId, share.permission]))
  const enriched = lists.map(list => ({
    ...list,
    _count: { Entries: totals.get(list.id) || 0 },
    _permission: list.ownerId === userId ? 'admin' : (shareMap.get(list.id) || 'view'),
  }))
  return { lists: enriched, ...paginatedResponse(enriched, total, page, pageSize) }
}

export async function createProblemList(user: AuthUser, body: any) {
  if (getMembershipType(user) === 'student' && !isPersonalContextForTeams(user)) {
    fail(403, '校园模式下学生不能创建题单')
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) fail(400, '标题不能为空')
  const scope = getResourceScope(user)
  const organizationId = scope === 'campus' ? user.organizationId ?? null : null
  if (scope === 'campus' && !organizationId) fail(403, '当前校园上下文不可用')
  return prisma.problemList.create({
    data: {
      id: await generateProblemListId(),
      title,
      description: typeof body.description === 'string' ? body.description.trim() || null : null,
      organizationId,
      scope,
      ownerId: user.userId,
      ownerType: getMembershipType(user),
      visibility: body.visibility || 'private',
      ProblemListSection: { create: { id: crypto.randomUUID(), title: '默认章节', sortOrder: 0 } },
    },
    include: { ProblemListSection: true },
  })
}

function sanitizeProblem(problem: any) {
  return { title: problem.title, difficulty: problem.difficulty }
}

function sanitizeEntry(entry: any) {
  const { problemId: _problemId, ...rest } = entry
  return { ...rest, problemId: undefined, Problem: entry.Problem ? sanitizeProblem(entry.Problem) : undefined }
}

export async function getProblemListDetail(user: AuthUser, id: string) {
  const list = await prisma.problemList.findUnique({
    where: { id },
    include: {
      ProblemListSection: {
        orderBy: { sortOrder: 'asc' },
        include: {
          ProblemListEntry: {
            orderBy: { sortOrder: 'asc' },
            include: {
              Problem: { select: { id: true, platform: true, problemId: true, title: true, difficulty: true, ojBindings: true } },
            },
          },
        },
      },
      ProblemListShare: true,
    },
  })
  if (!list || list.scope !== getResourceScope(user)) fail(404, '题单不存在')
  const permission = await getProblemListPermission(id, user)
  if (!permission) fail(403, '无权限查看')
  const studentView = getMembershipType(user) === 'student' && !isPersonalContext(user)
  const shares = studentView ? [] : await Promise.all(list.ProblemListShare.map(async share => {
    const target = await prisma.user.findUnique({ where: { id: share.targetId }, select: { username: true, avatar: true } })
    return {
      ...share,
      targetName: target?.username || share.targetId,
      targetAvatar: target?.avatar || null,
      targetUsername: target?.username || '',
    }
  }))
  const visibleList = studentView ? {
    ...list,
    ProblemListSection: list.ProblemListSection.map(section => ({
      ...section,
      ProblemListEntry: section.ProblemListEntry.map(sanitizeEntry),
    })),
    ProblemListShare: [],
  } : list
  return { ...visibleList, Shares: shares, _permission: permission }
}

export async function updateProblemList(user: AuthUser, id: string, body: any) {
  if (getMembershipType(user) === 'student' && !isPersonalContextForTeams(user)) {
    fail(403, '校园模式下学生不能编辑题单')
  }
  const list = await prisma.problemList.findUnique({ where: { id } })
  if (!list) fail(404, '题单不存在')
  const permission = await getProblemListPermission(id, user)
  if (permission !== 'admin' && permission !== 'edit') fail(403, '无权限编辑')
  if (!checkProblemListOptimisticLock(body.expectedUpdatedAt, list.updatedAt)) {
    fail(409, '题单已被其他人修改，请刷新后重试', 'CONFLICT')
  }
  const data: any = {}
  if (body.title !== undefined) data.title = String(body.title).trim()
  if (body.description !== undefined) data.description = typeof body.description === 'string' ? body.description.trim() || null : null
  if (body.visibility !== undefined) data.visibility = body.visibility
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder
  if (body.coverUrl !== undefined) data.coverUrl = body.coverUrl
  return prisma.problemList.update({ where: { id }, data })
}

export async function deleteProblemList(user: AuthUser, id: string) {
  if (getMembershipType(user) === 'student' && !isPersonalContextForTeams(user)) {
    fail(403, '校园模式下学生不能删除题单')
  }
  const list = await prisma.problemList.findUnique({ where: { id } })
  if (!list) fail(404, '题单不存在')
  if (list.ownerId !== user.userId) fail(403, '只有创建者可以删除题单')
  const [schoolLink, teamLink] = await Promise.all([
    prisma.schoolProblemList.findFirst({ where: { problemListId: id }, select: { id: true } }),
    prisma.teamProblemList.findFirst({ where: { problemListId: id }, select: { id: true } }),
  ])
  if (schoolLink || teamLink) fail(403, '该题单已被学校或团队收录，请先从题单库中移除后再删除')
  await prisma.problemList.delete({ where: { id } })
}
