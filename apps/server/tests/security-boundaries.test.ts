import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { ojFetcherRouter } from '../src/routes/oj-fetcher'
import { migrationRouter } from '../src/routes/migration'
import { prisma } from '../src/prisma'
import { generateTestToken } from './helpers/testToken'

const app = express()
app.use(express.json())
app.use('/api/oj-fetcher', ojFetcherRouter)
app.use('/api/admin/migration', migrationRouter)

const tokenFor = (role: 'student' | 'platform_admin' | 'super_admin') =>
  generateTestToken({
    userId: `security-${role}`,
    username: `security-${role}`,
    role,
  })

afterEach(async () => {
  process.env.ENABLE_MAINTENANCE_API = 'false'
  await prisma.ojPlatformConfig.deleteMany({
    where: { platform: 'security-test' },
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
        platform: 'security-test',
        cookies: JSON.stringify({
          session: 'must-not-leak',
          token: 'also-secret',
        }),
      },
    })

    const platformAdmin = await request(app)
      .get('/api/oj-fetcher/platforms/security-test/config')
      .set('Authorization', `Bearer ${tokenFor('platform_admin')}`)
    expect(platformAdmin.status).toBe(403)

    const superAdmin = await request(app)
      .get('/api/oj-fetcher/platforms/security-test/config')
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
