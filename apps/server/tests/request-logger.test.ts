import express, { Router } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { requestLogger } from '../src/middleware/requestLogger'
import { metrics } from '../src/lib/metrics'

describe('requestLogger', () => {
  beforeEach(() => metrics.reset())
  afterEach(() => metrics.reset())

  it('preserves the original public path after nested router dispatch', async () => {
    const app = express()
    const router = Router()

    router.get('/:id', (_req, res) => res.json({ success: true }))
    app.use(requestLogger)
    app.use('/api/items', router)

    await request(app)
      .get('/api/items/f8c64ac4-d9f5-4c2c-a0e8-0dbeac098bed')
      .expect(200)

    expect(metrics.getEndpointSummary()).toEqual([
      expect.objectContaining({
        endpoint: 'GET:/api/items/:id',
        count: 1,
        successRate: '100.0%'
      })
    ])
  })
})
