import { z } from 'zod'
import { DateTimeWireSchema, PaginationQuerySchema, defineApiEndpoint, paginatedDataSchema } from './http'
import { RankingTrackSchema } from './ranking'

export const RatingChangeSchema = z.looseObject({
  batchId: z.string(),
  scope: z.string(),
  track: z.string(),
  organizationId: z.string().nullable().optional(),
  organization: z.looseObject({ name: z.string(), shortName: z.string().nullable().optional() }).nullable().optional(),
  userId: z.string(),
  ratingBefore: z.number(),
  appliedDelta: z.number(),
  ratingAfter: z.number(),
})

export const ContestRatingDataSchema = z.looseObject({
  finalizationStatus: z.string(),
  config: z.looseObject({
    scope: z.string(),
    track: z.string(),
    weight: z.number(),
    lockedAt: DateTimeWireSchema.nullable().optional(),
  }),
  standing: z.looseObject({
    revision: z.number(),
    finalizedAt: DateTimeWireSchema,
    entries: z.array(z.looseObject({
      userId: z.string(),
      rank: z.number(),
      totalScore: z.number().nullable().optional(),
      solvedCount: z.number().nullable().optional(),
      penaltySeconds: z.number().nullable().optional(),
      user: z.looseObject({ username: z.string() }).optional(),
    })),
  }).nullable().optional(),
  batches: z.array(z.looseObject({
    id: z.string(),
    scope: z.string(),
    organizationId: z.string().nullable().optional(),
    organization: z.looseObject({
      id: z.string(),
      name: z.string(),
      shortName: z.string().nullable().optional(),
    }).nullable().optional(),
    track: z.string(),
    status: z.string(),
    fieldSize: z.number(),
    skipReason: z.string().nullable().optional(),
    changes: z.array(z.looseObject({
      userId: z.string(),
      ratingBefore: z.number(),
      appliedDelta: z.number(),
      ratingAfter: z.number(),
    })),
  })),
  myChanges: z.array(RatingChangeSchema).default([]),
})

export const ContestRatingContracts = {
  detail: defineApiEndpoint({
    key: 'contest.rating.detail',
    method: 'GET',
    scope: 'context',
    data: ContestRatingDataSchema,
  }),
} as const

export const RatingLeaderboardRowSchema = z.object({
  id: z.string(), userId: z.string(), username: z.string(), avatar: z.string().nullable().optional(),
  rating: z.number(), rank: z.number().int().positive().nullable(),
})

export const RatingLeaderboardSchema = paginatedDataSchema(RatingLeaderboardRowSchema).extend({
  track: RankingTrackSchema,
  scope: z.enum(['GLOBAL', 'ORGANIZATION']),
  organizationId: z.string().nullable().optional(),
})

const LeaderboardQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().max(100).optional(),
})

export const RatingLeaderboardContracts = {
  global: defineApiEndpoint({ key: 'rating.leaderboard.global', method: 'GET', scope: 'account', query: LeaderboardQuerySchema, data: RatingLeaderboardSchema }),
  organization: defineApiEndpoint({ key: 'rating.leaderboard.organization', method: 'GET', scope: 'organization', query: LeaderboardQuerySchema, data: RatingLeaderboardSchema }),
} as const

export const RatingAccountSchema = z.object({
  id: z.string(), poolId: z.string(), rating: z.number(), peakRating: z.number(),
  ratedContestCount: z.number().int().nonnegative(), provisional: z.boolean(),
  lastRatedAt: DateTimeWireSchema.nullable().optional(), track: RankingTrackSchema,
  scope: z.enum(['GLOBAL', 'ORGANIZATION']), organizationId: z.string().nullable().optional(),
  organizationName: z.string().nullable().optional(),
})

export const RatingAccountsSchema = z.object({
  baseRating: z.number(), accounts: z.array(RatingAccountSchema), missingTracksUseBaseRating: z.boolean(),
})

export const RatingHistoryItemSchema = z.object({
  id: z.string(),
  contest: z.object({ id: z.string(), canonicalId: z.string(), title: z.string(), endTime: DateTimeWireSchema }),
  rank: z.number().int().positive(), fieldSize: z.number().int().positive(),
  ratingBefore: z.number(), appliedDelta: z.number(), ratingAfter: z.number(),
  expectedPerformance: z.number(), actualPerformance: z.number(), createdAt: DateTimeWireSchema,
})

const RatingHistoryQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  scope: z.enum(['GLOBAL', 'ORGANIZATION']).default('GLOBAL'),
  organizationId: z.string().optional(),
  track: RankingTrackSchema.default('OI'),
})

export const RatingHistorySchema = paginatedDataSchema(RatingHistoryItemSchema).extend({
  account: RatingAccountSchema.nullable(),
})

export const RatingAccountContracts = {
  mine: defineApiEndpoint({ key: 'rating.account.mine', method: 'GET', scope: 'account', data: RatingAccountsSchema }),
  history: defineApiEndpoint({ key: 'rating.account.history', method: 'GET', scope: 'account', query: RatingHistoryQuerySchema, data: RatingHistorySchema }),
} as const

export type RatingChange = z.infer<typeof RatingChangeSchema>
export type ContestRatingData = z.infer<typeof ContestRatingDataSchema>
export type RatingLeaderboardRow = z.infer<typeof RatingLeaderboardRowSchema>
export type RatingAccount = z.infer<typeof RatingAccountSchema>
export type RatingHistoryItem = z.infer<typeof RatingHistoryItemSchema>
