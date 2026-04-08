import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers/testRequest'
import { createTestUser, createTestSchoolWithPrincipal } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('Regression Tests - Basic List and Detail', () => {
  describe('Student List', () => {
    it('should list students with pagination', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacher, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      // Create multiple students
      for (let i = 0; i < 5; i++) {
        await createTestUser({ role: 'student', schoolId: school.id })
      }

      const token = generateTestToken({
        userId: teacher.id,
        role: 'teacher',
        username: teacher.username,
        teacherId,
        schoolId: school.id
      })

      const res = await request(app)
        .get('/api/students?page=1&pageSize=3')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.page).toBe(1)
      expect(res.body.data.pageSize).toBe(3)
      expect(res.body.data.list.length).toBeLessThanOrEqual(3)
    })

    it('should filter students by school', async () => {
      const { school } = await createTestSchoolWithPrincipal('School A')
      const { school: schoolB } = await createTestSchoolWithPrincipal('School B')

      await createTestUser({ role: 'student', schoolId: school.id })
      await createTestUser({ role: 'student', schoolId: schoolB.id })

      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.adminId
      })

      const res = await request(app)
        .get(`/api/students?schoolId=${school.id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      // All returned students should belong to school A
      res.body.data.list.forEach((student: any) => {
        expect(student.schoolId).toBe(school.id)
      })
    })

    it('should filter students by headTeacherId', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacher1, teacherId: teacherId1 } = await createTestUser({ role: 'teacher', schoolId: school.id })
      const { teacherId: teacherId2 } = await createTestUser({ role: 'teacher', schoolId: school.id })

      // Create students with different head teachers
      await createTestUser({ role: 'student', schoolId: school.id, headTeacherId: teacherId1 })
      await createTestUser({ role: 'student', schoolId: school.id, headTeacherId: teacherId2 })

      const token = generateTestToken({
        userId: teacher1.id,
        role: 'teacher',
        username: teacher1.username,
        teacherId: teacherId1,
        schoolId: school.id
      })

      const res = await request(app)
        .get(`/api/students?headTeacherId=${teacherId1}`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  describe('School List', () => {
    it('should list schools', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      await createTestSchoolWithPrincipal('School 1')
      await createTestSchoolWithPrincipal('School 2')

      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.adminId
      })

      const res = await request(app)
        .get('/api/schools')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.list.length).toBeGreaterThanOrEqual(2)
    })

    it('should get school detail', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const { school } = await createTestSchoolWithPrincipal()

      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.adminId
      })

      const res = await request(app)
        .get(`/api/schools/${school.id}`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.id).toBe(school.id)
    })
  })

  describe('Teacher List', () => {
    it('should get teacher info via /me', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacher, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      const token = generateTestToken({
        userId: teacher.id,
        role: 'teacher',
        username: teacher.username,
        teacherId,
        schoolId: school.id
      })

      const res = await request(app)
        .get('/api/teachers/me')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  describe('User List', () => {
    it('should list users with pagination', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })

      // Create multiple users
      for (let i = 0; i < 5; i++) {
        await createTestUser({ role: 'student' })
      }

      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.adminId
      })

      const res = await request(app)
        .get('/api/users?page=1&pageSize=3')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.page).toBe(1)
      expect(res.body.data.pageSize).toBe(3)
    })

    it('should filter users by role', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      await createTestUser({ role: 'teacher' })
      await createTestUser({ role: 'student' })

      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.adminId
      })

      const res = await request(app)
        .get('/api/users?role=teacher')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      res.body.data.users.forEach((user: any) => {
        expect(user.role).toBe('teacher')
      })
    })

    it('should filter users by status', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      await createTestUser({ role: 'student', status: 'active' })
      await createTestUser({ role: 'student', status: 'disabled' })

      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.adminId
      })

      const res = await request(app)
        .get('/api/users?status=active')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      res.body.data.users.forEach((user: any) => {
        expect(user.status).toBe('active')
      })
    })
  })

  describe('Student Rankings', () => {
    it('should return student rankings sorted by rating', async () => {
      const { school } = await createTestSchoolWithPrincipal()
      const { user: teacher, teacherId } = await createTestUser({ role: 'teacher', schoolId: school.id })

      // Create students with different ratings
      await createTestUser({ role: 'student', schoolId: school.id, rating: 1500 })
      await createTestUser({ role: 'student', schoolId: school.id, rating: 1200 })
      await createTestUser({ role: 'student', schoolId: school.id, rating: 1800 })

      const token = generateTestToken({
        userId: teacher.id,
        role: 'teacher',
        username: teacher.username,
        teacherId,
        schoolId: school.id
      })

      const res = await request(app)
        .get('/api/students/rankings')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.rankings.length).toBeGreaterThan(0)

      // Verify descending order
      const ratings = res.body.data.rankings.map((s: any) => s.rating)
      for (let i = 1; i < ratings.length; i++) {
        expect(ratings[i - 1]).toBeGreaterThanOrEqual(ratings[i])
      }
    })
  })

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const res = await request(app).get('/api/health')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})