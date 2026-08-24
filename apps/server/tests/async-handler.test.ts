import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { asyncHandler, classifyClientError } from '../src/lib/asyncHandler'
import { parseTrainingId } from '../src/modules/training/training.helpers'

describe('async route error boundary', () => {
  it('classifies known input, permission, missing-record and binding errors', () => {
    expect(classifyClientError(new Error('无效的训练 ID'))?.status).toBe(400)
    expect(classifyClientError(new Error('NOT_ADMIN'))?.status).toBe(403)
    expect(classifyClientError(new Error('TEAM_NOT_FOUND'))?.status).toBe(404)
    expect(classifyClientError({ code: 'P2025', message: 'missing' })?.status).toBe(404)
    expect(classifyClientError(new Error('请先绑定洛谷账号'))?.status).toBe(409)
    expect(classifyClientError(new Error('database unavailable'))).toBeNull()
  })

  it('returns a client response for invalid IDs instead of a 500', async () => {
    const app = express()
    app.get('/training/:id', asyncHandler(async req => {
      parseTrainingId(req.params.id)
    }))

    const response = await request(app).get('/training/not-a-number')
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ success: false, message: '无效的训练 ID' })
  })

  it('requires a complete positive decimal training ID', () => {
    expect(parseTrainingId('12')).toBe(12)
    for (const value of ['0', '-1', '1junk', '1.5', '', '9007199254740992']) {
      expect(() => parseTrainingId(value)).toThrow('无效的训练 ID')
    }
  })
})
