import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createTestApp } from './helpers/testRequest'
import { prisma } from '../src/prisma'
import { getJwtSecret } from '../src/lib/jwtSecret'
import { platformOrganizationRouter } from '../src/routes/platform-organizations'

const app = createTestApp()
app.use('/api/platform/organizations', platformOrganizationRouter)

async function tokenFor(role: 'super_admin' | 'platform_admin') {
  const id = crypto.randomUUID()
  await prisma.user.create({ data: { id, username: `org-admin-${id.slice(0, 8)}`, passwordHash: await bcrypt.hash('test-password', 4), role, status: 'active' } })
  return jwt.sign({ userId: id, username: `org-admin-${id.slice(0, 8)}`, role, workspaceMode: 'work' }, getJwtSecret(), { expiresIn: '1h' })
}

describe('platform organization authorization', () => {
  it('keeps school lifecycle APIs super-admin only', async () => {
    const platformToken = await tokenFor('platform_admin')
    const superToken = await tokenFor('super_admin')
    const platformResponse = await request(app).get('/api/platform/organizations').set('Authorization', `Bearer ${platformToken}`)
    const superResponse = await request(app).get('/api/platform/organizations').set('Authorization', `Bearer ${superToken}`)
    expect(platformResponse.status).toBe(403)
    expect(superResponse.status).toBe(200)
  })

  it('creates verified schools and lets only super admins govern directory status', async () => {
    const superToken = await tokenFor('super_admin')
    const platformToken = await tokenFor('platform_admin')
    const suffix = crypto.randomUUID()
    const created = await request(app).post('/api/platform/organizations').set('Authorization', `Bearer ${superToken}`).send({
      name: `目录治理学校-${suffix}`, username: `directory-principal-${suffix}`, teacherName: '目录负责人', password: 'test-password',
    })
    expect(created.status).toBe(201)
    const organizationId = created.body.data.organizationId
    const list = await request(app).get('/api/platform/organizations?directoryStatus=verified').set('Authorization', `Bearer ${superToken}`)
    const school = list.body.data.data.find((item: any) => item.id === organizationId)
    expect(school.directoryStatus).toBe('verified')

    const forbidden = await request(app).patch(`/api/platform/organizations/${organizationId}/directory-status`).set('Authorization', `Bearer ${platformToken}`).send({ status: 'hidden', reason: '内部学校', expectedUpdatedAt: school.updatedAt })
    expect(forbidden.status).toBe(403)
    const hidden = await request(app).patch(`/api/platform/organizations/${organizationId}/directory-status`).set('Authorization', `Bearer ${superToken}`).send({ status: 'hidden', reason: '内部学校', expectedUpdatedAt: school.updatedAt })
    expect(hidden.status).toBe(200)
    expect(hidden.body.data.school.directoryStatus).toBe('hidden')
  })
})
