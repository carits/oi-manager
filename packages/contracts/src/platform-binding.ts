import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

export const BindingPlatformSchema = z.enum(['vjudge', 'luogu', 'codeforces', 'atcoder'])
export type BindingPlatform = z.infer<typeof BindingPlatformSchema>

export const PlatformBindingConfigSchema = z.object({
  id: BindingPlatformSchema,
  name: z.string(),
  color: z.string(),
  description: z.string().optional(),
  supported: z.boolean(),
})
export type PlatformBindingConfig = z.infer<typeof PlatformBindingConfigSchema>

export const PlatformBindingFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'password', 'textarea']),
  required: z.boolean(),
  placeholder: z.string().optional(),
})
export type PlatformBindingField = z.infer<typeof PlatformBindingFieldSchema>

export const PlatformBindingConfigFormSchema = z.object({
  fields: z.array(PlatformBindingFieldSchema),
  helpText: z.string(),
})

export const PlatformBindingSchema = z.object({
  id: z.string(),
  platform: BindingPlatformSchema,
  platformUsername: z.string().nullable(),
  bindingStatus: z.enum(['unbound', 'pending', 'bound', 'failed', 'expired']),
  statusMessage: z.string().nullable().optional(),
  verifiedAt: DateTimeWireSchema.nullable(),
})
export type PlatformBinding = z.infer<typeof PlatformBindingSchema>

const BindBodySchema = z.object({
  platformUsername: z.string().trim().optional(),
  password: z.string().optional(),
  extra: z.record(z.string(), z.string()).optional(),
})
const BindResultSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  platformUsername: z.string().optional(),
})

export const PlatformBindingContracts = {
  platforms: defineApiEndpoint({ key: 'platform-binding.platforms', method: 'GET', scope: 'context', data: z.array(PlatformBindingConfigSchema) }),
  config: defineApiEndpoint({ key: 'platform-binding.config', method: 'GET', scope: 'context', data: PlatformBindingConfigFormSchema }),
  list: defineApiEndpoint({ key: 'platform-binding.list', method: 'GET', scope: 'account', data: z.array(PlatformBindingSchema) }),
  detail: defineApiEndpoint({ key: 'platform-binding.detail', method: 'GET', scope: 'account', data: z.object({ bound: z.boolean(), username: z.string().optional() }) }),
  bind: defineApiEndpoint({ key: 'platform-binding.bind', method: 'POST', scope: 'account', body: BindBodySchema, data: BindResultSchema }),
  unbind: defineApiEndpoint({ key: 'platform-binding.unbind', method: 'DELETE', scope: 'account', body: z.object({}).default({}), data: z.object({ unbound: z.literal(true) }) }),
  refresh: defineApiEndpoint({ key: 'platform-binding.refresh', method: 'POST', scope: 'account', body: z.object({}).default({}), data: z.object({ refreshed: z.literal(true) }) }),
} as const
