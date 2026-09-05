import crypto from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { chatRouter, chatReportAdminRouter } from '../src/modules/chat/chat.routes'
import { resolveEventCursor } from '../src/modules/chat/application/chat.service'
import { runChatMaintenance } from '../src/modules/chat/application/chat-maintenance.service'
import { prisma } from '../src/prisma'
import { generateTestToken } from './helpers/testToken'

const app = express()
app.use(express.json())
app.use('/api/chat', chatRouter)
app.use('/api/platform/chat-reports', chatReportAdminRouter)

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
let alice: any, bob: any, outsider: any, admin: any
let aliceToken = '', bobToken = '', outsiderToken = '', adminToken = ''

async function user(username: string, role = 'user') {
  const created = await prisma.user.create({ data: { id: crypto.randomUUID(), username: `${username}-${crypto.randomUUID()}`, passwordHash: 'test', role } })
  await prisma.personalProfile.create({ data: { userId: created.id } })
  return created
}

beforeEach(async () => {
  alice = await user('chat-alice'); bob = await user('chat-bob'); outsider = await user('chat-outsider'); admin = await user('chat-admin', 'platform_admin')
  aliceToken = generateTestToken({ userId: alice.id, username: alice.username, role: 'user', workspaceMode: 'personal' })
  bobToken = generateTestToken({ userId: bob.id, username: bob.username, role: 'user', workspaceMode: 'personal' })
  outsiderToken = generateTestToken({ userId: outsider.id, username: outsider.username, role: 'user', workspaceMode: 'personal' })
  adminToken = generateTestToken({ userId: admin.id, username: admin.username, role: 'platform_admin', workspaceMode: 'work' })
})

async function befriend() {
  await prisma.chatPrivacySetting.upsert({ where: { userId: bob.id }, create: { userId: bob.id, allowExactUsernameDiscovery: true }, update: { allowExactUsernameDiscovery: true } })
  const pending = await request(app).post('/api/chat/friend-requests').set(auth(aliceToken)).send({ addresseeId: bob.id, message: '你好' })
  expect(pending.status).toBe(201)
  expect((await request(app).post(`/api/chat/friend-requests/${pending.body.data.id}/accept`).set(auth(bobToken)).send({})).status).toBe(200)
}

