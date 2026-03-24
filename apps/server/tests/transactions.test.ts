import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers/testRequest'
import { createTestUser, createTestSchoolWithPrincipal } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('Transactions Module', () => {
  describe('School Creation Transaction', () => {
    it('should create school with principal in a single transaction', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.id
      })

      const schoolName = `测试学校_${Date.now()}`
      const res = await request(app)
        .post('/api/schools')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: schoolName,
          username: `principal_${Date.now()}`,
          password: 'password123',
          teacherName: '测试负责人',
          region: '湖南省/长沙市',
          schoolType: '初中+高中'
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.name).toBe(schoolName)

      // Verify all related records were created
      const school = await prisma.school.findUnique({
        where: { id: res.body.data.id },
        include: {
          teachers: true
        }
      })

      expect(school).not.toBeNull()
      expect(school!.teachers.length).toBeGreaterThan(0)
      expect(school!.currentPrincipalTeacherId).toBeDefined()
    })

    it('should not create school with duplicate name', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const { school: existingSchool } = await createTestSchoolWithPrincipal()

      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.id
      })

      const res = await request(app)
        .post('/api/schools')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: existingSchool.name, // Duplicate name
          username: `principal_${Date.now()}`,
          password: 'password123',
          teacherName: '测试负责人'
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toContain('已存在')
    })

    it('should not create school with duplicate username', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const { principal } = await createTestSchoolWithPrincipal()

      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.id
      })

      const res = await request(app)
        .post('/api/schools')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `新学校_${Date.now()}`,
          username: principal.username, // Duplicate username
          password: 'password123',
          teacherName: '测试负责人'
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(res.body.message).toContain('用户名已存在')
    })

    it('should not create school without required fields', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.id
      })

      const res = await request(app)
        .post('/api/schools')
        .set('Authorization', `Bearer ${token}`)
        .send({
          // Missing name
          username: `principal_${Date.now()}`,
          password: 'password123'
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })

    it('should require super_admin role', async () => {
      const { user: teacher } = await createTestUser({ role: 'teacher' })
      const token = generateTestToken({
        userId: teacher.id,
        role: 'teacher',
        username: teacher.username,
        teacherId: teacher.teacherId
      })

      const res = await request(app)
        .post('/api/schools')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `新学校_${Date.now()}`,
          username: `principal_${Date.now()}`,
          password: 'password123',
          teacherName: '测试负责人'
        })

      expect(res.status).toBe(403)
      expect(res.body.success).toBe(false)
    })
  })

  describe('Student Creation Transaction', () => {
    it('should create student with user in a single transaction', async () => {
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
        .post('/api/students')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: '测试学生',
          gender: '男',
          enrollmentYear: 2023,
          schoolId: school.id,
          headTeacherId: teacherId
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify both User and Student were created
      const student = await prisma.student.findUnique({
        where: { id: res.body.data.id },
        include: { user: true }
      })

      expect(student).not.toBeNull()
      expect(student!.user).toBeDefined()
      expect(student!.name).toBe('测试学生')
    })

    it('should not create student without school', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.id
      })

      const res = await request(app)
        .post('/api/students')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: '测试学生',
          // Missing schoolId
        })

      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
    })
  })

  describe('School Update Transaction', () => {
    it('should update school with principal transfer', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const { school, principal } = await createTestSchoolWithPrincipal()
      const { user: newPrincipal, teacherId: newPrincipalTeacherId } = await createTestUser({
        role: 'teacher',
        schoolId: school.id
      })

      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.id
      })

      const res = await request(app)
        .put(`/api/schools/${school.id}/principal`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          newPrincipalTeacherId
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify the transfer
      const updatedSchool = await prisma.school.findUnique({
        where: { id: school.id }
      })

      expect(updatedSchool!.currentPrincipalTeacherId).toBe(newPrincipalTeacherId)
    })
  })

  describe('User Update Transaction', () => {
    it('should update user status atomically', async () => {
      const { user: admin } = await createTestUser({ role: 'super_admin' })
      const { user: targetUser } = await createTestUser({ role: 'teacher' })

      const token = generateTestToken({
        userId: admin.id,
        role: 'super_admin',
        username: admin.username,
        adminId: admin.id
      })

      const res = await request(app)
        .put(`/api/users/${targetUser.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          status: 'disabled'
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify status was updated
      const updatedUser = await prisma.user.findUnique({
        where: { id: targetUser.id }
      })

      expect(updatedUser!.status).toBe('disabled')
    })
  })

  describe('Team Creation', () => {
    it('should create team with owner', async () => {
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
        .post('/api/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `测试团队_${Date.now()}`,
          schoolId: school.id,
          isPublic: true
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify team was created
      const team = await prisma.team.findUnique({
        where: { id: res.body.data.id }
      })

      expect(team).not.toBeNull()
    })
  })
})