import crypto from 'crypto'
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { authenticate } from '../src/middleware/auth'
import { notificationRouter } from '../src/modules/notification/notification.routes'
import { prisma } from '../src/prisma'
import { createAuthenticatedRequest } from './helpers/testRequest'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestSchoolWithPrincipal, createTestUser } from './helpers/testUser'

const app = express()
app.use(express.json())
app.use('/api/notifications', authenticate, notificationRouter)

describe('notification application service', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>
  let token: string

  beforeEach(async () => {
    const school = await createTestSchoolWithPrincipal()
    user = await createTestUser({ role: 'student', schoolId: school.school.id })
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
    const listed = await createAuthenticatedRequest(app, token).get('/api/notifications')
    expect(listed.status).toBe(200)
    expect(listed.body.data.unreadCount).toBe(1)
    expect(listed.body.data.notifications[0].id).toBe(notification.id)

    const marked = await request(app)
      .patch(`/api/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${token}`)
    expect(marked.status).toBe(200)
    expect(marked.body.data).toMatchObject({ changed: true, unreadCount: 0 })
    const repeated = await request(app).patch(`/api/notifications/${notification.id}/read`).set('Authorization', `Bearer ${token}`)
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
    const first = await createAuthenticatedRequest(app, token).get('/api/notifications?page=1&pageSize=50')
    const second = await createAuthenticatedRequest(app, token).get('/api/notifications?page=2&pageSize=50')
    expect(first.body.data.notifications).toHaveLength(50)
    expect(first.body.data.hasMore).toBe(true)
    expect(second.body.data.notifications).toHaveLength(1)
    expect(second.body.data.hasMore).toBe(false)
  })

  it('read-all includes account notifications visible in the current workspace', async () => {
    const campus = await createNotification('campus')
    const personal = await prisma.userNotification.create({
      data: {
        id: crypto.randomUUID(), userId: user.user.id, scope: 'personal', type: 'info',
        title: '个人通知', body: '通知正文', sourceType: 'test', sourceId: 'personal',
      },
    })
    const response = await createAuthenticatedRequest(app, token).post('/api/notifications/read-all')
    expect(response.status).toBe(200)
    const [campusRow, personalRow] = await Promise.all([
      prisma.userNotification.findUnique({ where: { id: campus.id } }),
      prisma.userNotification.findUnique({ where: { id: personal.id } }),
    ])
    expect(campusRow?.readAt).not.toBeNull()
    expect(personalRow?.readAt).not.toBeNull()
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
      .set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(404)
  })
})
