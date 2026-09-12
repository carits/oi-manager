import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { createTestApp } from './helpers/testRequest'
import { generateTestToken } from './helpers/testToken'
import { createTestSchoolWithPrincipal, createTestUser } from './helpers/testUser'

const app = createTestApp()
type TestUser = Awaited<ReturnType<typeof createTestUser>>

function tokenFor(user: TestUser) {
  return generateTestToken({
    userId: user.user.id,
    username: user.user.username,
    role: user.user.role,
    schoolId: user.schoolId,
    teacherId: user.teacherId,
    studentId: user.studentId,
    adminId: user.adminId,
  })
}

describe('current list and detail regressions', () => {
  let school: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>['school']
  let principal: TestUser
  let teacher: TestUser
  let superAdmin: TestUser

  beforeEach(async () => {
    school = (await createTestSchoolWithPrincipal()).school
    principal = await createTestUser({ role: 'school_principal', schoolId: school.id })
    teacher = await createTestUser({ role: 'teacher', schoolId: school.id })
    superAdmin = await createTestUser({ role: 'super_admin' })
  })

  it('paginates students inside the active organization', async () => {
    for (let index = 0; index < 5; index += 1) await createTestUser({ role: 'student', schoolId: school.id })
    const response = await request(app)
      .get(`/api/organizations/${school.organizationId}/members/students?page=1&pageSize=3`)
      .set('Authorization', `Bearer ${tokenFor(principal)}`)
      .set('x-oi-organization-id', school.organizationId!)
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ page: 1, pageSize: 3, total: 5 })
    expect(response.body.data.data).toHaveLength(3)
  })

  it('never mixes student profiles from another organization', async () => {
    const local = await createTestUser({ role: 'student', schoolId: school.id })
    const otherSchool = (await createTestSchoolWithPrincipal('Other School')).school
    const remote = await createTestUser({ role: 'student', schoolId: otherSchool.id })
    const response = await request(app)
      .get(`/api/organizations/${school.organizationId}/members/students`)
      .set('Authorization', `Bearer ${tokenFor(principal)}`)
      .set('x-oi-organization-id', school.organizationId!)
    const userIds = response.body.data.data.map((item: { userId: string }) => item.userId)
    expect(userIds).toContain(local.user.id)
    expect(userIds).not.toContain(remote.user.id)
  })

  it('ordinary teachers only list students assigned to their organization membership', async () => {
    const assigned = await createTestUser({ role: 'student', schoolId: school.id, headTeacherId: teacher.user.id })
    const unassigned = await createTestUser({ role: 'student', schoolId: school.id })
    const response = await request(app)
      .get(`/api/organizations/${school.organizationId}/members/students`)
      .set('Authorization', `Bearer ${tokenFor(teacher)}`)
      .set('x-oi-organization-id', school.organizationId!)
    const userIds = response.body.data.data.map((item: { userId: string }) => item.userId)
    expect(userIds).toContain(assigned.user.id)
    expect(userIds).not.toContain(unassigned.user.id)
  })

  it('lists and reads organizations only through the super-admin platform route', async () => {
    const list = await request(app)
      .get('/api/platform/organizations?page=1&pageSize=10')
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`)
    expect(list.status).toBe(200)
    expect(list.body.data.data.map((item: { organizationId: string }) => item.organizationId)).toContain(school.organizationId)

    const detail = await request(app)
      .get(`/api/platform/organizations/${school.organizationId}`)
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data).toMatchObject({ organizationId: school.organizationId, schoolId: school.id })
  })

  it('returns the current organization teacher profile without exposing another organization', async () => {
    const local = await request(app)
      .get(`/api/users/${teacher.user.id}/profile?userType=teacher`)
      .set('Authorization', `Bearer ${tokenFor(principal)}`)
      .set('x-oi-organization-id', school.organizationId!)
    expect(local.status).toBe(200)
    expect(local.body.data).toMatchObject({ id: teacher.user.id, userType: 'teacher' })

    const otherSchool = (await createTestSchoolWithPrincipal('Profile Other School')).school
    const remoteTeacher = await createTestUser({ role: 'teacher', schoolId: otherSchool.id })
    const remote = await request(app)
      .get(`/api/users/${remoteTeacher.user.id}/profile?userType=teacher`)
      .set('Authorization', `Bearer ${tokenFor(principal)}`)
      .set('x-oi-organization-id', school.organizationId!)
    expect(remote.status).toBe(404)
  })

  it('paginates global accounts and applies valid global-role and status filters', async () => {
    await createTestUser({ role: 'platform_admin', status: 'active' })
    await createTestUser({ role: 'platform_admin', status: 'disabled' })
    const response = await request(app)
      .get('/api/users?page=1&pageSize=10&role=platform_admin&status=active')
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`)
    expect(response.status).toBe(200)
    expect(response.body.data.users.length).toBeGreaterThan(0)
    for (const user of response.body.data.users) {
      expect(user).toMatchObject({ role: 'platform_admin', status: 'active' })
    }
  })

  it('sorts organization rating rankings in descending order', async () => {
    await createTestUser({ role: 'student', schoolId: school.id, rating: 1500 })
    await createTestUser({ role: 'student', schoolId: school.id, rating: 1200 })
    await createTestUser({ role: 'student', schoolId: school.id, rating: 1800 })
    const response = await request(app)
      .get(`/api/rankings/organizations/${school.organizationId}/rating`)
      .set('Authorization', `Bearer ${tokenFor(teacher)}`)
      .set('x-oi-organization-id', school.organizationId!)
    expect(response.status).toBe(200)
    const ratings = response.body.data.map((item: { rating: number }) => item.rating)
    expect(ratings).toEqual([...ratings].sort((left, right) => right - left))
  })

  it('returns the minimal health response', async () => {
    const response = await request(app).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      schemaVersion: 1,
      status: 'ok',
      service: 'api',
      success: true,
      message: 'OK',
    })
    expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp)
  })

  it('keeps the legacy school list retired', async () => {
    const response = await request(app)
      .get('/api/schools')
      .set('Authorization', `Bearer ${tokenFor(superAdmin)}`)
    expect(response.status).toBe(410)
    expect(response.body.code).toBe('LEGACY_SCHOOL_API_RETIRED')
    expect(await prisma.organization.count()).toBeGreaterThan(0)
  })
})
