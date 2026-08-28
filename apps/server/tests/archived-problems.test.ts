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

  it('returns correct pagination metadata and never exposes another user archive', async () => {
    const owner = await createTestUser({ role: 'student' })
    const outsider = await createTestUser({ role: 'student' })
    await prisma.userArchivedProblem.createMany({
      data: [
        { id: crypto.randomUUID(), userId: owner.user.id, platform: 'codeforces', problemId: '200A', title: 'Owner A' },
        { id: crypto.randomUUID(), userId: owner.user.id, platform: 'codeforces', problemId: '200B', title: 'Owner B' },
        { id: crypto.randomUUID(), userId: outsider.user.id, platform: 'codeforces', problemId: '999A', title: 'Other' },
      ],
    })
    const token = generateTestToken({ userId: owner.user.id, username: owner.user.username, role: 'student' })
    const response = await request(app)
      .get('/api/archived-problems?page=1&pageSize=1')
      .set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 })
    expect(response.body.data).toHaveLength(1)
    expect(response.body.data[0].userId).toBe(owner.user.id)
  })
})
