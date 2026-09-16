import { z } from 'zod'
import { PaginationQuerySchema, defineApiEndpoint, paginatedDataSchema } from './http'

export const RankingTrackSchema = z.enum(['OI', 'IOI', 'ACM'])

export const RankingQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().max(100).optional(),
  grade: z.string().trim().max(100).optional(),
  includeGraduated: z.union([z.literal('0'), z.literal('1')]).optional(),
})

export const RankingRowSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  name: z.string().optional(),
  username: z.string(),
  avatar: z.string().nullable().optional(),
  grade: z.string().optional(),
  rating: z.number().optional(),
  solvedCount: z.number().int().nonnegative().optional(),
  contributionScore: z.number().int().nonnegative().optional(),
  rank: z.number().int().positive().nullable().optional(),
})

export const RankingPageSchema = paginatedDataSchema(RankingRowSchema).extend({
  filters: z.object({ grades: z.array(z.string()).optional() }).optional(),
})

export const RankingContracts = {
  personalRating: defineApiEndpoint({ key: 'ranking.personal-rating', method: 'GET', scope: 'account', query: RankingQuerySchema, data: RankingPageSchema }),
  personalSolved: defineApiEndpoint({ key: 'ranking.personal-solved', method: 'GET', scope: 'account', query: RankingQuerySchema, data: RankingPageSchema }),
  organization: defineApiEndpoint({ key: 'ranking.organization', method: 'GET', scope: 'organization', query: RankingQuerySchema, data: RankingPageSchema }),
} as const

export type RankingTrack = z.infer<typeof RankingTrackSchema>
export type RankingQuery = z.infer<typeof RankingQuerySchema>
export type RankingRow = z.infer<typeof RankingRowSchema>
export type RankingPage = z.infer<typeof RankingPageSchema>
