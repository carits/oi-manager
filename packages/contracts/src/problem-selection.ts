import { z } from 'zod'
import { defineApiEndpoint } from './http'

export const ProblemSelectionItemSchema = z.object({
  clientKey: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(50),
  problemCode: z.string().trim().min(1).max(128),
})

export const ProblemSelectionBodySchema = z.object({
  items: z.array(ProblemSelectionItemSchema).min(1).max(100),
})

export const ResolvedProblemSelectionSchema = z.object({
  clientKey: z.string(),
  platform: z.string(),
  problemCode: z.string(),
  status: z.enum(['resolved', 'not_found', 'revision_unavailable']),
  problem: z.object({
    id: z.string(),
    platform: z.string(),
    problemCode: z.string(),
    title: z.string(),
    difficulty: z.string().nullable().optional(),
    latestRevision: z.object({
      id: z.string(),
      number: z.number().int().positive(),
      mode: z.enum(['acm', 'oi']),
    }).optional(),
  }).optional(),
  message: z.string().optional(),
})

export const ProblemSelectionContracts = {
  resolve: defineApiEndpoint({
    key: 'problem-selection.resolve',
    method: 'POST',
    scope: 'context',
    body: ProblemSelectionBodySchema,
    data: z.object({ items: z.array(ResolvedProblemSelectionSchema) }),
  }),
} as const

export type ProblemSelectionItem = z.infer<typeof ProblemSelectionItemSchema>
export type ResolvedProblemSelection = z.infer<typeof ResolvedProblemSelectionSchema>

