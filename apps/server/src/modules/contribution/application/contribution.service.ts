import { prisma } from '../../../prisma'

export class ContributionApplicationError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message) }
}

export async function resolveContributionOrganization(userId: string, value: unknown) {
  const organizationId = typeof value === 'string' && value.trim() ? value.trim() : null
  if (!organizationId) return null
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, organizationId, status: 'active', Organization: { status: 'active', School: { is: { directoryStatus: { not: 'legacy' }, status: 'active' } } } },
    select: { id: true },
  })
  if (!membership) throw new ContributionApplicationError(403, 'CONTRIBUTION_ORGANIZATION_INVALID', '贡献归属组织不可用或你不是该组织的有效成员')
  return organizationId
}

async function rankingRows(organizationId?: string) {
  const groups = await prisma.contributionEvent.groupBy({
    by: ['actorUserId'],
    where: {
      status: 'accepted', revokedAt: null,
      ...(organizationId ? { Attribution: { is: { organizationId } } } : {}),
    },
    _sum: { score: true },
    orderBy: [{ _sum: { score: 'desc' } }, { actorUserId: 'asc' }],
  })
  if (groups.length === 0) return []
  const users = await prisma.user.findMany({
    where: { id: { in: groups.map(group => group.actorUserId) }, status: 'active' },
    select: { id: true, username: true, avatar: true },
  })
  const byId = new Map(users.map(user => [user.id, user]))
  return groups.flatMap(group => {
    const user = byId.get(group.actorUserId)
    return user ? [{
      id: user.id, userId: user.id, username: user.username, avatar: user.avatar,
      contributionScore: group._sum.score || 0,
    }] : []
  })
}

export async function getContributionSummary(userId: string) {
  const [eventCount, aggregate] = await Promise.all([
    prisma.contributionEvent.count({ where: { actorUserId: userId, status: 'accepted', revokedAt: null } }),
    prisma.contributionEvent.aggregate({ where: { actorUserId: userId, status: 'accepted', revokedAt: null }, _sum: { score: true } }),
  ])
  const contributionScore = aggregate._sum.score || 0
  const level = contributionScore >= 10_000 ? 'L4' : contributionScore >= 2_000 ? 'L3' : contributionScore >= 500 ? 'L2' : contributionScore >= 100 ? 'L1' : 'L0'
  return { eventCount, contributionScore, level }
}

export async function listMyContributionEvents(
  userId: string,
  pagination: { page: number; pageSize: number; skip: number } = { page: 1, pageSize: 20, skip: 0 },
) {
  const where = { actorUserId: userId, status: { in: ['pending', 'accepted', 'rejected', 'revoked'] } }
  const [items, total] = await Promise.all([
    prisma.contributionEvent.findMany({
      where,
      select: {
        id: true,
        type: true,
        sourceType: true,
        sourceId: true,
        score: true,
        status: true,
        occurredAt: true,
        acceptedAt: true,
        revokedAt: true,
        revokeReason: true,
        Attribution: {
          select: {
            organizationId: true,
            Organization: { select: { name: true } },
          },
        },
        RewardDelivery: { select: { status: true, userCarits: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: pagination.skip,
      take: pagination.pageSize,
    }),
    prisma.contributionEvent.count({ where }),
  ])
  return {
    items: items.map(item => ({
      ...item,
      displayAt: item.acceptedAt || item.revokedAt || item.occurredAt,
      // acceptedAt is nullable in the compatibility schema. Accepted legacy
      // events still need a stable timestamp, without pretending that pending
      // or rejected events have already been accepted.
      acceptedAt: item.status === 'accepted' ? item.acceptedAt || item.occurredAt : item.acceptedAt,
      RewardDelivery: item.RewardDelivery
        ? { ...item.RewardDelivery, userCarits: item.RewardDelivery.userCarits.toString() }
        : null,
    })),
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: Math.ceil(total / pagination.pageSize),
  }
}

export async function listContributionRanking(
  organizationId: string | undefined,
  query: { page: number; pageSize: number; q?: string },
) {
  const normalizedQuery = query.q?.trim().toLowerCase() || ''
  const rows = (await rankingRows(organizationId))
    .filter(row => !normalizedQuery || row.username.toLowerCase().includes(normalizedQuery))
  const start = (query.page - 1) * query.pageSize
  return {
    items: rows.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: rows.length,
    totalPages: Math.ceil(rows.length / query.pageSize),
  }
}

export async function listOrganizationContributionEvents(organizationId: string) {
  const items = await prisma.contributionEvent.findMany({
    where: { status: 'accepted', revokedAt: null, Attribution: { is: { organizationId } } },
    select: { id: true, type: true, sourceType: true, score: true, acceptedAt: true, actorUserId: true },
    orderBy: { acceptedAt: 'desc' },
  })
  return { items }
}

export async function listPlatformContributionEvents() {
  const items = await prisma.contributionEvent.findMany({
    select: { id: true, actorUserId: true, type: true, score: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' }, take: 100,
  })
  return { items }
}
