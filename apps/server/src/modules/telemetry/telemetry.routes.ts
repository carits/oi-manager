import { Router } from 'express'
import { z } from 'zod'
import { clientTelemetryLimiter } from '../../middleware/rateLimiter'
import { recordClientError } from './client-telemetry.service'

export const telemetryRouter = Router()

const clientErrorSchema = z.object({
  type: z.enum(['error', 'unhandledrejection', 'resource']),
  message: z.string().trim().min(1).max(1000),
  stack: z.string().max(8000).optional(),
  route: z.string().max(500).optional(),
  source: z.string().max(500).optional(),
  line: z.number().int().nonnegative().max(10_000_000).optional(),
  column: z.number().int().nonnegative().max(10_000_000).optional(),
  buildId: z.string().max(160).optional(),
}).strict()

telemetryRouter.post('/client-errors', clientTelemetryLimiter, (req, res) => {
  const parsed = clientErrorSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, message: '客户端遥测数据无效' })
    return
  }

  const result = recordClientError(parsed.data, {
    requestId: req.requestId,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.socket.remoteAddress,
  })
  res.status(202).json({ success: true, data: result })
})
