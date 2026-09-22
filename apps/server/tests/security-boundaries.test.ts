import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ojFetcherRouter } from '../src/routes/oj-fetcher'
import { prisma } from '../src/prisma'
import { generateTestToken } from './helpers/testToken'
import { createTestUser } from './helpers/testUser'

const app = express()
app.use(express.json())
app.use('/api/oj-fetcher', ojFetcherRouter)

type SecurityRole = 'student' | 'platform_admin' | 'super_admin'
let securityUsers: Partial<Record<SecurityRole, Awaited<ReturnType<typeof createTestUser>>>> = {}

const tokenFor = (role: SecurityRole) => {
  const user = securityUsers[role]
  if (!user) throw new Error(`Missing security fixture for ${role}`)
  return generateTestToken({ userId: user.user.id, username: user.user.username, accountRole: user.user.accountRole })
}

beforeEach(async () => {
  securityUsers = {
    student: await createTestUser({ organization: { role: 'student' }, username: 'security-student' }),
    platform_admin: await createTestUser({ accountRole: 'platform_admin', username: 'security-platform-admin' }),
    super_admin: await createTestUser({ accountRole: 'super_admin', username: 'security-super-admin' }),
  }
})

afterEach(async () => {
  await prisma.ojPlatformConfig.deleteMany({
    where: { platform: { in: ['security-test', 'carits'] } },
  })
})

describe('sensitive route boundaries', () => {
  it('lets an authenticated regular account use non-admin OJ reads', async () => {
    const response = await request(app)
      .get('/api/oj-fetcher/not-a-platform/1000')
      .set('Cookie', `oi_session=${tokenFor('student')}`)

    expect(response.status).toBe(400)
    expect(response.body.error?.code).toBe('PLATFORM_NOT_SUPPORTED')
  })

  it('rejects anonymous and non-admin access to global OJ jobs', async () => {
    const anonymous = await request(app).get('/api/oj-fetcher/jobs')
    expect(anonymous.status).toBe(401)

    const student = await request(app)
      .get('/api/oj-fetcher/jobs')
      .set('Cookie', `oi_session=${tokenFor('student')}`)
    expect(student.status).toBe(403)

    const platformAdmin = await request(app)
      .get('/api/oj-fetcher/jobs?pageSize=1')
      .set('Cookie', `oi_session=${tokenFor('platform_admin')}`)
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
      .set('Cookie', `oi_session=${tokenFor('platform_admin')}`)
    expect(platformAdmin.status).toBe(403)

    const superAdmin = await request(app)
      .get('/api/oj-fetcher/platforms/carits/config')
      .set('Cookie', `oi_session=${tokenFor('super_admin')}`)
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
      .set('Cookie', `oi_session=${tokenFor('super_admin')}`)
    expect(unknown.status).toBe(400)

    const oversized = await request(app)
      .post('/api/oj-fetcher/jobs/batch')
      .set('Cookie', `oi_session=${tokenFor('platform_admin')}`)
      .send({ platform: 'carits', problemIds: Array.from({ length: 201 }, (_, index) => String(index + 1)) })
    expect(oversized.status).toBe(400)
  })

})
