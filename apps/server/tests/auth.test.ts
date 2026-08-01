import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers/testRequest'
import { createTestUser, createTestSchoolWithPrincipal } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('Authentication Module', () => {
  describe('POST /api/auth/login', () => {
    it('should login successfully with correct credentials', async () => {
      // 创建测试用户
      const { user, password } = await createTestUser({ role: 'student' })

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: user.username,
          password,
          role: 'student'
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.token).toBeDefined()
      expect(res.body.data.userId).toBe(user.id)
      expect(res.body.data.role).toBe('student')
      expect(res.headers['set-cookie']?.[0]).toContain('oi_session=')
      expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly')
      expect(res.headers['set-cookie']?.[0]).toContain('SameSite=Lax')
    })

    it('should fail with wrong password', async () => {
      const { user } = await createTestUser({ role: 'student' })

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: user.username,
          password: 'wrongpassword',
          role: 'student'
        })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toBe('用户名或密码错误')
    })

    it('should fail with non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'nonexistentuser',
          password: 'anypassword',
          role: 'student'
        })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toBe('用户名或密码错误')
    })

    it('should fail with disabled account', async () => {
      const { user, password } = await createTestUser({
        role: 'student',
        status: 'disabled'
      })

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: user.username,
          password,
          role: 'student'
        })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toContain('禁用')
    })

    it('should fail when teacher tries to login as student', async () => {
      const { user, password } = await createTestUser({ role: 'teacher' })

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: user.username,
          password,
          role: 'student'
        })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toContain('教师端')
    })

    it('should fail when student tries to login as admin', async () => {
      const { user, password } = await createTestUser({ role: 'student' })

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: user.username,
          password,
          role: 'admin'
        })

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toContain('学生端')
    })

    it('should allow school_principal to login as teacher', async () => {
      const { user, password } = await createTestUser({ role: 'school_principal' })

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          username: user.username,
          password,
          role: 'teacher'
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.role).toBe('school_principal')
    })

    it('should create login log on successful login', async () => {
      const { user, password } = await createTestUser({ role: 'student' })

      await request(app)
        .post('/api/auth/login')
        .send({
          username: user.username,
          password,
          role: 'student'
        })

      const log = await prisma.loginLog.findFirst({
        where: { userId: user.id, result: 'success' }
      })

      expect(log).not.toBeNull()
    })

    it('should create login log on failed login', async () => {
      const { user } = await createTestUser({ role: 'student' })

      await request(app)
        .post('/api/auth/login')
        .send({
          username: user.username,
          password: 'wrongpassword',
          role: 'student'
        })

      const log = await prisma.loginLog.findFirst({
        where: { username: user.username, result: 'failed_wrong_password' }
      })

      expect(log).not.toBeNull()
    })
  })

  describe('POST /api/auth/register', () => {
    it('should register a new student successfully', async () => {
      const { school } = await createTestSchoolWithPrincipal('注册测试学校')
      const uniqueUsername = `reg_${Math.random().toString(36).slice(2, 8)}`
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: uniqueUsername,
          password: 'password123',
          name: 'New Student',
          schoolId: school.id
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.userId).toBeDefined()
    })

    it('should reject registration with non-student role', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'newteacher',
          password: 'password123',
          role: 'teacher',
          name: 'New Teacher'
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toContain('学生')
    })

    it('should reject duplicate username', async () => {
      const { user } = await createTestUser({ role: 'student' })

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: user.username,
          password: 'password123',
          name: 'Another Student'
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toContain('已存在')
    })

    it('should reject invalid username', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'ab', // Too short
          password: 'password123',
          name: 'Test'
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })

    it('should reject invalid password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          username: 'validusername',
          password: '123', // Too short
          name: 'Test'
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })

  describe('GET /api/auth/me', () => {
    it('should return user info with valid token', async () => {
      const { user, studentId } = await createTestUser({ role: 'student' })
      const token = generateTestToken({
        userId: user.id,
        role: 'student',
        username: user.username,
        studentId
      })

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.userId).toBe(user.id)
      expect(res.body.data.username).toBe(user.username)
      expect(res.body.data.role).toBe('student')
    })

    it('accepts the HttpOnly session cookie without a bearer token', async () => {
      const { user, password } = await createTestUser({ role: 'student' })
      const agent = request.agent(app)

      const login = await agent
        .post('/api/auth/login')
        .send({ username: user.username, password, role: 'student' })

      expect(login.status).toBe(200)

      const me = await agent.get('/api/auth/me')
      expect(me.status).toBe(200)
      expect(me.body.data.userId).toBe(user.id)
    })

    it('rejects a cross-origin mutation made with a session cookie', async () => {
      const { user, password } = await createTestUser({ role: 'student' })
      const agent = request.agent(app)

      await agent
        .post('/api/auth/login')
        .send({ username: user.username, password, role: 'student' })

      const logout = await agent
        .post('/api/auth/logout')
        .set('Origin', 'https://untrusted.example')

      expect(logout.status).toBe(403)
      expect(logout.body.code).toBe('CSRF_ORIGIN_REJECTED')
    })

    it('still checks the origin when cookie and bearer credentials are both present', async () => {
      const { user, password } = await createTestUser({ role: 'student' })
      const login = await request(app)
        .post('/api/auth/login')
        .send({ username: user.username, password, role: 'student' })
      const sessionCookie = login.headers['set-cookie']?.[0]?.split(';')[0]

      const logout = await request(app)
        .post('/api/auth/logout')
        .set('Origin', 'https://untrusted.example')
        .set('Cookie', sessionCookie || '')
        .set('Authorization', `Bearer ${login.body.data.token}`)

      expect(logout.status).toBe(403)
      expect(logout.body.code).toBe('CSRF_ORIGIN_REJECTED')
    })

    it('allows development preview ports on the same host', async () => {
      const { user, password } = await createTestUser({ role: 'student' })
      const login = await request(app)
        .post('/api/auth/login')
        .send({ username: user.username, password, role: 'student' })
      const sessionCookie = login.headers['set-cookie']?.[0]?.split(';')[0]

      const logout = await request(app)
        .post('/api/auth/logout')
        .set('Host', '47.99.222.76:3002')
        .set('Origin', 'http://47.99.222.76:3000')
        .set('Cookie', sessionCookie || '')

      expect(logout.status).toBe(200)
    })

    it('clears the session cookie on logout', async () => {
      const { user, password } = await createTestUser({ role: 'student' })
      const agent = request.agent(app)

      await agent
        .post('/api/auth/login')
        .send({ username: user.username, password, role: 'student' })

      const logout = await agent.post('/api/auth/logout')
      expect(logout.status).toBe(200)
      expect(logout.headers['set-cookie']?.[0]).toContain('oi_session=')
      expect(logout.headers['set-cookie']?.[0]).toContain('Expires=Thu, 01 Jan 1970')
    })

    it('should return 401 without token', async () => {
      const res = await request(app).get('/api/auth/me')

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
    })

    it('should return 401 with invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalidtoken')

      expect(res.status).toBe(401)
      expect(res.body.success).toBe(false)
    })

    it('should return teacher info with schoolId', async () => {
      const { school, principal } = await createTestSchoolWithPrincipal()
      const token = generateTestToken({
        userId: principal.userId,
        role: 'school_principal',
        username: principal.username,
        teacherId: principal.teacherId,
        schoolId: school.id
      })

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.data.schoolId).toBe(school.id)
    })
  })

  describe('POST /api/auth/switch-workspace', () => {
    it.each([
      ['super_admin', 'admin'],
      ['platform_admin', 'admin'],
      ['school_principal', 'teacher'],
      ['teacher', 'teacher'],
      ['student', 'student']
    ] as const)('keeps the %s role while switching workspaces', async (role, loginRole) => {
      const { user, password } = await createTestUser({ role })
      const agent = request.agent(app)

      const login = await agent
        .post('/api/auth/login')
        .send({ username: user.username, password, role: loginRole, workspaceMode: 'work' })

      expect(login.status).toBe(200)
      expect(login.body.data.role).toBe(role)
      expect(login.body.data.workspaceMode).toBe('work')

      const switched = await agent
        .post('/api/auth/switch-workspace')
        .send({ workspaceMode: 'personal' })

      expect(switched.status).toBe(200)
      expect(switched.body.data.workspaceMode).toBe('personal')
      expect(switched.headers['set-cookie']?.[0]).toContain('oi_session=')

      const me = await agent.get('/api/auth/me')
      expect(me.status).toBe(200)
      expect(me.body.data.role).toBe(role)
      expect(me.body.data.workspaceMode).toBe('personal')

      const profile = await prisma.personalProfile.findUnique({ where: { userId: user.id } })
      expect(profile?.rating).toBe(1200)

      const restored = await agent
        .post('/api/auth/switch-workspace')
        .send({ workspaceMode: 'work' })
      expect(restored.status).toBe(200)
      expect(restored.body.data.workspaceMode).toBe('work')
    })

    it('rejects an invalid workspace without changing the session', async () => {
      const { user, password } = await createTestUser({ role: 'teacher' })
      const agent = request.agent(app)

      await agent
        .post('/api/auth/login')
        .send({ username: user.username, password, role: 'teacher', workspaceMode: 'work' })

      const invalid = await agent
        .post('/api/auth/switch-workspace')
        .send({ workspaceMode: 'campus' })
      expect(invalid.status).toBe(400)

      const me = await agent.get('/api/auth/me')
      expect(me.body.data.workspaceMode).toBe('work')
    })
  })

  describe('PUT /api/auth/password', () => {
    it('should change password successfully', async () => {
      const { user, password } = await createTestUser({ role: 'student' })
      const token = generateTestToken({
        userId: user.id,
        role: 'student',
        username: user.username,
        studentId: user.studentId
      })

      const res = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: password,
          newPassword: 'newpassword123'
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should fail with wrong current password', async () => {
      const { user } = await createTestUser({ role: 'student' })
      const token = generateTestToken({
        userId: user.id,
        role: 'student',
        username: user.username,
        studentId: user.studentId
      })

      const res = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'wrongpassword',
          newPassword: 'newpassword123'
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toContain('当前密码错误')
    })

    it('should fail when new password is same as current', async () => {
      const { user, password } = await createTestUser({ role: 'student' })
      const token = generateTestToken({
        userId: user.id,
        role: 'student',
        username: user.username,
        studentId: user.studentId
      })

      const res = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: password,
          newPassword: password
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toContain('不能与当前密码相同')
    })

    it('should fail with invalid new password format', async () => {
      const { user, password } = await createTestUser({ role: 'student' })
      const token = generateTestToken({
        userId: user.id,
        role: 'student',
        username: user.username,
        studentId: user.studentId
      })

      const res = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: password,
          newPassword: '123' // Too short
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })

    it('should require authentication', async () => {
      const res = await request(app)
        .put('/api/auth/password')
        .send({
          currentPassword: 'oldpassword',
          newPassword: 'newpassword123'
        })

      expect(res.status).toBe(401)
    })
  })

  describe('PUT /api/auth/profile', () => {
    it('should update profile successfully', async () => {
      const { user } = await createTestUser({ role: 'student' })
      const token = generateTestToken({
        userId: user.id,
        role: 'student',
        username: user.username,
        studentId: user.studentId
      })

      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Updated Name',
          bio: 'Updated bio'
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('should require authentication', async () => {
      const res = await request(app)
        .put('/api/auth/profile')
        .send({
          name: 'New Name'
        })

      expect(res.status).toBe(401)
    })
  })
})
