import { beforeEach, describe, expect, it } from 'vitest'
import { createAuthenticatedRequest, createTestApp } from './helpers/testRequest'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestUser } from './helpers/testUser'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('public user profile contract', () => {
  let viewer: Awaited<ReturnType<typeof createTestUser>>
  let student: Awaited<ReturnType<typeof createTestUser>>
  let organizationId: string

  beforeEach(async () => {
    viewer = await createTestUser({ role: 'teacher' })
    student = await createTestUser({ role: 'student', schoolId: viewer.schoolId })
    organizationId = (await prisma.school.findUniqueOrThrow({ where: { id: viewer.schoolId } })).organizationId!
  })

  it('returns only account profile data in personal context', async () => {
    const response = await createAuthenticatedRequest(app, generateTokenFromUser(viewer.user))
      .get(`/api/users/${student.user.id}/profile?userType=student`)

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      id: student.user.id,
      username: student.user.username,
      userType: 'user',
    })
    expect(response.body.data).not.toHaveProperty('school')
  })

  it('returns the requested organization profile in explicit organization context', async () => {
    const response = await createAuthenticatedRequest(app, generateTokenFromUser(viewer.user), { organizationId })
      .get(`/api/users/${student.user.id}/profile?userType=student`)

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      id: student.user.id,
      profileId: student.studentProfileId,
      username: student.user.username,
      userType: 'student',
      school: { id: organizationId },
    })
  })

  it('rejects unsupported profile types at the shared contract boundary', async () => {
    const response = await createAuthenticatedRequest(app, generateTokenFromUser(viewer.user), { organizationId })
      .get(`/api/users/${student.user.id}/profile?userType=principal`)

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('API_CONTRACT_REQUEST_INVALID')
  })
})
