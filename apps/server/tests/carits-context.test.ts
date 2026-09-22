import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createAuthenticatedRequest, createTestApp } from './helpers/testRequest'
import { createTestSchoolWithPrincipal, createTestUser } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'
import { prisma } from '../src/prisma'

const app = createTestApp()

describe('Carits organization context isolation', () => {
  it('requires the active organization to match the requested organization wallet', async () => {
    const schoolA = (await createTestSchoolWithPrincipal('Carits A')).school
    const schoolB = (await createTestSchoolWithPrincipal('Carits B')).school
    const manager = await createTestUser({
      organization: { role: 'school_principal', organizationId: schoolA.organizationId! },
    })

    const membershipId = crypto.randomUUID()
    await prisma.organizationMembership.create({
      data: {
        id: membershipId,
        organizationId: schoolB.organizationId!,
        userId: manager.user.id,
        memberRole: 'school_principal',
        relationType: 'employee',
        status: 'active',
        joinedAt: new Date(),
        RoleAssignments: {
          create: { id: crypto.randomUUID(), roleKey: 'school_principal', source: 'test_fixture' },
        },
      },
    })
    await prisma.organizationTeacherProfile.create({
      data: { id: crypto.randomUUID(), membershipId, name: '跨校财务管理员', status: 'active' },
    })

    const token = generateTestToken({
      userId: manager.user.id,
      username: manager.user.username,
      accountRole: manager.user.accountRole,
    })

    const wrongContext = await createAuthenticatedRequest(app, token, { organizationId: schoolA.organizationId! })
      .get(`/api/carits/organizations/${schoolB.organizationId}`)
    expect(wrongContext.status).toBe(403)

    const wrongTransactions = await createAuthenticatedRequest(app, token, { organizationId: schoolA.organizationId! })
      .get(`/api/carits/organizations/${schoolB.organizationId}/transactions`)
    expect(wrongTransactions.status).toBe(403)

    const correctContext = await createAuthenticatedRequest(app, token, { organizationId: schoolB.organizationId! })
      .get(`/api/carits/organizations/${schoolB.organizationId}`)
    expect(correctContext.status).toBe(200)
  })
})
