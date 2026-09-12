import { z } from 'zod'

export const HEALTH_CONTRACT_VERSION = 1 as const

export const HealthResponseSchema = z.object({
  schemaVersion: z.literal(HEALTH_CONTRACT_VERSION),
  status: z.literal('ok'),
  service: z.literal('api'),
  timestamp: z.iso.datetime(),
  success: z.literal(true),
  message: z.literal('OK'),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>

const DependencyReadinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  latencyMs: z.number().nonnegative(),
})

export const ReadinessResponseSchema = z.object({
  schemaVersion: z.literal(HEALTH_CONTRACT_VERSION),
  status: z.enum(['ready', 'not_ready']),
  service: z.literal('api'),
  timestamp: z.iso.datetime(),
  dependencies: z.object({ database: DependencyReadinessSchema }),
})
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>
