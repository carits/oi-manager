import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createTestApp } from './helpers/testRequest'
import { generateTestToken } from './helpers/testToken'
import { createTestUser } from './helpers/testUser'
import { prisma } from '../src/prisma'

const app = createTestApp()

function tokenFor(account: Awaited<ReturnType<typeof createTestUser>>) {
  return generateTestToken({
    userId: account.user.id,
    username: account.user.username,
    role: account.user.role,
    workspaceMode: 'personal',
  })
}

describe('platform contest lifecycle', () => {
  it('lets only platform managers create an account-level contest with a default frozen-domain config', async () => {
    const participant = await createTestUser({ role: 'user' })
    const manager = await createTestUser({ role: 'platform_admin' })
    const body = {
      title: 'Carits Platform Rating Test',
      format: 'ioi',
      startTime: new Date(Date.now() + 3_600_000).toISOString(),
      endTime: new Date(Date.now() + 7_200_000).toISOString(),
    }

    const denied = await request(app)
      .post('/api/platform-contests')
      .set('Authorization', `Bearer ${tokenFor(participant)}`)
      .send(body)
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe('PLATFORM_CONTEST_MANAGE_DENIED')

    const created = await request(app)
      .post('/api/platform-contests')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send(body)
    expect(created.status).toBe(201)

    const contest = await prisma.training.findUniqueOrThrow({
      where: { id: created.body.data.id },
      include: { RatingConfig: true },
    })
    expect(contest).toMatchObject({ type: 'contest', scope: 'platform', teamId: null, organizationId: null })
    expect(contest.RatingConfig).toMatchObject({ scope: 'NONE', track: 'IOI', revision: 1 })

    const configured = await request(app)
      .put(`/api/trainings/${contest.id}/rating-config`)
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({ scope: 'GLOBAL', expectedRevision: 1, weight: 1, globalMinParticipants: 2, organizationMinParticipants: 2 })
    expect(configured.status).toBe(200)
    expect(configured.body.data).toMatchObject({ scope: 'GLOBAL', context: 'platform' })
  })

  it('shows platform contests in personal discovery and allows an active account to open them', async () => {
    const participant = await createTestUser({ role: 'user' })
    const manager = await createTestUser({ role: 'super_admin' })
    const created = await request(app)
      .post('/api/platform-contests')
      .set('Authorization', `Bearer ${tokenFor(manager)}`)
      .send({
        title: 'Public Platform Contest',
        format: 'icpc',
        startTime: new Date(Date.now() + 3_600_000).toISOString(),
        endTime: new Date(Date.now() + 7_200_000).toISOString(),
      })
    expect(created.status).toBe(201)

    const [directory, personal, detail] = await Promise.all([
      request(app).get('/api/platform-contests').set('Authorization', `Bearer ${tokenFor(participant)}`),
      request(app).get('/api/me/contests').set('Authorization', `Bearer ${tokenFor(participant)}`),
      request(app).get(`/api/trainings/${created.body.data.id}`).set('Authorization', `Bearer ${tokenFor(participant)}`),
    ])
    expect(directory.status).toBe(200)
    expect(directory.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.data.id, scope: 'platform' })]))
    expect(personal.status).toBe(200)
    expect(personal.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.data.id, source: 'platform' })]))
    expect(detail.status).toBe(200)
    expect(detail.body.data).toMatchObject({ id: created.body.data.id, scope: 'platform', isAdmin: false })
  })
})
