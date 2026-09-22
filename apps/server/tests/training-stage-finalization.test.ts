import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers/testRequest'

const app = createTestApp()

describe('legacy training API retirement', () => {
  it('returns 410 for the legacy collection', async () => {
    const response = await request(app).get('/api/trainings')
    expect(response.status).toBe(410)
    expect(response.body.code).toBe('TRAINING_LEGACY_API_RETIRED')
  })

  it('returns 410 for nested legacy endpoints', async () => {
    const response = await request(app).post('/api/trainings/legacy-id/submit')
    expect(response.status).toBe(410)
    expect(response.body.code).toBe('TRAINING_LEGACY_API_RETIRED')
  })

  it('keeps the stage-driven route registered', async () => {
    const response = await request(app).get('/api/training-sessions')
    expect(response.status).not.toBe(404)
  })
})