describe('account direct chat', () => {
  it('requires friendship and restores the same conversation after re-adding', async () => {
    expect((await request(app).post('/api/chat/conversations').set(auth(aliceToken)).send({ userId: bob.id })).status).toBe(403)
    await befriend()
    const first = await request(app).post('/api/chat/conversations').set(auth(aliceToken)).send({ userId: bob.id })
    expect(first.status).toBe(201)
    await request(app).delete(`/api/chat/friends/${bob.id}`).set(auth(aliceToken))
    expect((await request(app).post(`/api/chat/conversations/${first.body.data.id}/messages`).set(auth(aliceToken)).send({ clientMessageId: crypto.randomUUID(), content: 'blocked' })).status).toBe(403)
    await befriend()
    const restored = await request(app).post('/api/chat/conversations').set(auth(bobToken)).send({ userId: alice.id })
    expect(restored.body.data.id).toBe(first.body.data.id)
  })

  it('keeps message idempotency and unread state monotonic', async () => {
    await befriend()
    const conversation = await request(app).post('/api/chat/conversations').set(auth(aliceToken)).send({ userId: bob.id })
    const clientMessageId = crypto.randomUUID()
    const first = await request(app).post(`/api/chat/conversations/${conversation.body.data.id}/messages`).set(auth(aliceToken)).send({ clientMessageId, content: 'hello' })
    const duplicate = await request(app).post(`/api/chat/conversations/${conversation.body.data.id}/messages`).set(auth(aliceToken)).send({ clientMessageId, content: 'hello' })
    expect(first.body.data.id).toBe(duplicate.body.data.id)
    expect((await request(app).get('/api/chat/unread').set(auth(bobToken))).body.data.messageUnread).toBe(1)
    const read = await request(app).post(`/api/chat/conversations/${conversation.body.data.id}/read`).set(auth(bobToken)).send({ throughSeq: 999 })
    expect(read.body.data.lastReadSeq).toBe(1)
    expect((await request(app).get('/api/chat/unread').set(auth(bobToken))).body.data.messageUnread).toBe(0)
  })

  it('serializes concurrent sends into one ordered conversation sequence', async () => {
    await befriend()
    const conversation = await request(app).post('/api/chat/conversations').set(auth(aliceToken)).send({ userId: bob.id })
    const responses = await Promise.all(Array.from({ length: 10 }, (_, index) => request(app).post(`/api/chat/conversations/${conversation.body.data.id}/messages`).set(auth(aliceToken)).send({ clientMessageId: crypto.randomUUID(), content: `message-${index}` })))
    expect(responses.every(response => response.status === 201)).toBe(true)
    const rows = await prisma.directMessage.findMany({ where: { conversationId: conversation.body.data.id }, orderBy: { seq: 'asc' } })
    expect(rows.map(row => row.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect((await request(app).get('/api/chat/unread').set(auth(bobToken))).body.data.messageUnread).toBe(10)
  })

  it('returns the latest message page and supports before/after sequence pagination', async () => {
    await befriend()
    const conversation = await request(app).post('/api/chat/conversations').set(auth(aliceToken)).send({ userId: bob.id })
    await prisma.directMessage.createMany({ data: Array.from({ length: 150 }, (_, index) => ({ id: crypto.randomUUID(), conversationId: conversation.body.data.id, senderUserId: alice.id, clientMessageId: crypto.randomUUID(), seq: index + 1, content: `message-${index + 1}` })) })
    await prisma.directConversation.update({ where: { id: conversation.body.data.id }, data: { lastMessageSeq: 150, lastMessagePreview: 'message-150', lastMessageAt: new Date(), lastActivityAt: new Date() } })

    const latest = await request(app).get(`/api/chat/conversations/${conversation.body.data.id}/messages?pagination=v2&pageSize=50`).set(auth(bobToken))
    expect(latest.body.data.items.map((item: any) => item.seq)).toEqual(Array.from({ length: 50 }, (_, index) => index + 101))
    expect(latest.body.data.page).toMatchObject({ hasMoreBefore: true, hasMoreAfter: false, oldestSeq: 101, newestSeq: 150 })
    const before = await request(app).get(`/api/chat/conversations/${conversation.body.data.id}/messages?pagination=v2&pageSize=50&beforeSeq=101`).set(auth(bobToken))
    expect(before.body.data.items.map((item: any) => item.seq)).toEqual(Array.from({ length: 50 }, (_, index) => index + 51))
    const after = await request(app).get(`/api/chat/conversations/${conversation.body.data.id}/messages?pagination=v2&pageSize=20&afterSeq=120`).set(auth(bobToken))
    expect(after.body.data.items.map((item: any) => item.seq)).toEqual(Array.from({ length: 20 }, (_, index) => index + 121))
    expect(after.body.data.page.hasMoreAfter).toBe(true)
    const legacy = await request(app).get(`/api/chat/conversations/${conversation.body.data.id}/messages`).set(auth(bobToken))
    expect(legacy.body.data[0].seq).toBe(51)
    expect(legacy.body.data.at(-1).seq).toBe(150)
    expect((await request(app).get(`/api/chat/conversations/${conversation.body.data.id}/messages?pagination=v2&beforeSeq=20&afterSeq=10`).set(auth(bobToken))).status).toBe(422)
  })

  it('resolves initial event cursors at the current tail and requests resync for expired cursors', async () => {
    const event = await prisma.chatUserEvent.create({ data: { userId: alice.id, eventType: 'test', expiresAt: new Date(Date.now() + 60_000) } })
    expect(await resolveEventCursor(alice.id)).toEqual({ cursor: event.id, resync: false })
    expect(await resolveEventCursor(alice.id, event.id.toString())).toEqual({ cursor: event.id, resync: false })
    await prisma.chatUserEvent.update({ where: { id: event.id }, data: { expiresAt: new Date(Date.now() - 1_000) } })
    expect(await resolveEventCursor(alice.id, event.id.toString())).toEqual({ cursor: 0n, resync: true })
  })

  it('checks idempotency before rate limits and rejects disabled recipients', async () => {
    await befriend()
    const conversation = await request(app).post('/api/chat/conversations').set(auth(aliceToken)).send({ userId: bob.id })
    const clientMessageId = crypto.randomUUID()
    const first = await request(app).post(`/api/chat/conversations/${conversation.body.data.id}/messages`).set(auth(aliceToken)).send({ clientMessageId, content: 'retry-safe' })
    await prisma.directMessage.createMany({ data: Array.from({ length: 20 }, (_, index) => ({ id: crypto.randomUUID(), conversationId: conversation.body.data.id, senderUserId: alice.id, clientMessageId: crypto.randomUUID(), seq: index + 2, content: `limit-${index}` })) })
    const duplicate = await request(app).post(`/api/chat/conversations/${conversation.body.data.id}/messages`).set(auth(aliceToken)).send({ clientMessageId, content: 'retry-safe' })
    expect(duplicate.body.data.id).toBe(first.body.data.id)
    expect((await request(app).post(`/api/chat/conversations/${conversation.body.data.id}/messages`).set(auth(aliceToken)).send({ clientMessageId, content: 'different' })).status).toBe(409)
    await prisma.user.update({ where: { id: alice.id }, data: { status: 'disabled' } })
    expect((await request(app).post(`/api/chat/conversations/${conversation.body.data.id}/messages`).set(auth(bobToken)).send({ clientMessageId: crypto.randomUUID(), content: 'disabled target' })).status).toBe(409)
  })

  it('advances maintenance beyond the first 500 members', async () => {
    const peers = Array.from({ length: 700 }, (_, index) => ({ id: `maintenance-user-${String(index).padStart(4, '0')}`, username: `maintenance-${crypto.randomUUID()}`, passwordHash: 'test', role: 'user' }))
    await prisma.user.createMany({ data: peers })
    const conversations = peers.map((peer, index) => ({ id: `maintenance-conversation-${String(index).padStart(4, '0')}`, userLowId: alice.id < peer.id ? alice.id : peer.id, userHighId: alice.id < peer.id ? peer.id : alice.id }))
    await prisma.directConversation.createMany({ data: conversations })
    await prisma.directConversationMember.createMany({ data: conversations.map((conversation, index) => ({ id: `maintenance-member-${String(index).padStart(4, '0')}`, conversationId: conversation.id, userId: alice.id, unreadCount: index === 650 ? 7 : 0 })) })
    await runChatMaintenance()
    expect((await prisma.directConversationMember.findUnique({ where: { id: 'maintenance-member-0650' } }))?.unreadCount).toBe(7)
    await runChatMaintenance()
    expect((await prisma.directConversationMember.findUnique({ where: { id: 'maintenance-member-0650' } }))?.unreadCount).toBe(0)
  })

  it('block removes friendship and closes pending requests', async () => {
    await befriend()
    expect((await request(app).post(`/api/chat/blocks/${bob.id}`).set(auth(aliceToken)).send({})).status).toBe(200)
    expect((await request(app).post('/api/chat/friend-requests').set(auth(bobToken)).send({ addresseeId: alice.id })).status).toBe(404)
    expect((await request(app).get('/api/chat/friends').set(auth(aliceToken))).body.data).toHaveLength(0)
  })

  it('requires explicit exact discovery and never returns partial global matches', async () => {
    expect((await request(app).get(`/api/chat/users/search?q=${encodeURIComponent(bob.username)}`).set(auth(aliceToken))).body.data).toHaveLength(0)
    await request(app).patch('/api/chat/privacy').set(auth(bobToken)).send({ allowExactUsernameDiscovery: true })
    expect((await request(app).get(`/api/chat/users/search?q=${encodeURIComponent(bob.username.slice(0, 8))}`).set(auth(aliceToken))).body.data).toHaveLength(0)
    expect((await request(app).get(`/api/chat/users/search?q=${encodeURIComponent(bob.username)}`).set(auth(aliceToken))).body.data[0].id).toBe(bob.id)
  })

  it('allows shared active schools to search but excludes legacy schools', async () => {
    const organizationId = crypto.randomUUID()
    await prisma.organization.create({ data: { id: organizationId, name: '聊天共享学校', type: 'school' } })
    await prisma.school.create({ data: { id: crypto.randomUUID(), name: `聊天共享学校-${crypto.randomUUID()}`, organizationId, directoryStatus: 'verified' } })
    for (const member of [alice, bob]) await prisma.organizationMembership.create({ data: { id: crypto.randomUUID(), organizationId, userId: member.id, memberRole: 'student', relationType: 'enrolled', status: 'active' } })
    const partial = bob.username.slice(0, 8)
    expect((await request(app).get(`/api/chat/users/search?q=${encodeURIComponent(partial)}`).set(auth(aliceToken))).body.data[0].id).toBe(bob.id)
    await prisma.school.update({ where: { organizationId }, data: { directoryStatus: 'legacy' } })
    expect((await request(app).get(`/api/chat/users/search?q=${encodeURIComponent(partial)}`).set(auth(aliceToken))).body.data).toHaveLength(0)
  })

  it('restricts messages to members and audits report evidence access', async () => {
    await befriend()
    const conversation = await request(app).post('/api/chat/conversations').set(auth(aliceToken)).send({ userId: bob.id })
    const message = await request(app).post(`/api/chat/conversations/${conversation.body.data.id}/messages`).set(auth(aliceToken)).send({ clientMessageId: crypto.randomUUID(), content: 'bad message' })
    expect((await request(app).get(`/api/chat/conversations/${conversation.body.data.id}/messages`).set(auth(outsiderToken))).status).toBe(404)
    const report = await request(app).post('/api/chat/reports').set(auth(bobToken)).send({ messageId: message.body.data.id, reason: '骚扰' })
    expect(report.status).toBe(201)
    expect((await request(app).get(`/api/platform/chat-reports/${report.body.data.id}`).set(auth(adminToken))).status).toBe(422)
    expect((await request(app).get(`/api/platform/chat-reports/${report.body.data.id}?reason=审核`).set(auth(adminToken))).status).toBe(200)
    expect(await prisma.platformAuditLog.count({ where: { action: 'chat_report_evidence_viewed', targetId: report.body.data.id } })).toBe(1)
    expect((await request(app).post(`/api/platform/chat-reports/${report.body.data.id}/resolve`).set(auth(adminToken)).send({ note: '处理完成' })).status).toBe(200)
    await prisma.chatReport.update({ where: { id: report.body.data.id }, data: { evidenceHoldUntil: new Date(Date.now() - 1_000) } })
    await runChatMaintenance()
    const released = await prisma.chatReport.findUnique({ where: { id: report.body.data.id } })
    expect(released?.messageId).toBeNull()
    expect(released?.evidenceReleasedAt).not.toBeNull()
    expect(released?.evidenceSnapshot).toMatchObject({ released: true })
  })
})
