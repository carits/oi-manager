import { z } from 'zod'
import { defineApiEndpoint } from './http'

export const ProblemSelectionItemSchema = z.object({
  clientKey: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(50),
  // Canonical platform-local problem identifier, never the internal Problem.id UUID.
  problemId: z.string().trim().min(1).max(128),
})

export const ProblemSelectionBodySchema = z.object({
  items: z.array(ProblemSelectionItemSchema).min(1).max(100),
}).superRefine((body, context) => {
  const seen = new Set<string>()
  body.items.forEach((item, index) => {
    if (seen.has(item.clientKey)) context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items', index, 'clientKey'],
      message: 'Each selection row must have a unique clientKey',
    })
    seen.add(item.clientKey)
  })
})

const ProblemSelectionDataSlotSchema = z.object({
  graphHash: z.string(),
  fencingToken: z.number().int().nonnegative(),
  mode: z.enum(['acm', 'oi']),
})

export const ResolvedProblemSelectionSchema = z.object({
  clientKey: z.string(),
  platform: z.string(),
  problemId: z.string(),
  // Identity resolution and assessment readiness are independent.
  status: z.enum(['resolved', 'not_found', 'invalid_input', 'not_published', 'identity_conflict']),
  problem: z.object({
    id: z.string(),
    platform: z.string(),
    problemId: z.string(),
    title: z.string(),
    difficulty: z.string().nullable().optional(),
    stableData: ProblemSelectionDataSlotSchema.extend({ slot: z.literal('STABLE') }).optional(),
    evolvingData: ProblemSelectionDataSlotSchema.extend({ slot: z.literal('EVOLVING') }).optional(),
  }).optional(),
  message: z.string().optional(),
}).superRefine((item, context) => {
  const mayDisclose = item.status === 'resolved' || item.status === 'not_published'
  if (mayDisclose !== Boolean(item.problem)) context.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['problem'],
    message: mayDisclose ? 'A resolved identity requires a problem' : 'This result must not disclose problem metadata',
  })
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
