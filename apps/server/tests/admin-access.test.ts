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
    expect(login.body.data.accountRole).toBe('platform_admin')
    expect(login.body.data.next).toBe('/platform-admin')

    const agent = request.agent(app)
    const session = await agent.post('/api/auth/login').send({ username: admin.username, password: admin.password })
    expect(session.status).toBe(200)
    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.data.accountRole).toBe('platform_admin')
    expect(me.body.data.schoolId).toBeUndefined()
    const workspaces = await agent.get('/api/workspaces')
    expect(workspaces.status).toBe(200)
    expect(workspaces.body.data.workspaces).toHaveLength(1)
    expect(workspaces.body.data.workspaces[0].type).toBe('platform')
  })

  it('rejects a token without the canonical account role claim', async () => {
    const admin = await createAdmin('platform_admin')
    const token = jwt.sign({ userId: admin.id, username: admin.username, role: 'teacher', workspaceMode: 'work' }, getJwtSecret(), { expiresIn: '1h' })
    const me = await request(app).get('/api/auth/me').set('Cookie', 'oi_session=' + token)
    expect(me.status).toBe(401)
  })

  it.each(['platform_admin', 'super_admin'] as const)(
    'lets %s list every submission, including records hidden from the global user feed',
    async role => {
      const admin = await createAdmin(role)
      const firstUserId = crypto.randomUUID()
      const secondUserId = crypto.randomUUID()
      await prisma.user.createMany({
        data: [
          { id: firstUserId, username: 'submitter_' + firstUserId.slice(0, 8), passwordHash: 'test', role: 'user', status: 'active' },
          { id: secondUserId, username: 'submitter_' + secondUserId.slice(0, 8), passwordHash: 'test', role: 'user', status: 'active' },
        ],
      })
      const visibleSubmission = await prisma.submission.create({
        data: {
          userId: firstUserId,
          oj: 'carits',
          problemId: 'ADMIN-VISIBLE',
          language: 'cpp',
          code: 'int main(){}',
          codeLength: 12,
          submitMethod: 'standard',
          result: 'accepted',
          submitScope: 'problem',
          workspaceScope: 'personal',
          isGlobalVisible: true,
        },
      })
      const hiddenSubmission = await prisma.submission.create({
        data: {
          userId: secondUserId,
          oj: 'carits',
          problemId: 'ADMIN-HIDDEN',
          language: 'cpp',
          code: 'int main(){}',
          codeLength: 12,
          submitMethod: 'standard',
          result: 'judging',
          submitScope: 'problem',
          workspaceScope: 'campus',
          isGlobalVisible: false,
        },
      })
      const token = jwt.sign(
        { userId: admin.id, username: admin.username, accountRole: role, sessionVersion: 1, workspaceMode: 'work' },
        getJwtSecret(),
        { expiresIn: '1h' },
      )

      const response = await request(app)
        .get('/api/submissions?pageSize=100')
        .set('Cookie', 'oi_session=' + token)

      expect(response.status).toBe(200)
      expect(response.body.data.scope).toBe('all')
      expect(response.body.data.submissions.map((submission: { id: number }) => submission.id))
        .toEqual(expect.arrayContaining([visibleSubmission.id, hiddenSubmission.id]))
    },
  )
})
