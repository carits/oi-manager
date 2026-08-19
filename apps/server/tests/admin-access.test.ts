import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createTestApp } from './helpers/testRequest'
import { prisma } from '../src/prisma'
import { getJwtSecret } from '../src/lib/jwtSecret'
import { workspaceRouter } from '../src/routes/workspaces'

const app = createTestApp()
app.use('/api/workspaces', workspaceRouter)

async function createAdmin(role: 'super_admin' | 'platform_admin') {
  const id = crypto.randomUUID()
  const username = 'admin_' + role + '_' + id.slice(0, 8)
  const password = 'admin-test-password'
  const passwordHash = await bcrypt.hash(password, 4)
  await prisma.user.create({ data: { id, username, passwordHash, role, status: 'active' } })
  return { id, username, password }
}

describe('administrator entry without User.schoolId', () => {
  it('logs platform admin in with the global role and only exposes platform workspace', async () => {
    const admin = await createAdmin('platform_admin')
    const login = await request(app).post('/api/auth/login').send({ username: admin.username, password: admin.password })
    expect(login.status).toBe(200)
    expect(login.body.data.role).toBe('platform_admin')
    expect(login.body.data.next).toBe('/platform-admin')

    const agent = request.agent(app)
    const session = await agent.post('/api/auth/login').send({ username: admin.username, password: admin.password })
    expect(session.status).toBe(200)
    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.data.role).toBe('platform_admin')
    expect(me.body.data.schoolId).toBeUndefined()
    const workspaces = await agent.get('/api/workspaces')
    expect(workspaces.status).toBe(200)
    expect(workspaces.body.data.workspaces).toHaveLength(1)
    expect(workspaces.body.data.workspaces[0].type).toBe('platform')
  })

  it('repairs a legacy token role from the database', async () => {
    const admin = await createAdmin('platform_admin')
    const token = jwt.sign({ userId: admin.id, username: admin.username, role: 'teacher', workspaceMode: 'work' }, getJwtSecret(), { expiresIn: '1h' })
    const me = await request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + token)
    expect(me.status).toBe(200)
    expect(me.body.data.role).toBe('platform_admin')
  })
})
