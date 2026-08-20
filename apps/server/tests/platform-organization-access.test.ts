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
})
