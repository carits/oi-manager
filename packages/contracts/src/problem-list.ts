import { z } from 'zod'
import { DateTimeWireSchema, PaginationQuerySchema, defineApiEndpoint } from './http'

export const ProblemListSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  ownerId: z.string(),
  createdAt: DateTimeWireSchema,
  updatedAt: DateTimeWireSchema,
  _count: z.object({ Entries: z.number().int().nonnegative() }),
  _permission: z.enum(['admin', 'edit', 'view']),
})

export const ProblemListQuerySchema = PaginationQuerySchema.extend({
  tab: z.enum(['all', 'mine', 'shared']).default('all'),
  keyword: z.string().max(200).optional(),
  teamId: z.string().optional(),
})

export const ProblemListCollectionSchema = z.object({
  lists: z.array(ProblemListSummarySchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
})

export const ProblemListCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  visibility: z.enum(['private', 'shared']).optional(),
})

export const ProblemListCreatedSchema = z.object({ id: z.string() }).passthrough()

export const ProblemListContracts = {
  list: defineApiEndpoint({
    key: 'problem-list.list', method: 'GET', scope: 'context',
    query: ProblemListQuerySchema, data: ProblemListCollectionSchema,
  }),
  create: defineApiEndpoint({
    key: 'problem-list.create', method: 'POST', scope: 'context',
    body: ProblemListCreateInputSchema, data: ProblemListCreatedSchema,
  }),
  delete: defineApiEndpoint({
    key: 'problem-list.delete', method: 'DELETE', scope: 'context',
    body: z.object({}), data: z.object({}),
  }),
} as const

export type ProblemListSummary = z.infer<typeof ProblemListSummarySchema>
export type ProblemListQuery = z.infer<typeof ProblemListQuerySchema>
export type ProblemListCreateInput = z.infer<typeof ProblemListCreateInputSchema>
export type ProblemListCollection = z.infer<typeof ProblemListCollectionSchema>
