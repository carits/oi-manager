import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers/testRequest'
import { createTestUser } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'

const app = createTestApp()

describe('OJ Account Management', () => {
  describe('Permission checks', () => {
    it('should deny access without authentication', async () => {
      const res = await request(app).get('/api/oj-accounts')
      expect(res.status).toBe(401)
    })

    it('should deny access for teacher role', async () => {
      const { user } = await createTestUser({ organization: { role: 'teacher' } })
      const token = generateTestToken({ userId: user.id, username: user.username, accountRole: 'user' })
      const res = await request(app)
        .get('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
      expect(res.status).toBe(403)
    })

    it('should allow access for platform_admin', async () => {
      const { user } = await createTestUser({ accountRole: 'platform_admin' })
      const token = generateTestToken({ userId: user.id, username: user.username, accountRole: 'platform_admin' })
      const res = await request(app)
        .get('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should allow access for super_admin', async () => {
      const { user } = await createTestUser({ accountRole: 'super_admin' })
      const token = generateTestToken({ userId: user.id, username: user.username, accountRole: 'super_admin' })
      const res = await request(app)
        .get('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
      expect(res.status).toBe(200)
    })
  })

  describe('CRUD operations', () => {
    async function getAdminToken() {
      const { user } = await createTestUser({ accountRole: 'platform_admin' })
      return generateTestToken({ userId: user.id, username: user.username, accountRole: 'platform_admin' })
    }

    it('should add an account with cookie', async () => {
      const token = await getAdminToken()
      const res = await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({
          platform: 'hdu',
          username: 'testuser',
          cookie: 'PHPSESSID=abc123',
          loginMethod: 'cookie',
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.platform).toBe('hdu')
      expect(res.body.data.username).toBe('testuser')
      expect(res.body.data.hasPassword).toBe(false)
      expect(res.body.data.hasCookie).toBe(true)
      expect(res.body.data.status).toBe('unverified')
      // 不应返回密码
      expect(res.body.data.password).toBeUndefined()
    })

    it('should add an account with password', async () => {
      const token = await getAdminToken()
      const res = await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({
          platform: 'hdu',
          username: 'pwuser',
          password: 'mypassword123',
          loginMethod: 'password',
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.hasPassword).toBe(true)
      expect(res.body.data.hasCookie).toBe(false)
    })

    it('should reject duplicate platform+username', async () => {
      const token = await getAdminToken()
      // First add
      await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ platform: 'hdu', username: 'dup_user', cookie: 'cookie1' })

      // Second add - should fail
      const res = await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ platform: 'hdu', username: 'dup_user', cookie: 'cookie2' })

      expect(res.status).toBe(409)
    })

    it('should require platform and username', async () => {
      const token = await getAdminToken()
      const res = await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ cookie: 'some_cookie' })

      expect(res.status).toBe(400)
    })

    it('should require cookie or password', async () => {
      const token = await getAdminToken()
      const res = await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ platform: 'hdu', username: 'nocreds' })

      expect(res.status).toBe(400)
    })

    it('should list accounts', async () => {
      const token = await getAdminToken()
      await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ platform: 'hdu', username: 'list_user1', cookie: 'c1' })
      await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ platform: 'codeforces', username: 'list_user2', cookie: 'c2' })

      const res = await request(app)
        .get('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)

      expect(res.status).toBe(200)
      expect(res.body.data.length).toBeGreaterThanOrEqual(2)
    })

    it('should filter accounts by platform', async () => {
      const token = await getAdminToken()
      await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ platform: 'hdu', username: 'filter_hdu', cookie: 'c' })
      await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ platform: 'codeforces', username: 'filter_cf', cookie: 'c' })

      const res = await request(app)
        .get('/api/oj-accounts?platform=hdu')
        .set('Cookie', `oi_session=${token}`)

      expect(res.status).toBe(200)
      expect(res.body.data.every((a: any) => a.platform === 'hdu')).toBe(true)
    })

    it('should update account cookie', async () => {
      const token = await getAdminToken()
      const createRes = await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ platform: 'hdu', username: 'update_user', cookie: 'old_cookie' })

      const id = createRes.body.data.id

      const res = await request(app)
        .put(`/api/oj-accounts/${id}`)
        .set('Cookie', `oi_session=${token}`)
        .send({ cookie: 'new_cookie' })

      expect(res.status).toBe(200)
      expect(res.body.data.hasCookie).toBe(true)
      expect(res.body.data.status).toBe('unverified') // 重置为未验证
    })

    it('should delete an account', async () => {
      const token = await getAdminToken()
      const createRes = await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ platform: 'hdu', username: 'delete_user', cookie: 'c' })

      const id = createRes.body.data.id

      const res = await request(app)
        .delete(`/api/oj-accounts/${id}`)
        .set('Cookie', `oi_session=${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should return 404 for nonexistent account', async () => {
      const token = await getAdminToken()
      const res = await request(app)
        .delete('/api/oj-accounts/nonexistent-id')
        .set('Cookie', `oi_session=${token}`)

      expect(res.status).toBe(404)
    })
  })

  describe('Stats', () => {
    it('should return platform stats', async () => {
      const { user } = await createTestUser({ accountRole: 'platform_admin' })
      const token = generateTestToken({ userId: user.id, username: user.username, accountRole: 'platform_admin' })

      await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ platform: 'hdu', username: 'stats_user1', cookie: 'c1' })
      await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ platform: 'hdu', username: 'stats_user2', cookie: 'c2' })

      const res = await request(app)
        .get('/api/oj-accounts/stats')
        .set('Cookie', `oi_session=${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      const hduStats = res.body.data.find((s: any) => s.platform === 'hdu')
      expect(hduStats).toBeDefined()
      expect(hduStats.total).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Verify', () => {
    it('should mark account as error when no cookie', async () => {
      const { user } = await createTestUser({ accountRole: 'platform_admin' })
      const token = generateTestToken({ userId: user.id, username: user.username, accountRole: 'platform_admin' })

      // Create account with only password, no cookie
      const createRes = await request(app)
        .post('/api/oj-accounts')
        .set('Cookie', `oi_session=${token}`)
        .send({ platform: 'hdu', username: 'no_cookie_user', password: 'pass123' })

      const id = createRes.body.data.id

      const res = await request(app)
        .post(`/api/oj-accounts/${id}/verify`)
        .set('Cookie', `oi_session=${token}`)

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('error')
    })
  })
})
