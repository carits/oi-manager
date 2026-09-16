import { z } from 'zod'
import { DateTimeWireSchema, PaginationQuerySchema, defineApiEndpoint } from './http'

export const OjFetchJobStatusSchema = z.enum([
  'pending',
  'fetching',
  'success',
  'failed',
  'duplicate',
])

export const OjFetchJobSchema = z.object({
  id: z.string(),
  platform: z.string(),
  problemId: z.string(),
  status: OjFetchJobStatusSchema,
  message: z.string().nullable(),
  hasAttachment: z.boolean(),
  attachmentStatus: z.enum(['pending', 'success', 'failed', 'skipped']).nullable(),
  createdProblemId: z.string().nullable(),
  createdAt: DateTimeWireSchema,
}).passthrough()

export const OjFetchJobListQuerySchema = PaginationQuerySchema.extend({
  platform: z.string().optional(),
  status: OjFetchJobStatusSchema.optional(),
  problemId: z.string().optional(),
})

export const OjFetchJobListSchema = z.object({
  data: z.array(OjFetchJobSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
})

export const OjPlatformConfigSchema = z.object({
  platform: z.string(),
  configured: z.boolean(),
  cookieNames: z.array(z.string()),
  lastUsedAt: DateTimeWireSchema.nullable(),
})

export const OjPlatformConfigInputSchema = z.object({
  cookies: z.record(z.string(), z.string()),
})

export const OjFetchBatchInputSchema = z.object({
  platform: z.string().min(1),
  // Cardinality and element business validation remain in the service so the
  // established domain-specific 400 response is preserved.
  problemIds: z.array(z.unknown()).min(1),
})

export const OjFetchBatchResultSchema = z.object({
  total: z.number().int().nonnegative(),
  new: z.number().int().nonnegative(),
  existing: z.number().int().nonnegative(),
  results: z.array(z.object({
    problemId: z.string(),
    jobId: z.string().optional(),
    status: z.literal('pending'),
    isNew: z.boolean(),
    reset: z.boolean().optional(),
  })),
})

const EmptyObjectSchema = z.object({})

export const OjFetcherContracts = {
  listJobs: defineApiEndpoint({
    key: 'oj-fetcher.jobs.list',
    method: 'GET',
    scope: 'platform',
    query: OjFetchJobListQuerySchema,
    data: OjFetchJobListSchema,
  }),
  getPlatformConfig: defineApiEndpoint({
    key: 'oj-fetcher.platform-config.get',
    method: 'GET',
    scope: 'platform',
    data: OjPlatformConfigSchema,
  }),
  updatePlatformConfig: defineApiEndpoint({
    key: 'oj-fetcher.platform-config.update',
    method: 'PUT',
    scope: 'platform',
    body: OjPlatformConfigInputSchema,
    data: OjPlatformConfigSchema,
  }),
  createBatch: defineApiEndpoint({
    key: 'oj-fetcher.jobs.batch-create',
    method: 'POST',
    scope: 'platform',
    body: OjFetchBatchInputSchema,
    data: OjFetchBatchResultSchema,
  }),
  retryJob: defineApiEndpoint({
    key: 'oj-fetcher.job.retry',
    method: 'POST',
    scope: 'platform',
    body: EmptyObjectSchema,
    data: EmptyObjectSchema,
  }),
  deleteJob: defineApiEndpoint({
    key: 'oj-fetcher.job.delete',
    method: 'DELETE',
    scope: 'platform',
    body: EmptyObjectSchema,
    data: EmptyObjectSchema,
  }),
} as const

export type OjFetchJob = z.infer<typeof OjFetchJobSchema>
export type OjPlatformConfig = z.infer<typeof OjPlatformConfigSchema>
