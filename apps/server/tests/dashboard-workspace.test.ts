import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from './helpers/testRequest'
import { generateTestToken } from './helpers/testToken'
import { createTestSchoolWithPrincipal, createTestUser } from './helpers/testUser'
import { statsRouter } from '../src/routes/stats'
import { workspaceRouter } from '../src/routes/workspaces'

const app = createTestApp()
app.use('/api/stats', statsRouter)
app.use('/api/workspaces', workspaceRouter)
type TestUser = Awaited<ReturnType<typeof createTestUser>>

function tokenFor(user: TestUser, workspaceMode: 'work' | 'personal' = 'work') {
  return generateTestToken({ userId: user.user.id, username: user.user.username, workspaceMode, accountRole: user.user.accountRole })
}

describe('dashboard and workspace application routes', () => {
  let school: Awaited<ReturnType<typeof createTestSchoolWithPrincipal>>['school']
  let student: TestUser
  let superAdmin: TestUser

  beforeEach(async () => {
    school = (await createTestSchoolWithPrincipal()).school
    student = await createTestUser({ organization: { role: 'student', organizationId: school.organizationId! } })
    superAdmin = await createTestUser({ accountRole: 'super_admin' })
  })

  it('keeps global statistics admin-only and returns current aggregate fields', async () => {
    const denied = await request(app).get('/api/stats/global').set('Cookie', `oi_session=${tokenFor(student)}`)
    expect(denied.status).toBe(403)

    const response = await request(app).get('/api/stats/global').set('Cookie', `oi_session=${tokenFor(superAdmin)}`)
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual(expect.objectContaining({
      totalSchools: expect.any(Number),
      totalTeachers: expect.any(Number),
      totalStudents: expect.any(Number),
      activeUsers: expect.any(Number),
      disabledUsers: expect.any(Number),
      recentRegistrations: expect.any(Number),
    }))
  })

  it('lists the active campus and personal workspace without crossing organizations', async () => {
    const response = await request(app)
      .get('/api/workspaces')
      .set('Cookie', `oi_session=${tokenFor(student)}`)
      .set('x-oi-organization-id', school.organizationId!)
    expect(response.status).toBe(200)
    expect(response.body.data.workspaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'organization', organizationId: school.organizationId, memberRole: 'student' }),
      expect.objectContaining({ type: 'personal' }),
    ]))
  })

  it('serves campus contest lists and a personal overview through their explicit contexts', async () => {
    const contests = await request(app)
      .get('/api/me/contests')
      .set('Cookie', `oi_session=${tokenFor(student)}`)
      .set('x-oi-organization-id', school.organizationId!)
    expect(contests.status).toBe(200)
    expect(contests.body.data).toEqual(expect.any(Array))

    const overview = await request(app)
      .get('/api/me/overview')
      .set('Cookie', `oi_session=${tokenFor(student, 'personal')}`)
    expect(overview.status).toBe(200)
    expect(overview.body.data.profile).toMatchObject({ username: student.user.username, rating: 1200 })
    expect(overview.body.data).toEqual(expect.objectContaining({
      invitations: expect.any(Array),
      contests: expect.any(Array),
      submissions: expect.any(Array),
    }))
  })
})
