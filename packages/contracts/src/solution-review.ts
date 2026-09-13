import { z } from 'zod'
import { defineApiEndpoint } from './http'

export const SimilarityExcerptSchema = z.looseObject({
  kind: z.enum(['text', 'code']),
  left: z.object({ index: z.number(), text: z.string() }),
  right: z.object({ index: z.number(), text: z.string() }),
  similarityBasisPoints: z.number().int().min(0).max(10_000),
})

export const SimilarityComparisonSchema = z.looseObject({
  source: z.looseObject({
    type: z.string(),
    id: z.string(),
    title: z.string(),
    version: z.number(),
    author: z.looseObject({ id: z.string(), username: z.string() }).nullable().optional(),
  }).nullable(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  textSimilarityBasisPoints: z.number().int().min(0).max(10_000),
  codeSimilarityBasisPoints: z.number().int().min(0).max(10_000),
  maximumSimilarityBasisPoints: z.number().int().min(0).max(10_000),
  matches: z.array(SimilarityExcerptSchema).max(20),
})

export const SolutionReviewContracts = {
  similarityComparison: defineApiEndpoint({
    key: 'solution-review.similarity-comparison',
    method: 'GET',
    scope: 'context',
    data: SimilarityComparisonSchema,
  }),
} as const

export type SimilarityComparison = z.infer<typeof SimilarityComparisonSchema>
