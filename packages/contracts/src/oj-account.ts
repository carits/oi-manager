import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

export const OjAccountStatusSchema = z.enum(['active', 'expired', 'error', 'unverified'])

const OjAccountConfigShape = {
  enabled: z.boolean(),
  priority: z.number().int(),
  maxConsecutiveFailures: z.number().int(),
  freezeDurationMinutes: z.number().int(),
  submitMaxRetries: z.number().int(),
  retryIntervalSeconds: z.number().int(),
  loginFailureCooldownMinutes: z.number().int(),
  cookieValidMinutes: z.number().int(),
  reverifyIntervalMinutes: z.number().int(),
  renewLoginThresholdMinutes: z.number().int(),
  minSubmitIntervalSeconds: z.number().int(),
  minRequestIntervalSeconds: z.number().int(),
  maxConcurrentSubmissions: z.number().int(),
  maxConcurrentRequests: z.number().int(),
  firstPollDelaySeconds: z.number().int(),
  pollIntervalSeconds: z.number().int(),
  maxWaitDurationMinutes: z.number().int(),
  rateLimitThreshold: z.number().int(),
  banSuspicionCooldownHours: z.number().int(),
  autoVerifyIntervalMinutes: z.number().int(),
}

export const OjAccountSchema = z.object({
  id: z.string(),
  platform: z.string(),
  username: z.string(),
  loginMethod: z.string(),
  status: OjAccountStatusSchema,
  lastLoginAt: DateTimeWireSchema.nullable(),
  lastErrorMessage: z.string().nullable(),
  hasPassword: z.boolean(),
  hasCookie: z.boolean(),
  createdAt: DateTimeWireSchema,
  ...OjAccountConfigShape,
})

export const OjAccountStatsSchema = z.object({
  platform: z.string(),
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  expired: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  unverified: z.number().int().nonnegative(),
  lastExpiredAt: DateTimeWireSchema.nullable(),
  totalSubmissions: z.number().int().nonnegative(),
  totalSubmissionErrors: z.number().int().nonnegative(),
})

export const OjAccountListQuerySchema = z.object({
  platform: z.string().optional(),
  status: z.string().optional(),
})

export const OjAccountCreateInputSchema = z.object({
  // Required-field semantics remain in the service to preserve its precise 400 errors.
  platform: z.string().optional(),
  username: z.string().optional(),
  loginMethod: z.enum(['cookie', 'password']).optional(),
  cookie: z.string().optional(),
  password: z.string().optional(),
})

export const OjAccountUpdateInputSchema = z.object({
  cookie: z.string().optional(),
  password: z.string().optional(),
  ...Object.fromEntries(
    Object.entries(OjAccountConfigShape).map(([key, schema]) => [key, schema.optional()]),
  ),
})

export const OjAccountVerifyResultSchema = z.object({
  status: z.string(),
  message: z.string(),
  lastVerifiedAt: DateTimeWireSchema.optional(),
})

export const OjAccountLoginResultSchema = z.object({
  success: z.boolean(),
  status: z.string(),
  message: z.string(),
})

export const OjAccountBatchVerifyItemSchema = z.object({
  id: z.string(),
  platform: z.string(),
  username: z.string(),
  valid: z.boolean(),
  message: z.string(),
})

const EmptyObjectSchema = z.object({})

export const OjAccountContracts = {
  list: defineApiEndpoint({
    key: 'oj-account.list', method: 'GET', scope: 'platform',
    query: OjAccountListQuerySchema, data: z.array(OjAccountSchema),
  }),
  stats: defineApiEndpoint({
    key: 'oj-account.stats', method: 'GET', scope: 'platform',
    data: z.array(OjAccountStatsSchema),
  }),
  create: defineApiEndpoint({
    key: 'oj-account.create', method: 'POST', scope: 'platform',
    body: OjAccountCreateInputSchema, data: OjAccountSchema,
  }),
  update: defineApiEndpoint({
    key: 'oj-account.update', method: 'PUT', scope: 'platform',
    body: OjAccountUpdateInputSchema, data: OjAccountSchema,
  }),
  delete: defineApiEndpoint({
    key: 'oj-account.delete', method: 'DELETE', scope: 'platform',
    body: EmptyObjectSchema, data: EmptyObjectSchema,
  }),
  verify: defineApiEndpoint({
    key: 'oj-account.verify', method: 'POST', scope: 'platform',
    body: EmptyObjectSchema, data: OjAccountVerifyResultSchema,
  }),
  login: defineApiEndpoint({
    key: 'oj-account.login', method: 'POST', scope: 'platform',
    body: EmptyObjectSchema, data: OjAccountLoginResultSchema,
  }),
  batchVerify: defineApiEndpoint({
    key: 'oj-account.batch-verify', method: 'POST', scope: 'platform',
    body: EmptyObjectSchema, data: z.array(OjAccountBatchVerifyItemSchema),
  }),
} as const

export type OjAccount = z.infer<typeof OjAccountSchema>
export type OjAccountStats = z.infer<typeof OjAccountStatsSchema>
export type OjAccountCreateInput = z.infer<typeof OjAccountCreateInputSchema>
export type OjAccountUpdateInput = z.infer<typeof OjAccountUpdateInputSchema>
