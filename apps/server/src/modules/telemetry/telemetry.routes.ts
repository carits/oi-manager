import { Router } from 'express'
import { TelemetryContracts } from '@oi-manager/contracts'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import { clientTelemetryLimiter } from '../../middleware/rateLimiter'
import { recordClientError } from './client-telemetry.service'

export const telemetryRouter = Router()

telemetryRouter.post('/client-errors', clientTelemetryLimiter, (req, res) => {
  try {
    const body = parseContractBody(TelemetryContracts.clientError, req.body)
    const result = recordClientError(body, { requestId: req.requestId, userAgent: req.headers['user-agent'], ip: req.ip || req.socket.remoteAddress })
    sendContractData(res, TelemetryContracts.clientError, result, 202)
  } catch (error) {
    if (!sendContractError(error, res)) throw error
  }
})
