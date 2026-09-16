import {
  ContributionContracts,
  RatingAccountContracts,
  RankingContracts,
  RatingLeaderboardContracts,
  type RankingPage,
  type RankingQuery,
  type RankingTrack,
  type EndpointQuery,
} from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export type RankingMetric = 'rating' | 'solved' | 'contribution'
export type RankingScope = 'campus' | 'personal'

function queryString(query: RankingQuery) {
  const params = new URLSearchParams()
  params.set('page', String(query.page))
  params.set('pageSize', String(query.pageSize))
  if (query.q) params.set('q', query.q)
  if (query.grade) params.set('grade', query.grade)
  if (query.includeGraduated) params.set('includeGraduated', query.includeGraduated)
  return params.toString()
}

export async function getMetricRanking(input: {
  scope: RankingScope
  metric: RankingMetric
  organizationId?: string
  track: RankingTrack
  query: RankingQuery
  signal?: AbortSignal
}): Promise<RankingPage> {
  const encoded = queryString(input.query)
  if (input.metric === 'contribution') {
    return input.scope === 'campus'
      ? apiClient.queryContract(ContributionContracts.organizationRanking, `/api/contributions/organizations/${encodeURIComponent(input.organizationId || '')}/rankings?${encoded}`, { signal: input.signal })
      : apiClient.queryContract(ContributionContracts.userRanking, `/api/contributions/rankings/users?${encoded}`, { signal: input.signal, accountScoped: true })
  }
  if (input.metric === 'rating') {
    return input.scope === 'campus'
      ? apiClient.queryContract(RatingLeaderboardContracts.organization, `/api/ratings/organizations/${encodeURIComponent(input.organizationId || '')}/${input.track}?${encoded}`, { signal: input.signal })
      : apiClient.queryContract(RatingLeaderboardContracts.global, `/api/ratings/global/${input.track}?${encoded}`, { signal: input.signal, accountScoped: true })
  }
  return input.scope === 'campus'
    ? apiClient.queryContract(RankingContracts.organization, `/api/rankings/organizations/${encodeURIComponent(input.organizationId || '')}/solved?${encoded}`, { signal: input.signal })
    : apiClient.queryContract(RankingContracts.personalSolved, `/api/rankings/personal/solved?${encoded}`, { signal: input.signal, accountScoped: true })
}

export const getMyRatingAccounts = () =>
  apiClient.queryContract(RatingAccountContracts.mine, '/api/ratings/me', { accountScoped: true })

export const getMyRatingHistory = (
  userId: string,
  query: EndpointQuery<typeof RatingAccountContracts.history>,
  signal?: AbortSignal,
) => {
  const params = new URLSearchParams({
    page: String(query.page), pageSize: String(query.pageSize), scope: query.scope, track: query.track,
  })
  if (query.organizationId) params.set('organizationId', query.organizationId)
  return apiClient.queryContract(RatingAccountContracts.history, `/api/ratings/users/${encodeURIComponent(userId)}/history?${params}`, { signal, accountScoped: true })
}
