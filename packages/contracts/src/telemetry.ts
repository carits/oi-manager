import { z } from 'zod'
import { defineApiEndpoint } from './http'

export const ClientErrorPayloadSchema = z.object({
  type: z.enum(['error', 'unhandledrejection', 'resource']), message: z.string().trim().min(1).max(1000),
  stack: z.string().max(8000).optional(), route: z.string().max(500).optional(), source: z.string().max(500).optional(),
  line: z.number().int().nonnegative().max(10_000_000).optional(), column: z.number().int().nonnegative().max(10_000_000).optional(),
  buildId: z.string().max(160).optional(),
}).strict()

export const TelemetryContracts = {
  clientError: defineApiEndpoint({
    key: 'telemetry.clientError', method: 'POST', scope: 'public', body: ClientErrorPayloadSchema,
    data: z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }),
  }),
} as const
