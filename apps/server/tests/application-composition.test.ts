import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { HEALTH_CONTRACT_VERSION } from '@oi-manager/contracts'
import { createTestApp } from './helpers/testRequest'

describe('production application composition', () => {
  it('serves the canonical public health contract', async () => {
    const response = await request(createTestApp()).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      schemaVersion: HEALTH_CONTRACT_VERSION,
      status: 'ok',
      service: 'api',
      success: true,
      message: 'OK',
    })
    expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false)
  })

  it('uses the canonical not-found response', async () => {
    const response = await request(createTestApp()).get('/api/route-that-does-not-exist')

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ success: false, message: '接口不存在' })
  })
})
