import { Router } from 'express'
import { authenticate, AuthRequest, isPersonalMode } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parsePagination, paginatedResponse } from '../../lib/pagination'
import { prisma } from '../../prisma'

export const rankingRouter = Router()

function requirePersonalMode(req: AuthRequest, res: any): boolean {
  if (req.user?.role !== 'student' || !isPersonalMode(req.user)) {
    res.status(403).json({ success: false, message: '该排名仅在个人模式下可用' })
    return false
  }
  return true
}

rankingRouter.get('/personal/rating', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!requirePersonalMode(req, res)) return

  const { page, pageSize, skip } = parsePagination(req.query, {
    defaultPageSize: 50,
    maxPageSize: 200
  })

  const [students, total] = await Promise.all([
    prisma.student.findMany({
      where: { User: { status: 'active' } },
      select: {
        id: true,
        rating: true,
        User: { select: { username: true, avatar: true } }
      },
      orderBy: [{ rating: 'desc' }, { User: { username: 'asc' } }],
      skip,
      take: pageSize
    }),
    prisma.student.count({ where: { User: { status: 'active' } } })
  ])

  const data = students.map(student => ({
    id: student.id,
    username: student.User.username,
    avatar: student.User.avatar,
    rating: student.rating
  }))

  res.json({ success: true, ...paginatedResponse(data, total, page, pageSize) })
}))

rankingRouter.get('/personal/solved', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (!requirePersonalMode(req, res)) return

  const { page, pageSize } = parsePagination(req.query, {
    defaultPageSize: 50,
    maxPageSize: 200
  })

  const students = await prisma.student.findMany({
    where: { User: { status: 'active' } },
    select: {
      id: true,
      User: { select: { username: true, avatar: true } }
    }
  })
  const studentIds = students.map(student => student.id)

  const [submissionRows, archivedRows] = studentIds.length > 0
    ? await Promise.all([
        prisma.$queryRaw<Array<{ userId: string; problemId: string }>>`
          SELECT DISTINCT "userId", "problemId"
          FROM "Submission"
          WHERE "userId" = ANY(${studentIds}::text[])
            AND "result" IN ('accepted', 'Accepted', 'AC', 'ac')
        `,
        prisma.$queryRaw<Array<{ userId: string; problemId: string }>>`
          SELECT "userId", "problemId"
          FROM "UserArchivedProblem"
          WHERE "userId" = ANY(${studentIds}::text[])
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

  const ranked = students
    .map(student => ({
      id: student.id,
      username: student.User.username,
      avatar: student.User.avatar,
      solvedCount: solvedByUser.get(student.id)?.size || 0
    }))
    .sort((left, right) =>
      right.solvedCount - left.solvedCount || left.username.localeCompare(right.username)
    )

  const total = ranked.length
  const start = (page - 1) * pageSize
  const data = ranked.slice(start, start + pageSize)

  res.json({ success: true, ...paginatedResponse(data, total, page, pageSize) })
}))
