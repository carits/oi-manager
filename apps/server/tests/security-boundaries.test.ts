import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ojFetcherRouter } from '../src/routes/oj-fetcher'
import { migrationRouter } from '../src/routes/migration'
import { prisma } from '../src/prisma'
import { generateTestToken } from './helpers/testToken'
import { createTestUser } from './helpers/testUser'

const app = express()
app.use(express.json())
app.use('/api/oj-fetcher', ojFetcherRouter)
app.use('/api/admin/migration', migrationRouter)

type SecurityRole = 'student' | 'platform_admin' | 'super_admin'
let securityUsers: Partial<Record<SecurityRole, Awaited<ReturnType<typeof createTestUser>>>> = {}

const tokenFor = (role: SecurityRole) => {
  const user = securityUsers[role]
  if (!user) throw new Error(`Missing security fixture for ${role}`)
  return generateTestToken({
    userId: user.user.id,
    username: user.user.username,
    role,
  })
}

beforeEach(async () => {
  securityUsers = {
    student: await createTestUser({ role: 'student', username: 'security-student' }),
    platform_admin: await createTestUser({ role: 'platform_admin', username: 'security-platform-admin' }),
    super_admin: await createTestUser({ role: 'super_admin', username: 'security-super-admin' }),
  }
})

afterEach(async () => {
  process.env.ENABLE_MAINTENANCE_API = 'false'
  await prisma.ojPlatformConfig.deleteMany({
    where: { platform: { in: ['security-test', 'carits'] } },
  })
})

describe('sensitive route boundaries', () => {
  it('rejects anonymous and non-admin access to global OJ jobs', async () => {
    const anonymous = await request(app).get('/api/oj-fetcher/jobs')
    expect(anonymous.status).toBe(401)

    const student = await request(app)
      .get('/api/oj-fetcher/jobs')
      .set('Authorization', `Bearer ${tokenFor('student')}`)
    expect(student.status).toBe(403)

    const platformAdmin = await request(app)
      .get('/api/oj-fetcher/jobs?pageSize=1')
      .set('Authorization', `Bearer ${tokenFor('platform_admin')}`)
    expect(platformAdmin.status).toBe(200)
  })

  it('keeps OJ credentials super-admin-only and never returns values', async () => {
    await prisma.ojPlatformConfig.create({
      data: {
        id: crypto.randomUUID(),
        platform: 'carits',
        cookies: JSON.stringify({
          session: 'must-not-leak',
          token: 'also-secret',
        }),
      },
    })

    const platformAdmin = await request(app)
      .get('/api/oj-fetcher/platforms/carits/config')
      .set('Authorization', `Bearer ${tokenFor('platform_admin')}`)
    expect(platformAdmin.status).toBe(403)

    const superAdmin = await request(app)
      .get('/api/oj-fetcher/platforms/carits/config')
      .set('Authorization', `Bearer ${tokenFor('super_admin')}`)
    expect(superAdmin.status).toBe(200)
    expect(superAdmin.body.data).toMatchObject({
      configured: true,
      cookieNames: ['session', 'token'],
    })
    expect(JSON.stringify(superAdmin.body)).not.toContain('must-not-leak')
    expect(JSON.stringify(superAdmin.body)).not.toContain('also-secret')
    expect(superAdmin.body.data.cookies).toBeUndefined()
  })

  it('rejects unknown OJ configuration platforms and oversized batches', async () => {
    const unknown = await request(app)
      .get('/api/oj-fetcher/platforms/security-test/config')
      .set('Authorization', `Bearer ${tokenFor('super_admin')}`)
    expect(unknown.status).toBe(400)

    const oversized = await request(app)
      .post('/api/oj-fetcher/jobs/batch')
      .set('Authorization', `Bearer ${tokenFor('platform_admin')}`)
      .send({ platform: 'carits', problemIds: Array.from({ length: 201 }, (_, index) => String(index + 1)) })
    expect(oversized.status).toBe(400)
  })

  it('requires super admin and an explicit maintenance flag', async () => {
    const anonymous = await request(app)
      .post('/api/admin/migration/migrate-submission-scope')
    expect(anonymous.status).toBe(401)

    const student = await request(app)
      .post('/api/admin/migration/migrate-submission-scope')
      .set('Authorization', `Bearer ${tokenFor('student')}`)
    expect(student.status).toBe(403)

    const disabled = await request(app)
      .post('/api/admin/migration/migrate-submission-scope')
      .set('Authorization', `Bearer ${tokenFor('super_admin')}`)
    expect(disabled.status).toBe(404)
  })
})
