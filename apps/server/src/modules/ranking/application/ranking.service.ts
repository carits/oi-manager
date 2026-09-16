import { calculateGrade, getAllGrades } from '@oi-manager/shared/utils/grade'
import { parsePagination, paginatedResponse } from '../../../lib/pagination'
import { prisma } from '../../../prisma'
import { currentJudgeAcceptedWhere } from '../../judge/application/judge-read-projection'

export class RankingApplicationError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

export async function getPersonalRatingRanking(queryParams: any) {
  const query = typeof queryParams.q === 'string' ? queryParams.q.trim() : ''
  const where = {
    User: {
      status: 'active' as const,
      ...(query ? { username: { contains: query, mode: 'insensitive' as const } } : {}),
    },
  }
  const { page, pageSize, skip } = parsePagination(queryParams, { defaultPageSize: 50, maxPageSize: 200 })
  const [profiles, total] = await Promise.all([
    prisma.personalProfile.findMany({
      where,
      select: { userId: true, rating: true, User: { select: { username: true, avatar: true } } },
      orderBy: [{ rating: 'desc' }, { User: { username: 'asc' } }], skip, take: pageSize,
    }),
    prisma.personalProfile.count({ where }),
  ])
  const data = profiles.map(profile => ({
    id: profile.userId, username: profile.User.username, avatar: profile.User.avatar, rating: profile.rating,
  }))
  const pagination = paginatedResponse(data, total, page, pageSize)
  return { items: pagination.data, page, pageSize, total, totalPages: pagination.totalPages }
}

export async function getPersonalSolvedRanking(queryParams: any) {
  const query = typeof queryParams.q === 'string' ? queryParams.q.trim() : ''
  const where = {
    User: {
      status: 'active' as const,
      ...(query ? { username: { contains: query, mode: 'insensitive' as const } } : {}),
    },
  }
  const { page, pageSize } = parsePagination(queryParams, { defaultPageSize: 50, maxPageSize: 200 })
  const profiles = await prisma.personalProfile.findMany({
    where, select: { userId: true, User: { select: { username: true, avatar: true } } },
  })
  const userIds = profiles.map(profile => profile.userId)
  const submissions = userIds.length > 0
    ? await prisma.submission.findMany({
        where: {
          userId: { in: userIds },
          workspaceScope: 'personal',
          submitMethod: { not: 'archive' },
          AND: [currentJudgeAcceptedWhere()],
        },
        select: { userId: true, problemId: true },
        distinct: ['userId', 'problemId'],
      })
    : []
  const solvedByUser = new Map<string, Set<string>>()
  for (const row of submissions) {
    const solved = solvedByUser.get(row.userId) || new Set<string>()
    solved.add(row.problemId)
    solvedByUser.set(row.userId, solved)
  }
  const ranked = profiles.map(profile => ({
    id: profile.userId,
    username: profile.User.username,
    avatar: profile.User.avatar,
    solvedCount: solvedByUser.get(profile.userId)?.size || 0,
  })).sort((left, right) => right.solvedCount - left.solvedCount || left.username.localeCompare(right.username))
  const start = (page - 1) * pageSize
  return { items: ranked.slice(start, start + pageSize), page, pageSize, total: ranked.length, totalPages: Math.ceil(ranked.length / pageSize) }
}

export async function getOrganizationRanking(organizationId: string, metric: string, queryParams: any) {
  if (!['rating', 'solved'].includes(metric)) throw new RankingApplicationError(404, '排名指标不存在')
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { School: { select: { schoolType: true, educationSystem: true, educationSystemDetail: true } } },
  })
  if (!organization?.School) throw new RankingApplicationError(404, '未找到校园资料')
  const school = organization.School
  const { page, pageSize } = parsePagination(queryParams, { defaultPageSize: 50, maxPageSize: 200 })
  const query = typeof queryParams.q === 'string' ? queryParams.q.trim().toLowerCase() : ''
  const requestedGrade = typeof queryParams.grade === 'string' ? queryParams.grade : ''
  const includeGraduated = queryParams.includeGraduated === '1'
  const profiles = await prisma.organizationStudentProfile.findMany({
    where: { status: 'active', Membership: { organizationId, status: 'active', memberRole: 'student' } },
    include: { Membership: { select: { userId: true, User: { select: { username: true, avatar: true } } } } },
  })
  const baseRows = profiles.map(profile => ({
    id: profile.id,
    userId: profile.Membership.userId,
    name: profile.name,
    username: profile.Membership.User.username,
    avatar: profile.Membership.User.avatar || profile.avatar,
    rating: profile.rating,
    grade: calculateGrade({
      enrollmentYear: profile.enrollmentYear,
      schoolType: school.schoolType,
      educationSystem: school.educationSystem,
      educationSystemDetail: school.educationSystemDetail as any,
    }),
  })).filter(row => !query || row.name.toLowerCase().includes(query) || row.username.toLowerCase().includes(query))
    .filter(row => includeGraduated || !row.grade.startsWith('已毕业'))
    .filter(row => !requestedGrade || row.grade === requestedGrade)

  let ranked: Array<typeof baseRows[number] & { solvedCount?: number }>
  if (metric === 'rating') ranked = [...baseRows].sort((a, b) => b.rating - a.rating || a.username.localeCompare(b.username))
  else {
    const accepted = await prisma.submission.findMany({
      where: {
        userId: { in: baseRows.map(row => row.userId) }, submitMethod: { not: 'archive' },
        Training: { organizationId },
        AND: [currentJudgeAcceptedWhere()],
      },
      select: { userId: true, problemInternalId: true, problemId: true },
    })
    const solved = new Map<string, Set<string>>()
    for (const item of accepted) {
      const set = solved.get(item.userId) || new Set<string>()
      set.add(item.problemInternalId || item.problemId)
      solved.set(item.userId, set)
    }
    ranked = baseRows.map(row => ({ ...row, solvedCount: solved.get(row.userId)?.size || 0 }))
      .sort((a, b) => (b.solvedCount || 0) - (a.solvedCount || 0) || a.username.localeCompare(b.username))
  }
  const start = (page - 1) * pageSize
  return {
    items: ranked.slice(start, start + pageSize), page, pageSize, total: ranked.length, totalPages: Math.ceil(ranked.length / pageSize),
    filters: {
      grades: getAllGrades(school.schoolType, school.educationSystem, school.educationSystemDetail as any).filter(Boolean),
    },
  }
}
