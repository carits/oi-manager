import { Router } from 'express'
import { authenticate, AuthRequest, isPersonalContext } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parsePagination, paginatedResponse } from '../../lib/pagination'
import { prisma } from '../../prisma'
import { calculateGrade, getAllGrades } from '@oi-manager/shared/utils/grade'

export const rankingRouter = Router()

function requirePersonalMode(req: AuthRequest, res: any): boolean {
  if (!req.user || !isPersonalContext(req.user)) {
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

function isAccepted(result: string) { return ['accepted', 'Accepted', 'AC', 'ac'].includes(result) }

rankingRouter.get('/organizations/:organizationId/:metric', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const organizationId = req.params.organizationId
  const metric = req.params.metric
  if (!['rating', 'solved'].includes(metric)) return res.status(404).json({ success: false, message: '排名指标不存在' })
  if (!req.user || isPersonalContext(req.user) || req.user.organizationId !== organizationId) return res.status(403).json({ success: false, message: '当前组织上下文无效' })
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { School: { select: { schoolType: true, educationSystem: true, educationSystemDetail: true } } } })
  if (!organization?.School) return res.status(404).json({ success: false, message: '未找到校园资料' })
  const school = organization.School
  const { page, pageSize } = parsePagination(req.query, { defaultPageSize: 50, maxPageSize: 200 })
  const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''
  const requestedGrade = typeof req.query.grade === 'string' ? req.query.grade : ''
  const includeGraduated = req.query.includeGraduated === '1'
  const profiles = await prisma.organizationStudentProfile.findMany({
    where: { status: 'active', Membership: { organizationId, status: 'active', memberRole: 'student' } },
    include: { Membership: { select: { userId: true, User: { select: { username: true, avatar: true } } } } },
  })
  const baseRows = profiles.map(profile => ({
    id: profile.id, userId: profile.Membership.userId, name: profile.name, username: profile.Membership.User.username, avatar: profile.Membership.User.avatar || profile.avatar, rating: profile.rating,
    grade: calculateGrade({ enrollmentYear: profile.enrollmentYear, schoolType: school.schoolType, educationSystem: school.educationSystem, educationSystemDetail: school.educationSystemDetail as any }),
  })).filter(row => !query || row.name.toLowerCase().includes(query) || row.username.toLowerCase().includes(query)).filter(row => includeGraduated || !row.grade.startsWith('已毕业')).filter(row => !requestedGrade || row.grade === requestedGrade)
  let ranked: Array<typeof baseRows[number] & { solvedCount?: number }>
  if (metric === 'rating') ranked = [...baseRows].sort((a,b) => b.rating - a.rating || a.username.localeCompare(b.username))
  else {
    const accepted = await prisma.submission.findMany({ where: { userId: { in: baseRows.map(row => row.userId) }, result: { in: ['accepted', 'Accepted', 'AC', 'ac'] }, Training: { organizationId } }, select: { userId: true, problemInternalId: true, problemId: true } })
    const solved = new Map<string, Set<string>>()
    for (const item of accepted) { const set = solved.get(item.userId) || new Set<string>(); set.add(item.problemInternalId || item.problemId); solved.set(item.userId, set) }
    ranked = baseRows.map(row => ({ ...row, solvedCount: solved.get(row.userId)?.size || 0 })).sort((a,b) => (b.solvedCount || 0) - (a.solvedCount || 0) || a.username.localeCompare(b.username))
  }
  const start = (page - 1) * pageSize
  res.json({ success: true, ...paginatedResponse(ranked.slice(start, start + pageSize), ranked.length, page, pageSize), filters: { grades: getAllGrades(organization.School.schoolType, organization.School.educationSystem, organization.School.educationSystemDetail as any).filter(Boolean) } })
}))
