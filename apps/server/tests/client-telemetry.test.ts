import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import logger from '../src/lib/logger'
import { recordClientError } from '../src/modules/telemetry/client-telemetry.service'
import { telemetryRouter } from '../src/modules/telemetry/telemetry.routes'

describe('client telemetry', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('accepts a bounded anonymous browser error report', async () => {
    const app = express()
    app.use(express.json())
    app.use('/api/telemetry', telemetryRouter)

    const response = await request(app)
      .post('/api/telemetry/client-errors')
      .send({ type: 'error', message: 'render failed', route: '/problems/1' })

    expect(response.status).toBe(202)
    expect(response.body.data.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects unknown or oversized fields', async () => {
    const app = express()
    app.use(express.json())
    app.use('/api/telemetry', telemetryRouter)

    const response = await request(app)
      .post('/api/telemetry/client-errors')
      .send({ type: 'error', message: 'x'.repeat(1001), secret: 'must-not-pass' })

    expect(response.status).toBe(400)
  })

  it('redacts credentials and never logs the raw stack', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const result = recordClientError({
      type: 'unhandledrejection',
      message: 'failed?token=top-secret',
      route: '/callback?code=secret-code',
      stack: 'Bearer raw-secret-token',
    }, { requestId: 'req-1', userAgent: 'test-agent', ip: '127.0.0.1' })

    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(warn).toHaveBeenCalledOnce()
    const payload = warn.mock.calls[0][1] as { metadata: Record<string, unknown> }
    expect(payload.metadata.message).toBe('failed?token=[redacted]')
    expect(payload.metadata.route).toBe('/callback?code=[redacted]')
    expect(JSON.stringify(payload)).not.toContain('raw-secret-token')
  })
})
