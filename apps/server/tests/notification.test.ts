import crypto from 'crypto'
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { authenticate } from '../src/middleware/auth'
import { notificationRouter } from '../src/modules/notification/notification.routes'
import { prisma } from '../src/prisma'
import { createAuthenticatedRequest } from './helpers/testRequest'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestSchoolWithPrincipal, createTestTeam, createTestUser } from './helpers/testUser'

const app = express()
app.use(express.json())
app.use('/api/notifications', authenticate, notificationRouter)

describe('notification application service', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let token: string
  let organizationId: string

  beforeEach(async () => {
    const school = await createTestSchoolWithPrincipal()
    user = await createTestUser({ role: 'student', schoolId: school.school.id })
    organizationId = (await prisma.organization.findFirstOrThrow({ where: { School: { id: school.school.id } } })).id
    token = generateTokenFromUser({
      id: user.user.id,
      role: 'student',
      username: user.user.username,
      studentId: user.studentId,
      schoolId: school.school.id,
    })
  })

  async function createNotification(sourceId = crypto.randomUUID()) {
    return prisma.userNotification.create({
      data: {
        id: crypto.randomUUID(), userId: user.user.id, scope: 'campus', type: 'info',
        title: '测试通知', body: '通知正文', sourceType: 'test', sourceId,
      },
    })
  }

  it('lists and marks a notification as read within the current user and scope', async () => {
    const notification = await createNotification()
    const listed = await createAuthenticatedRequest(app, token, { organizationId }).get('/api/notifications')
    expect(listed.status).toBe(200)
    expect(listed.body.data.unreadCount).toBe(1)
    expect(listed.body.data.notifications[0].id).toBe(notification.id)

    const marked = await request(app)
      .patch(`/api/notifications/${notification.id}/read`)
      .set('Cookie', `oi_session=${token}`)
      .set('X-OI-Organization-ID', organizationId)
    expect(marked.status).toBe(200)
    expect(marked.body.data).toMatchObject({ changed: true, unreadCount: 0 })
    const repeated = await request(app).patch(`/api/notifications/${notification.id}/read`)
      .set('Cookie', `oi_session=${token}`)
      .set('X-OI-Organization-ID', organizationId)
    expect(repeated.status).toBe(200)
    expect(repeated.body.data).toMatchObject({ changed: false, unreadCount: 0 })
    const row = await prisma.userNotification.findUnique({ where: { id: notification.id } })
    expect(row?.readAt).not.toBeNull()
  })

  it('returns an authoritative pagination cursor beyond the first 50 notifications', async () => {
    await prisma.userNotification.createMany({ data: Array.from({ length: 51 }, (_, index) => ({
      id: crypto.randomUUID(), userId: user.user.id, scope: 'campus', type: 'info',
      title: `通知 ${index}`, body: '通知正文', sourceType: 'pagination', sourceId: crypto.randomUUID(),
    })) })
    const first = await createAuthenticatedRequest(app, token, { organizationId }).get('/api/notifications?page=1&pageSize=50')
    const second = await createAuthenticatedRequest(app, token, { organizationId }).get('/api/notifications?page=2&pageSize=50')
    expect(first.body.data.notifications).toHaveLength(50)
    expect(first.body.data.hasMore).toBe(true)
    expect(second.body.data.notifications).toHaveLength(1)
    expect(second.body.data.hasMore).toBe(false)
  })

  it('finds actionable notifications after more than one raw notification page', async () => {
    const teacher = await createTestUser({ role: 'teacher', schoolId: user.schoolId })
    const team = await createTestTeam({ schoolId: user.schoolId, scope: 'campus', ownerId: teacher.user.id, ownerType: 'teacher' })
    const invitation = await prisma.teamMember.create({ data: {
      id: crypto.randomUUID(), teamId: team.id, userId: user.user.id, userType: 'student',
      role: 'member', status: 'pending', invitedBy: teacher.user.id, joinedAt: new Date(Date.now() - 60_000),
    } })
    await prisma.userNotification.create({ data: {
      id: crypto.randomUUID(), userId: user.user.id, scope: 'campus', type: 'team_invitation',
      title: '团队邀请', body: '请处理邀请', sourceType: 'team_member', sourceId: invitation.id,
      createdAt: new Date(Date.now() - 60_000),
    } })
    await prisma.userNotification.createMany({ data: Array.from({ length: 55 }, (_, index) => ({
      id: crypto.randomUUID(), userId: user.user.id, scope: 'campus', type: 'info',
      title: `普通通知 ${index}`, body: '通知正文', sourceType: 'actionable-pagination', sourceId: crypto.randomUUID(),
      createdAt: new Date(),
    })) })

    const response = await createAuthenticatedRequest(app, token, { organizationId }).get('/api/notifications?filter=actionable&page=1&pageSize=50')
    expect(response.status).toBe(200)
    expect(response.body.data.notifications).toHaveLength(1)
    expect(response.body.data.notifications[0]).toMatchObject({ sourceId: invitation.id, actionable: true })
    expect(response.body.data.hasMore).toBe(false)
  })

  it('read-all includes account notifications visible in the current workspace', async () => {
    const campus = await createNotification('campus')
    const personal = await prisma.userNotification.create({
      data: {
        id: crypto.randomUUID(), userId: user.user.id, scope: 'personal', type: 'info',
        title: '个人通知', body: '通知正文', sourceType: 'test', sourceId: 'personal',
      },
    })
    const response = await createAuthenticatedRequest(app, token, { organizationId }).post('/api/notifications/read-all')
    expect(response.status).toBe(200)
    const [campusRow, personalRow] = await Promise.all([
      prisma.userNotification.findUnique({ where: { id: campus.id } }),
      prisma.userNotification.findUnique({ where: { id: personal.id } }),
    ])
    expect(campusRow?.readAt).not.toBeNull()
    expect(personalRow?.readAt).not.toBeNull()
  })

  it('account view aggregates every active school and labels the source organization', async () => {
    const secondSchool = await createTestSchoolWithPrincipal('第二通知学校')
    const secondOrganization = await prisma.organization.findFirstOrThrow({ where: { School: { id: secondSchool.school.id } } })
    await prisma.organizationMembership.create({
      data: {
        id: crypto.randomUUID(), organizationId: secondOrganization.id, userId: user.user.id,
        memberRole: 'student', relationType: 'enrolled', status: 'active', joinedAt: new Date(),
      },
    })
    const firstOrganization = await prisma.organization.findFirstOrThrow({ where: { School: { id: user.schoolId } } })
    await prisma.userNotification.createMany({ data: [
      {
        id: crypto.randomUUID(), userId: user.user.id, scope: 'campus', contextType: 'organization',
        contextKey: `organization:${firstOrganization.id}`, organizationId: firstOrganization.id,
        type: 'info', title: '第一学校', body: '通知正文', sourceType: 'account-view', sourceId: 'first',
      },
      {
        id: crypto.randomUUID(), userId: user.user.id, scope: 'campus', contextType: 'organization',
        contextKey: `organization:${secondOrganization.id}`, organizationId: secondOrganization.id,
        type: 'info', title: '第二学校', body: '通知正文', sourceType: 'account-view', sourceId: 'second',
      },
    ] })

    const response = await createAuthenticatedRequest(app, token).get('/api/notifications?view=account&pageSize=50')
    expect(response.status).toBe(200)
    const rows = response.body.data.notifications.filter((item: any) => item.sourceType === 'account-view')
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((item: any) => item.organizationName))).toEqual(new Set([firstOrganization.name, secondOrganization.name]))
  })

  it('does not reveal another user notification when marking it read', async () => {
    const other = await createTestUser({ role: 'student', schoolId: user.schoolId })
    const notification = await prisma.userNotification.create({
      data: {
        id: crypto.randomUUID(), userId: other.user.id, scope: 'campus', type: 'info',
        title: '他人通知', body: '通知正文', sourceType: 'test', sourceId: crypto.randomUUID(),
      },
    })
    const response = await request(app)
      .patch(`/api/notifications/${notification.id}/read`)
      .set('Cookie', `oi_session=${token}`)
      .set('X-OI-Organization-ID', organizationId)
    expect(response.status).toBe(404)
  })
})
