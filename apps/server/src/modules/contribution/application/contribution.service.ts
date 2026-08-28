import { prisma } from '../../../prisma'

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
  const eventCount = await prisma.contributionEvent.count({
    where: { actorUserId: userId, status: 'accepted', revokedAt: null },
  })
  return { eventCount }
}

export async function listMyContributionEvents(userId: string) {
  const items = await prisma.contributionEvent.findMany({
    where: { actorUserId: userId, status: 'accepted', revokedAt: null },
    select: { id: true, type: true, sourceType: true, score: true, acceptedAt: true },
    orderBy: { acceptedAt: 'desc' },
  })
  return { items }
}

export async function listContributionRanking(organizationId?: string) {
  return { items: await rankingRows(organizationId) }
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
