import { Router } from 'express'
import {
  HEALTH_CONTRACT_VERSION,
  type HealthResponse,
} from '@oi-manager/contracts'
import { resolveReadiness } from './health.service'

export const healthRouter = Router()

// Liveness deliberately has no dependency calls: it answers whether this
// process can serve HTTP, not whether downstream systems are available.
healthRouter.get('/health', (_req, res) => {
  const response: HealthResponse = {
    schemaVersion: HEALTH_CONTRACT_VERSION,
    status: 'ok',
    service: 'api',
    timestamp: new Date().toISOString(),
    success: true,
    message: 'OK',
  }
  res.json(response)
})

// Readiness contains only dependencies required to accept traffic. Domain
// consistency is monitored by dedicated operational checks so data debt
// cannot unnecessarily remove an otherwise healthy API from rotation.
healthRouter.get('/readiness', async (_req, res) => {
  const result = await resolveReadiness()
  res.status(result.statusCode).json(result.response)
})
