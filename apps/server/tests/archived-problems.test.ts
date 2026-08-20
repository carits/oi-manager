import { describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import { archivedProblemsRouter } from '../src/routes/archived-problems'
import { createTestUser } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { prisma } from '../src/prisma'

const app = express()
app.use(express.json())
app.use('/api/archived-problems', archivedProblemsRouter)

describe('archived problem routes', () => {
  it('routes stats summary before the dynamic id route', async () => {
    const fixture = await createTestUser({ role: 'student' })
    await prisma.userArchivedProblem.create({
      data: {
        id: crypto.randomUUID(),
        userId: fixture.user.id,
        platform: 'codeforces',
        problemId: '100A',
        title: 'Test archive',
      },
    })
    const token = generateTestToken({ userId: fixture.user.id, username: fixture.user.username, role: 'student' })
    const response = await request(app)
      .get('/api/archived-problems/stats/summary')
      .set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ total: 1, byPlatform: [{ platform: 'codeforces', count: 1 }] })
  })
})
