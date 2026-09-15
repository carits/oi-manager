import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

export const EvaluationCreditPackageSchema = z.object({
  packageCode: z.string(),
  carits: z.string().regex(/^\d+$/),
  credits: z.number().int().positive(),
  exchangeRate: z.number().int().positive(),
  policyCode: z.string(),
  policyVersion: z.number().int().positive(),
})
export type EvaluationCreditPackage = z.infer<typeof EvaluationCreditPackageSchema>

export const EvaluationCreditPurchaseSchema = z.object({
  id: z.string(),
  packageCode: z.string(),
  caritsAmount: z.string().regex(/^\d+$/),
  evaluationCredits: z.number().int().positive(),
  status: z.string(),
  createdAt: DateTimeWireSchema,
}).passthrough()
export type EvaluationCreditPurchase = z.infer<typeof EvaluationCreditPurchaseSchema>

export const EvaluationCreditOverviewSchema = z.object({
  periodStart: DateTimeWireSchema,
  resetsAt: DateTimeWireSchema,
  level: z.string(),
  contributionScore: z.number().int().nonnegative(),
  dailyLimit: z.number().int().nonnegative(),
  free: z.object({
    limit: z.number().int().nonnegative(), available: z.number().int().nonnegative(),
    reserved: z.number().int().nonnegative(), consumed: z.number().int().nonnegative(),
  }),
  purchased: z.object({
    available: z.number().int().nonnegative(), reserved: z.number().int().nonnegative(),
    consumed: z.string().regex(/^\d+$/),
  }),
  today: z.object({ reserved: z.number().int().nonnegative(), consumed: z.number().int().nonnegative() }),
  packages: z.array(EvaluationCreditPackageSchema),
  recentPurchases: z.array(EvaluationCreditPurchaseSchema),
})
export type EvaluationCreditOverview = z.infer<typeof EvaluationCreditOverviewSchema>

const PurchaseBodySchema = z.object({ packageCode: z.string().min(1).max(64) }).passthrough()

export const EvaluationCreditContracts = {
  packages: defineApiEndpoint({ key: 'evaluation-credits.packages', method: 'GET', scope: 'account', data: z.object({ items: z.array(EvaluationCreditPackageSchema) }) }),
  overview: defineApiEndpoint({ key: 'evaluation-credits.overview', method: 'GET', scope: 'account', data: EvaluationCreditOverviewSchema }),
  purchases: defineApiEndpoint({ key: 'evaluation-credits.purchases', method: 'GET', scope: 'account', data: z.object({ items: z.array(EvaluationCreditPurchaseSchema) }) }),
  purchase: defineApiEndpoint({ key: 'evaluation-credits.purchase', method: 'POST', scope: 'account', body: PurchaseBodySchema, data: EvaluationCreditPurchaseSchema }),
} as const
