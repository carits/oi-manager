import { Router } from 'express'
import { authenticate, AuthRequest, isPersonalWorkspace } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parsePagination, paginatedResponse } from '../../lib/pagination'
import { prisma } from '../../prisma'

export const rankingRouter = Router()

function requirePersonalMode(req: AuthRequest, res: any): boolean {
  if (!req.user || !isPersonalWorkspace(req.user)) {
    res.status(403).json({
      success: false,
      code: 'WORKSPACE_MODE_REQUIRED',
      message: '该排名仅在个人工作区可用',
    })
    return false
  }
  return true
}

rankingRouter.get('/personal/rating', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!requirePersonalMode(req, res)) return

  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const where = {
    User: {
      status: 'active' as const,
      ...(query ? { username: { contains: query, mode: 'insensitive' as const } } : {})
    }
  }

  const { page, pageSize, skip } = parsePagination(req.query, {
    defaultPageSize: 50,
    maxPageSize: 200
  })

  const [profiles, total] = await Promise.all([
    prisma.personalProfile.findMany({
      where,
      select: {
        userId: true,
        rating: true,
        User: { select: { username: true, avatar: true } }
      },
      orderBy: [{ rating: 'desc' }, { User: { username: 'asc' } }],
      skip,
      take: pageSize
    }),
    prisma.personalProfile.count({ where })
  ])

  const data = profiles.map(profile => ({
    id: profile.userId,
    username: profile.User.username,
    avatar: profile.User.avatar,
    rating: profile.rating
  }))

  res.json({ success: true, ...paginatedResponse(data, total, page, pageSize) })
}))

rankingRouter.get('/personal/solved', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!requirePersonalMode(req, res)) return

  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const where = {
    User: {
      status: 'active' as const,
      ...(query ? { username: { contains: query, mode: 'insensitive' as const } } : {})
    }
  }

  const { page, pageSize } = parsePagination(req.query, {
    defaultPageSize: 50,
    maxPageSize: 200
  })

  const profiles = await prisma.personalProfile.findMany({
    where,
    select: {
      userId: true,
      User: { select: { username: true, avatar: true } }
    }
  })
  const userIds = profiles.map(profile => profile.userId)

  const [submissionRows, archivedRows] = userIds.length > 0
    ? await Promise.all([
        prisma.$queryRaw<Array<{ userId: string; problemId: string }>>`
          SELECT DISTINCT "userId", "problemId"
          FROM "Submission"
          WHERE "userId" = ANY(${userIds}::text[])
            AND "workspaceScope" = 'personal'
            AND "result" IN ('accepted', 'Accepted', 'AC', 'ac')
        `,
        prisma.$queryRaw<Array<{ userId: string; problemId: string }>>`
          SELECT "userId", "problemId"
          FROM "UserArchivedProblem"
          WHERE "userId" = ANY(${userIds}::text[])
            AND "solvedAt" IS NOT NULL
        `
      ])
    : [[], []]

  const solvedByUser = new Map<string, Set<string>>()
  for (const row of [...submissionRows, ...archivedRows]) {
    const solved = solvedByUser.get(row.userId) || new Set<string>()
    solved.add(row.problemId)
    solvedByUser.set(row.userId, solved)
  }

  const ranked = profiles
    .map(profile => ({
      id: profile.userId,
      username: profile.User.username,
      avatar: profile.User.avatar,
      solvedCount: solvedByUser.get(profile.userId)?.size || 0
    }))
    .sort((left, right) =>
      right.solvedCount - left.solvedCount || left.username.localeCompare(right.username)
    )

  const total = ranked.length
  const start = (page - 1) * pageSize
  const data = ranked.slice(start, start + pageSize)

  res.json({ success: true, ...paginatedResponse(data, total, page, pageSize) })
}))
