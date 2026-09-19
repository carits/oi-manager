import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { createAuthenticatedRequest, createTestApp } from './helpers/testRequest'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestUser } from './helpers/testUser'

const app = createTestApp()

describe('managed user runtime contract', () => {
  it('lists and reads users without exposing authentication state', async () => {
    const admin = await createTestUser({ accountRole: 'super_admin' })
    const target = await prisma.user.create({
      data: {
        id: crypto.randomUUID(), username: `managed_${crypto.randomUUID().slice(0, 8)}`,
        passwordHash: await bcrypt.hash('managed-user-password', 4), role: 'user', status: 'active',
      },
    })
    const client = createAuthenticatedRequest(app, generateTokenFromUser(admin.user))

    const list = await client.get(`/api/users?keyword=${encodeURIComponent(target.username)}`)
    expect(list.status).toBe(200)
    expect(list.body.data.users).toHaveLength(1)
    expect(list.body.data.users[0]).toMatchObject({ id: target.id, username: target.username })
    expect(list.body.data.users[0]).not.toHaveProperty('passwordHash')
    expect(list.body.data.users[0]).not.toHaveProperty('sessionVersion')

    const detail = await client.get(`/api/users/${target.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data).toMatchObject({ id: target.id, username: target.username })
    expect(detail.body.data).not.toHaveProperty('passwordHash')
    expect(detail.body.data).not.toHaveProperty('OrganizationMembership')
  })

  it('validates mutations and persists status and password changes', async () => {
    const admin = await createTestUser({ accountRole: 'super_admin' })
    const target = await createTestUser({ organization: { role: 'student' } })
    const client = createAuthenticatedRequest(app, generateTokenFromUser(admin.user))

    const invalid = await client.put(`/api/users/${target.user.id}/status`).send({ status: 'archived' })
    expect(invalid.status).toBe(422)
    expect(invalid.body.code).toBe('API_CONTRACT_REQUEST_INVALID')

    const status = await client.put(`/api/users/${target.user.id}/status`).send({ status: 'disabled', reason: 'contract test' })
    expect(status.status).toBe(200)
    expect(status.body.data).toEqual({ userId: target.user.id, status: 'disabled' })

    const newPassword = 'new-secure-password'
    const reset = await client.post(`/api/users/${target.user.id}/reset-password`).send({ newPassword })
    expect(reset.status).toBe(200)
    expect(reset.body.data).toEqual({ reset: true })
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } })
    expect(await bcrypt.compare(newPassword, stored.passwordHash)).toBe(true)
  })

  it('creates a platform administrator only from validated input', async () => {
    const admin = await createTestUser({ accountRole: 'super_admin' })
    const client = createAuthenticatedRequest(app, generateTokenFromUser(admin.user))
    const username = `platform_${crypto.randomUUID().slice(0, 8)}`

    const response = await client.post('/api/users/platform-admin').send({
      username, password: 'platform-admin-password', name: '平台管理员', email: 'platform@example.com',
    })
    expect(response.status).toBe(201)
    expect(response.body.data).toMatchObject({ username, role: 'platform_admin' })
    expect(response.body.data).not.toHaveProperty('passwordHash')
  })
})
