import { RatingTrack } from '@prisma/client'
import { parsePagination, paginatedResponse } from '../../../lib/pagination'
import { prisma } from '../../../prisma'
import { isOrganizationMember } from '../../training/training.helpers'
import { ContestRatingError } from './contest-rating.service'

function track(value: unknown): RatingTrack {
  const normalized = String(value || '').toUpperCase()
  if (!Object.values(RatingTrack).includes(normalized as RatingTrack)) throw new ContestRatingError(422, 'RATING_TRACK_INVALID', 'Rating Track 无效')
  return normalized as RatingTrack
}

function accountDto(account: any) {
  return {
    id: account.id, poolId: account.poolId, rating: account.rating, peakRating: account.peakRating,
    ratedContestCount: account.ratedContestCount, provisional: account.provisional,
    lastRatedAt: account.lastRatedAt, track: account.Pool.track,
    scope: account.Pool.scopeType, organizationId: account.Pool.organizationId,
    organizationName: account.Pool.Organization?.School?.shortName || account.Pool.Organization?.School?.name || account.Pool.Organization?.name || null,
  }
}

export async function getMyRatingAccounts(userId: string) {
  const accounts = await prisma.ratingAccount.findMany({ where: { userId, Pool: { status: 'active' } }, include: { Pool: { include: { Organization: { include: { School: { select: { name: true, shortName: true } } } } } } }, orderBy: [{ Pool: { scopeType: 'asc' } }, { Pool: { track: 'asc' } }] })
  return { baseRating: 1500, accounts: accounts.map(accountDto), missingTracksUseBaseRating: true }
}

export async function getRatingLeaderboard(input: { scope: 'GLOBAL' | 'ORGANIZATION'; organizationId?: string; track: unknown; query: any; requestingUserId: string }) {
  const selectedTrack = track(input.track)
  if (input.scope === 'ORGANIZATION') {
    if (!input.organizationId || !await isOrganizationMember(input.requestingUserId, input.organizationId)) throw new ContestRatingError(403, 'ORGANIZATION_RATING_ACCESS_DENIED', '无权限查看该组织 Rating')
  }
  const pool = await prisma.ratingPool.findFirst({ where: { scopeType: input.scope, organizationId: input.scope === 'GLOBAL' ? null : input.organizationId, track: selectedTrack, status: 'active' } })
  const { page, pageSize, skip } = parsePagination(input.query, { defaultPageSize: 50, maxPageSize: 200 })
  if (!pool) return { ...paginatedResponse([], 0, page, pageSize), track: selectedTrack, scope: input.scope }
  const q = typeof input.query.q === 'string' ? input.query.q.trim() : ''
  const where = { poolId: pool.id, User: { status: 'active' as const, ...(q ? { username: { contains: q, mode: 'insensitive' as const } } : {}) } }
  const [accounts, total] = await Promise.all([
    prisma.ratingAccount.findMany({ where, include: { User: { select: { id: true, username: true, avatar: true } }, Pool: true }, orderBy: [{ rating: 'desc' }, { User: { username: 'asc' } }], skip, take: pageSize }),
    prisma.ratingAccount.count({ where }),
  ])
  // A filtered page must still display each account's rank in the complete pool,
  // and ties must use competition ranking (1, 2, 2, 4), not the page offset.
  const rankByRating = new Map<number, number>()
  if (accounts.length) {
    const minimumRating = Math.min(...accounts.map(account => account.rating))
    const ratingGroups = await prisma.ratingAccount.groupBy({
      by: ['rating'],
      where: { poolId: pool.id, rating: { gte: minimumRating }, User: { status: 'active' } },
      _count: { _all: true },
      orderBy: { rating: 'desc' },
    })
    let higher = 0
    for (const group of ratingGroups) {
      rankByRating.set(group.rating, higher + 1)
      higher += group._count._all
    }
  }
  return { ...paginatedResponse(accounts.map(account => ({ ...accountDto(account), rank: rankByRating.get(account.rating) || null, userId: account.userId, id: account.userId, username: account.User.username, avatar: account.User.avatar })), total, page, pageSize), track: selectedTrack, scope: input.scope, organizationId: input.organizationId || null }
}

export async function getRatingHistory(input: { userId: string; requestingUserId: string; scope?: string; organizationId?: string; track?: unknown; query: any }) {
  if (input.userId !== input.requestingUserId) throw new ContestRatingError(403, 'RATING_HISTORY_ACCESS_DENIED', '只能查看自己的 Rating 历史')
  const selectedTrack = track(input.track || 'OI')
  const scope = String(input.scope || 'GLOBAL').toUpperCase()
  if (!['GLOBAL', 'ORGANIZATION'].includes(scope)) throw new ContestRatingError(422, 'RATING_SCOPE_INVALID', 'Rating 范围无效')
  if (scope === 'ORGANIZATION' && (!input.organizationId || !await isOrganizationMember(input.requestingUserId, input.organizationId))) throw new ContestRatingError(403, 'ORGANIZATION_RATING_ACCESS_DENIED', '无权限查看该组织 Rating')
  const pool = await prisma.ratingPool.findFirst({ where: { scopeType: scope as any, organizationId: scope === 'GLOBAL' ? null : input.organizationId, track: selectedTrack } })
  const { page, pageSize, skip } = parsePagination(input.query, { defaultPageSize: 30, maxPageSize: 100 })
  if (!pool) return { account: null, ...paginatedResponse([], 0, page, pageSize) }
  const account = await prisma.ratingAccount.findUnique({ where: { poolId_userId: { poolId: pool.id, userId: input.userId } }, include: { Pool: { include: { Organization: { include: { School: { select: { name: true, shortName: true } } } } } } } })
  if (!account) return { account: null, ...paginatedResponse([], 0, page, pageSize) }
  const where = { accountId: account.id, Batch: { status: 'APPLIED' as const } }
  const [changes, total] = await Promise.all([
    prisma.ratingChange.findMany({ where, include: { Batch: { include: { Contest: { select: { id: true, runtimeTrainingId: true, title: true, endAt: true } } } } }, orderBy: [{ Batch: { sequenceAt: 'desc' } }, { createdAt: 'desc' }], skip, take: pageSize }),
    prisma.ratingChange.count({ where }),
  ])
  return { account: accountDto(account), ...paginatedResponse(changes.map(change => ({ id: change.id, contest: { id: change.Batch.Contest.runtimeTrainingId, canonicalId: change.Batch.Contest.id, title: change.Batch.Contest.title, endTime: change.Batch.Contest.endAt }, rank: change.rank, fieldSize: change.fieldSize, ratingBefore: change.ratingBefore, appliedDelta: change.appliedDelta, ratingAfter: change.ratingAfter, expectedPerformance: Number(change.expectedPerformance), actualPerformance: Number(change.actualPerformance), createdAt: change.createdAt })), total, page, pageSize) }
}
