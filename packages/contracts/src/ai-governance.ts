import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

const IntegerWireSchema = z.union([
  z.string().regex(/^-?\d+$/),
  z.bigint().transform(value => value.toString()),
])

export const AiTokenPoolSchema = z.object({
  id: z.string(),
  availableTokens: IntegerWireSchema,
  reservedTokens: IntegerWireSchema,
  consumedTokens: IntegerWireSchema,
  version: z.number().int().nonnegative(),
  status: z.string(),
  createdAt: DateTimeWireSchema,
  updatedAt: DateTimeWireSchema,
})

export const AiTokenLedgerEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  amount: IntegerWireSchema,
  availableAfter: IntegerWireSchema,
  reservedAfter: IntegerWireSchema,
  consumedAfter: IntegerWireSchema,
  requestId: z.string().nullable().optional(),
  operatorUserId: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  createdAt: DateTimeWireSchema,
})

export const AiTokenUsageSchema = z.object({
  pool: AiTokenPoolSchema,
  entries: z.array(AiTokenLedgerEntrySchema),
})

const EvaluationAccountSchema = z.object({
  id: z.string().optional(),
  subjectId: z.string().optional(),
  limitCredits: z.number().int().nonnegative(),
  availableCredits: z.number().int().nonnegative(),
  reservedCredits: z.number().int().nonnegative(),
  consumedCredits: z.number().int().nonnegative(),
})

export const EvaluationBudgetOverviewSchema = z.object({
  periodStart: DateTimeWireSchema,
  platform: EvaluationAccountSchema,
  users: z.array(EvaluationAccountSchema.extend({ id: z.string(), subjectId: z.string(), username: z.string() })),
  candidates: z.array(z.object({
    status: z.string(),
    count: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  })),
  blobs: z.object({
    count: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    orphanCount: z.number().int().nonnegative(),
    orphanBytes: z.number().int().nonnegative(),
  }),
})

export const AdjustAiTokenPoolBodySchema = z.object({
  amount: z.coerce.number().int().safe().refine(value => value !== 0, '调整量不能为 0'),
  reason: z.string().trim().min(2).max(500),
  idempotencyKey: z.string().trim().min(8).max(200),
})

export const AiGovernanceContracts = {
  tokenPool: defineApiEndpoint({ key: 'ai-governance.token-pool', method: 'GET', scope: 'platform', data: AiTokenPoolSchema }),
  tokenUsage: defineApiEndpoint({ key: 'ai-governance.token-usage', method: 'GET', scope: 'platform', data: AiTokenUsageSchema }),
  evaluationBudget: defineApiEndpoint({ key: 'ai-governance.evaluation-budget', method: 'GET', scope: 'platform', data: EvaluationBudgetOverviewSchema }),
  adjustTokenPool: defineApiEndpoint({ key: 'ai-governance.adjust-token-pool', method: 'POST', scope: 'platform', body: AdjustAiTokenPoolBodySchema, data: AiTokenLedgerEntrySchema }),
} as const

export type AiTokenUsage = z.infer<typeof AiTokenUsageSchema>
export type EvaluationBudgetOverview = z.infer<typeof EvaluationBudgetOverviewSchema>
