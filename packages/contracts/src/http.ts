import { z } from 'zod'

export function apiSuccessSchema<T extends z.ZodType>(data: T) {
  return z.object({
    success: z.literal(true),
    data,
    message: z.string().optional(),
  })
}

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  code: z.string().optional(),
  message: z.string(),
  details: z.unknown().optional(),
  data: z.unknown().optional(),
})
export type ApiErrorContract = z.infer<typeof ApiErrorSchema>

export type ApiSuccessContract<T> = {
  success: true
  data: T
  message?: string
}

export type ApiEnvelope<T> = ApiSuccessContract<T> | ApiErrorContract

export const ContractScopeSchema = z.enum(['public', 'account', 'platform', 'organization', 'context'])
export type ContractScope = z.infer<typeof ContractScopeSchema>

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * One endpoint contract shared by the server adapter and browser feature API.
 * Paths are resolved by the feature slice because route parameters are runtime
 * values; request and response payloads always use the schemas declared here.
 */
export interface ApiEndpointContract<
  TDataSchema extends z.ZodType,
  TBodySchema extends z.ZodType = z.ZodUndefined,
  TQuerySchema extends z.ZodType = z.ZodUndefined,
> {
  readonly key: string
  readonly method: HttpMethod
  readonly scope: ContractScope
  readonly data: TDataSchema
  readonly body: TBodySchema
  readonly query: TQuerySchema
}

export type AnyApiEndpointContract = ApiEndpointContract<z.ZodType, z.ZodType, z.ZodType>

export function defineApiEndpoint<
  TDataSchema extends z.ZodType,
  TBodySchema extends z.ZodType = z.ZodUndefined,
  TQuerySchema extends z.ZodType = z.ZodUndefined,
>(input: {
  key: string
  method: HttpMethod
  scope: ContractScope
  data: TDataSchema
  body?: TBodySchema
  query?: TQuerySchema
}): ApiEndpointContract<TDataSchema, TBodySchema, TQuerySchema> {
  return {
    ...input,
    body: (input.body ?? z.undefined()) as TBodySchema,
    query: (input.query ?? z.undefined()) as TQuerySchema,
  }
}

export type EndpointData<T extends ApiEndpointContract<z.ZodType, z.ZodType, z.ZodType>> =
  z.infer<T['data']>
export type EndpointBody<T extends ApiEndpointContract<z.ZodType, z.ZodType, z.ZodType>> =
  z.infer<T['body']>
export type EndpointQuery<T extends ApiEndpointContract<z.ZodType, z.ZodType, z.ZodType>> =
  z.infer<T['query']>

export const FieldIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
})
export type FieldIssue = z.infer<typeof FieldIssueSchema>

/** Accept Prisma Date values server-side and expose one ISO wire value. */
export const DateTimeWireSchema = z.union([
  z.iso.datetime(),
  z.date().transform(value => value.toISOString()),
])

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>

export const PaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
})
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>

export function paginatedDataSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: PaginationMetaSchema.shape.page,
    pageSize: PaginationMetaSchema.shape.pageSize,
    total: PaginationMetaSchema.shape.total,
    totalPages: PaginationMetaSchema.shape.totalPages,
  })
}
