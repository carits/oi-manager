import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

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

export type RatingChange = z.infer<typeof RatingChangeSchema>
export type ContestRatingData = z.infer<typeof ContestRatingDataSchema>
