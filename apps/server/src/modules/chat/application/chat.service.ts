import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'

export class ChatError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message) }
}

const fail = (status: number, code: string, message: string): never => { throw new ChatError(status, code, message) }
const ordered = (a: string, b: string) => a < b ? [a, b] as const : [b, a] as const
const eventExpiry = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
const requestExpiry = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
const safeUser = (user: { id: string; username: string; avatar: string | null }) => ({ id: user.id, username: user.username, avatar: user.avatar })

async function notify(tx: Prisma.TransactionClient, userIds: string[], eventType: string, conversationId?: string, messageId?: string, payload?: Prisma.InputJsonValue) {
  for (const userId of [...new Set(userIds)]) {
    const event = await tx.chatUserEvent.create({ data: { userId, eventType, conversationId, messageId, payload, expiresAt: eventExpiry() } })
    await tx.$executeRaw`SELECT pg_notify('chat_user_events', ${JSON.stringify({ userId, eventId: event.id.toString() })})`
  }
}

async function blockedBetween(a: string, b: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  return Boolean(await tx.userBlock.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] }, select: { id: true } }))
}

async function activeFriendship(a: string, b: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const [userLowId, userHighId] = ordered(a, b)
  return tx.friendship.findUnique({ where: { userLowId_userHighId: { userLowId, userHighId } } })
}

export async function getPrivacy(userId: string) {
  return prisma.chatPrivacySetting.upsert({ where: { userId }, create: { userId }, update: {} })
}

export async function updatePrivacy(userId: string, body: any) {
  if (typeof body.allowExactUsernameDiscovery !== 'boolean') fail(422, 'INVALID_CHAT_PRIVACY', '隐私设置无效')
  return prisma.chatPrivacySetting.upsert({ where: { userId }, create: { userId, allowExactUsernameDiscovery: body.allowExactUsernameDiscovery }, update: { allowExactUsernameDiscovery: body.allowExactUsernameDiscovery } })
}

async function sharedContextIds(userId: string) {
  const [memberships, teams] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { userId, status: 'active', Organization: { status: 'active', OR: [{ type: { not: 'school' } }, { School: { directoryStatus: { not: 'legacy' }, status: 'active' } }] } },
      select: { organizationId: true },
    }),
    prisma.teamMember.findMany({ where: { userId, status: 'active', Team: { OR: [{ organizationId: null }, { Organization: { status: 'active', OR: [{ type: { not: 'school' } }, { School: { directoryStatus: { not: 'legacy' }, status: 'active' } }] } }] } }, select: { teamId: true } }),
  ])
  return { organizationIds: memberships.map(item => item.organizationId), teamIds: teams.map(item => item.teamId) }
}

async function hasSharedContext(userId: string, otherId: string) {
  const context = await sharedContextIds(userId)
  const [organization, team] = await Promise.all([
    context.organizationIds.length ? prisma.organizationMembership.findFirst({ where: { userId: otherId, status: 'active', organizationId: { in: context.organizationIds } }, select: { id: true } }) : null,
    context.teamIds.length ? prisma.teamMember.findFirst({ where: { userId: otherId, status: 'active', teamId: { in: context.teamIds } }, select: { id: true } }) : null,
  ])
  return Boolean(organization || team)
}

export async function searchChatUsers(userId: string, rawQuery: unknown) {
  const q = typeof rawQuery === 'string' ? rawQuery.trim() : ''
  if (q.length < 2 || q.length > 64) fail(422, 'INVALID_USER_SEARCH', '请输入 2～64 个字符')
  const context = await sharedContextIds(userId)
  const blocked = await prisma.userBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } })
  const blockedIds = blocked.map(item => item.blockerId === userId ? item.blockedId : item.blockerId)
  const sharedWhere: Prisma.UserWhereInput = {
    id: { notIn: [userId, ...blockedIds] }, status: 'active',
    OR: [
      ...(context.organizationIds.length ? [{ OrganizationMembership: { some: { organizationId: { in: context.organizationIds }, status: 'active' } } }] : []),
      ...(context.teamIds.length ? [{ TeamMember: { some: { teamId: { in: context.teamIds }, status: 'active' } } }] : []),
    ],
    username: { contains: q, mode: 'insensitive' },
  }
  const shared = sharedWhere.OR?.length ? await prisma.user.findMany({ where: sharedWhere, select: { id: true, username: true, avatar: true }, take: 20, orderBy: { username: 'asc' } }) : []
  const exact = /^[A-Za-z0-9_.-]+$/.test(q) ? await prisma.user.findFirst({
    where: { id: { notIn: [userId, ...blockedIds] }, username: { equals: q, mode: 'insensitive' }, status: 'active', ChatPrivacySetting: { allowExactUsernameDiscovery: true } },
    select: { id: true, username: true, avatar: true },
  }) : null
  const result = shared.map(user => ({ ...safeUser(user), discovery: 'shared' }))
  if (exact && !result.some(user => user.id === exact.id)) result.unshift({ ...safeUser(exact), discovery: 'exact' })
  return result
}

export async function createFriendRequest(userId: string, body: any) {
  const addresseeId = typeof body.addresseeId === 'string' ? body.addresseeId : ''
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : null
  if (!addresseeId || addresseeId === userId) fail(422, 'INVALID_FRIEND_REQUEST', '不能向该用户发送好友申请')
  const target = await prisma.user.findFirst({ where: { id: addresseeId, status: 'active' }, select: { id: true } })
  if (!target || await blockedBetween(userId, addresseeId)) fail(404, 'CHAT_USER_NOT_AVAILABLE', '用户不存在或不可联系')
  const discoverable = await hasSharedContext(userId, addresseeId) || Boolean(await prisma.chatPrivacySetting.findFirst({ where: { userId: addresseeId, allowExactUsernameDiscovery: true }, select: { userId: true } }))
  if (!discoverable) fail(404, 'CHAT_USER_NOT_AVAILABLE', '用户不存在或不可联系')
  if ((await activeFriendship(userId, addresseeId))?.status === 'active') fail(409, 'ALREADY_FRIENDS', '你们已经是好友')
  const [dayCount, pendingCount] = await Promise.all([
    prisma.friendRequest.count({ where: { requesterId: userId, createdAt: { gte: new Date(Date.now() - 86400000) } } }),
    prisma.friendRequest.count({ where: { requesterId: userId, status: 'pending', expiresAt: { gt: new Date() } } }),
  ])
  if (dayCount >= 20 || pendingCount >= 50) fail(429, 'FRIEND_REQUEST_RATE_LIMITED', '好友申请过于频繁，请稍后再试')
  try {
    return await prisma.$transaction(async tx => {
      const request = await tx.friendRequest.create({ data: { id: randomUUID(), requesterId: userId, addresseeId, message, expiresAt: requestExpiry() } })
      await notify(tx, [addresseeId], 'friend_request_created', undefined, undefined, { requestId: request.id })
      return request
    })
  } catch (error: any) {
    if (error?.code === 'P2002') fail(409, 'FRIEND_REQUEST_PENDING', '已有待处理的好友申请')
    throw error
  }
}

export async function listFriendRequests(userId: string) {
  await prisma.friendRequest.updateMany({ where: { status: 'pending', expiresAt: { lte: new Date() }, OR: [{ requesterId: userId }, { addresseeId: userId }] }, data: { status: 'expired', respondedAt: new Date() } })
  const rows = await prisma.friendRequest.findMany({
    where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
    include: { Requester: { select: { id: true, username: true, avatar: true } }, Addressee: { select: { id: true, username: true, avatar: true } } },
    orderBy: { createdAt: 'desc' }, take: 100,
  })
  return rows.map(row => ({ ...row, Requester: safeUser(row.Requester), Addressee: safeUser(row.Addressee) }))
}

export async function respondFriendRequest(userId: string, requestId: string, action: 'accept' | 'reject' | 'cancel') {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string; requesterId: string; addresseeId: string; status: string; expiresAt: Date }>>`SELECT id, "requesterId", "addresseeId", status, "expiresAt" FROM "FriendRequest" WHERE id=${requestId} FOR UPDATE`
    const request = rows[0]
    if (!request) fail(404, 'FRIEND_REQUEST_NOT_FOUND', '好友申请不存在')
    if (request.status !== 'pending' || request.expiresAt <= new Date()) fail(409, 'FRIEND_REQUEST_ALREADY_PROCESSED', '好友申请已处理或已过期')
    if (action === 'cancel' ? request.requesterId !== userId : request.addresseeId !== userId) fail(403, 'FRIEND_REQUEST_FORBIDDEN', '无权处理该申请')
    if (await blockedBetween(request.requesterId, request.addresseeId, tx)) fail(409, 'CHAT_RELATION_BLOCKED', '当前关系不可建立好友')
    const now = new Date()
    const status = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'cancelled'
    await tx.friendRequest.update({ where: { id: requestId }, data: { status, respondedAt: now } })
    if (action === 'accept') {
      const [userLowId, userHighId] = ordered(request.requesterId, request.addresseeId)
      await tx.friendship.upsert({
        where: { userLowId_userHighId: { userLowId, userHighId } },
        create: { id: randomUUID(), userLowId, userHighId, acceptedAt: now },
        update: { status: 'active', acceptedAt: now, removedAt: null, removedById: null },
      })
    }
    await notify(tx, [request.requesterId, request.addresseeId], `friend_request_${status}`, undefined, undefined, { requestId })
    return { status }
  })
}

export async function listFriends(userId: string) {
  const rows = await prisma.friendship.findMany({
    where: { status: 'active', OR: [{ userLowId: userId }, { userHighId: userId }] },
    include: { LowUser: { select: { id: true, username: true, avatar: true } }, HighUser: { select: { id: true, username: true, avatar: true } } },
    orderBy: { acceptedAt: 'desc' },
  })
  return rows.map(row => ({ friendshipId: row.id, since: row.acceptedAt, user: safeUser(row.userLowId === userId ? row.HighUser : row.LowUser) }))
}

export async function removeFriend(userId: string, otherId: string) {
  const [userLowId, userHighId] = ordered(userId, otherId)
  return prisma.$transaction(async tx => {
    const changed = await tx.friendship.updateMany({ where: { userLowId, userHighId, status: 'active' }, data: { status: 'removed', removedAt: new Date(), removedById: userId } })
    if (!changed.count) fail(404, 'FRIENDSHIP_NOT_FOUND', '好友关系不存在')
    await notify(tx, [userId, otherId], 'friendship_removed', undefined, undefined, {})
    return { removed: true }
  })
}

export async function listBlocks(userId: string) {
  return prisma.userBlock.findMany({ where: { blockerId: userId }, include: { Blocked: { select: { id: true, username: true, avatar: true } } }, orderBy: { createdAt: 'desc' } })
}

export async function blockUser(userId: string, blockedId: string) {
  if (!blockedId || blockedId === userId) fail(422, 'INVALID_BLOCK_TARGET', '不能拉黑该用户')
  return prisma.$transaction(async tx => {
    const target = await tx.user.findUnique({ where: { id: blockedId }, select: { id: true } })
    if (!target) fail(404, 'CHAT_USER_NOT_AVAILABLE', '用户不存在')
    await tx.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: userId, blockedId } }, create: { id: randomUUID(), blockerId: userId, blockedId }, update: {} })
    const [userLowId, userHighId] = ordered(userId, blockedId)
    await tx.friendship.updateMany({ where: { userLowId, userHighId, status: 'active' }, data: { status: 'removed', removedAt: new Date(), removedById: userId } })
    await tx.friendRequest.updateMany({ where: { status: 'pending', OR: [{ requesterId: userId, addresseeId: blockedId }, { requesterId: blockedId, addresseeId: userId }] }, data: { status: 'blocked', respondedAt: new Date() } })
    await notify(tx, [userId], 'block_updated', undefined, undefined, { blockedId })
    return { blocked: true }
  })
}

export async function unblockUser(userId: string, blockedId: string) {
  await prisma.userBlock.deleteMany({ where: { blockerId: userId, blockedId } })
  return { blocked: false }
}

async function requireConversationMember(userId: string, conversationId: string) {
  const member = await prisma.directConversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } }, include: { Conversation: true } })
  if (!member) throw new ChatError(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
  return member
}

export async function createConversation(userId: string, body: any) {
  const otherId = typeof body.userId === 'string' ? body.userId : ''
  const friendship = await activeFriendship(userId, otherId)
  if (!friendship || friendship.status !== 'active' || await blockedBetween(userId, otherId)) fail(403, 'FRIENDSHIP_REQUIRED', '只有好友可以发起聊天')
  const [userLowId, userHighId] = ordered(userId, otherId)
  return prisma.directConversation.upsert({
    where: { userLowId_userHighId: { userLowId, userHighId } },
    create: { id: randomUUID(), userLowId, userHighId, Members: { create: [{ id: randomUUID(), userId: userLowId }, { id: randomUUID(), userId: userHighId }] } },
    update: {},
  })
}

export async function listConversations(userId: string, includeArchived = false) {
  const members = await prisma.directConversationMember.findMany({
    where: { userId, ...(includeArchived ? {} : { archivedAt: null }) },
    include: { Conversation: { include: { LowUser: { select: { id: true, username: true, avatar: true } }, HighUser: { select: { id: true, username: true, avatar: true } } } } },
    orderBy: { Conversation: { lastMessageAt: 'desc' } }, take: 100,
  })
  const otherIds = members.map(member => member.Conversation.userLowId === userId ? member.Conversation.userHighId : member.Conversation.userLowId)
  const [friendships, blocks] = await Promise.all([
    prisma.friendship.findMany({ where: { status: 'active', OR: [{ userLowId: userId, userHighId: { in: otherIds } }, { userHighId: userId, userLowId: { in: otherIds } }] }, select: { userLowId: true, userHighId: true } }),
    prisma.userBlock.findMany({ where: { OR: [{ blockerId: userId, blockedId: { in: otherIds } }, { blockedId: userId, blockerId: { in: otherIds } }] }, select: { blockerId: true, blockedId: true } }),
  ])
  const friendIds = new Set(friendships.map(item => item.userLowId === userId ? item.userHighId : item.userLowId))
  const blockedIds = new Set(blocks.map(item => item.blockerId === userId ? item.blockedId : item.blockerId))
  return members.map(member => {
    const conversation = member.Conversation
    const other = conversation.userLowId === userId ? conversation.HighUser : conversation.LowUser
    return { id: conversation.id, other: safeUser(other), lastMessageSeq: conversation.lastMessageSeq, lastMessagePreview: conversation.lastMessageSeq > member.clearedThroughSeq ? conversation.lastMessagePreview : null, lastMessageAt: conversation.lastMessageAt, unreadCount: member.unreadCount, archivedAt: member.archivedAt, canSend: friendIds.has(other.id) && !blockedIds.has(other.id) }
  })
}

export async function listMessages(userId: string, conversationId: string, query: any) {
  const member = await requireConversationMember(userId, conversationId)
  const afterSeq = Number.isSafeInteger(Number(query.afterSeq)) ? Math.max(member.clearedThroughSeq, Number(query.afterSeq)) : member.clearedThroughSeq
  const beforeSeq = Number.isSafeInteger(Number(query.beforeSeq)) ? Number(query.beforeSeq) : undefined
  const rows = await prisma.directMessage.findMany({
    where: { conversationId, seq: { gt: afterSeq, ...(beforeSeq ? { lt: beforeSeq } : {}) } },
    orderBy: { seq: beforeSeq ? 'desc' : 'asc' }, take: 100,
  })
  return (beforeSeq ? rows.reverse() : rows).map(row => ({ ...row, seq: row.seq }))
}

function validateMessageContent(value: unknown) {
  if (typeof value !== 'string') throw new ChatError(422, 'INVALID_MESSAGE', '消息内容不能为空')
  const content = value.trim()
  if (!content || [...content].length > 5000 || Buffer.byteLength(content, 'utf8') > 10240) fail(422, 'INVALID_MESSAGE', '消息最多 5000 个字符且不超过 10 KiB')
  return content
}

export async function sendMessage(userId: string, conversationId: string, body: any) {
  const content = validateMessageContent(body.content)
  const clientMessageId = typeof body.clientMessageId === 'string' && /^[0-9a-f-]{16,64}$/i.test(body.clientMessageId) ? body.clientMessageId : fail(422, 'INVALID_CLIENT_MESSAGE_ID', '消息幂等标识无效')
  const minute = new Date(Date.now() - 60000)
  const hour = new Date(Date.now() - 3600000)
  const tenSeconds = new Date(Date.now() - 10000)
  const [minuteCount, hourCount, conversationCount] = await Promise.all([
    prisma.directMessage.count({ where: { senderUserId: userId, createdAt: { gte: minute } } }),
    prisma.directMessage.count({ where: { senderUserId: userId, createdAt: { gte: hour } } }),
    prisma.directMessage.count({ where: { senderUserId: userId, conversationId, createdAt: { gte: tenSeconds } } }),
  ])
  if (minuteCount >= 20 || hourCount >= 300 || conversationCount >= 10) fail(429, 'CHAT_RATE_LIMITED', '消息发送过于频繁，请稍后再试')
  try {
    return await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string; userLowId: string; userHighId: string; lastMessageSeq: number }>>`SELECT id, "userLowId", "userHighId", "lastMessageSeq" FROM "DirectConversation" WHERE id=${conversationId} FOR UPDATE`
      const conversation = locked[0]
      if (!conversation || ![conversation.userLowId, conversation.userHighId].includes(userId)) fail(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
      const otherId = conversation.userLowId === userId ? conversation.userHighId : conversation.userLowId
      const friendship = await activeFriendship(userId, otherId, tx)
      if (!friendship || friendship.status !== 'active' || await blockedBetween(userId, otherId, tx)) fail(403, 'FRIENDSHIP_REQUIRED', '当前不是好友，无法发送消息')
      const existing = await tx.directMessage.findUnique({ where: { conversationId_senderUserId_clientMessageId: { conversationId, senderUserId: userId, clientMessageId } } })
      if (existing) return existing
      const seq = conversation.lastMessageSeq + 1
      const message = await tx.directMessage.create({ data: { id: randomUUID(), conversationId, senderUserId: userId, clientMessageId, seq, content } })
      await tx.directConversation.update({ where: { id: conversationId }, data: { lastMessageSeq: seq, lastMessagePreview: content.slice(0, 120), lastMessageAt: message.createdAt } })
      await tx.directConversationMember.update({ where: { conversationId_userId: { conversationId, userId: otherId } }, data: { unreadCount: { increment: 1 }, archivedAt: null } })
      await tx.directConversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data: { archivedAt: null } })
      await notify(tx, [userId, otherId], 'message_created', conversationId, message.id, { seq })
      return message
    })
  } catch (error: any) {
    if (error?.code === 'P2002') return prisma.directMessage.findUnique({ where: { conversationId_senderUserId_clientMessageId: { conversationId, senderUserId: userId, clientMessageId } } })
    throw error
  }
}

export async function markRead(userId: string, conversationId: string, rawThroughSeq: unknown) {
  const requested = Number(rawThroughSeq)
  if (!Number.isSafeInteger(requested) || requested < 0) fail(422, 'INVALID_READ_SEQUENCE', '已读位置无效')
  return prisma.$transaction(async tx => {
    const member = await tx.directConversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } }, include: { Conversation: true } })
    if (!member) throw new ChatError(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
    const throughSeq = Math.min(requested, member.Conversation.lastMessageSeq)
    if (throughSeq <= member.lastReadSeq) return { lastReadSeq: member.lastReadSeq, unreadCount: member.unreadCount }
    const unreadCount = await tx.directMessage.count({ where: { conversationId, senderUserId: { not: userId }, seq: { gt: throughSeq } } })
    const updated = await tx.directConversationMember.update({ where: { id: member.id }, data: { lastReadSeq: throughSeq, unreadCount } })
    const otherId = member.Conversation.userLowId === userId ? member.Conversation.userHighId : member.Conversation.userLowId
    await notify(tx, [userId, otherId], 'conversation_read', conversationId, undefined, { userId, throughSeq })
    return { lastReadSeq: updated.lastReadSeq, unreadCount: updated.unreadCount }
  })
}

export async function archiveConversation(userId: string, conversationId: string) {
  await requireConversationMember(userId, conversationId)
  await prisma.directConversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data: { archivedAt: new Date() } })
  return { archived: true }
}

export async function clearConversation(userId: string, conversationId: string) {
  const member = await requireConversationMember(userId, conversationId)
  await prisma.directConversationMember.update({ where: { id: member.id }, data: { clearedThroughSeq: member.Conversation.lastMessageSeq, lastReadSeq: member.Conversation.lastMessageSeq, unreadCount: 0 } })
  return { clearedThroughSeq: member.Conversation.lastMessageSeq }
}

export async function unreadSummary(userId: string) {
  const [messages, requests] = await Promise.all([
    prisma.directConversationMember.aggregate({ where: { userId }, _sum: { unreadCount: true } }),
    prisma.friendRequest.count({ where: { addresseeId: userId, status: 'pending', expiresAt: { gt: new Date() } } }),
  ])
  return { messageUnread: messages._sum.unreadCount || 0, pendingFriendRequests: requests, total: (messages._sum.unreadCount || 0) + requests }
}

export async function createReport(userId: string, body: any) {
  const messageId = typeof body.messageId === 'string' ? body.messageId : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 100) : ''
  const details = typeof body.details === 'string' ? body.details.trim().slice(0, 2000) : null
  if (!messageId || !reason) fail(422, 'INVALID_CHAT_REPORT', '请选择举报原因')
  if (await prisma.chatReport.count({ where: { reporterUserId: userId, createdAt: { gte: new Date(Date.now() - 86400000) } } }) >= 10) fail(429, 'CHAT_REPORT_RATE_LIMITED', '举报提交过于频繁')
  const message = await prisma.directMessage.findUnique({ where: { id: messageId }, include: { Conversation: true } })
  if (!message) throw new ChatError(404, 'MESSAGE_NOT_REPORTABLE', '消息不存在或不可举报')
  if (![message.Conversation.userLowId, message.Conversation.userHighId].includes(userId) || message.senderUserId === userId) fail(404, 'MESSAGE_NOT_REPORTABLE', '消息不存在或不可举报')
  const context = await prisma.directMessage.findMany({ where: { conversationId: message.conversationId, seq: { gte: Math.max(1, message.seq - 10), lte: message.seq + 10 } }, orderBy: { seq: 'asc' }, select: { id: true, senderUserId: true, seq: true, content: true, createdAt: true, Sender: { select: { username: true } } } })
  try {
    return await prisma.chatReport.create({ data: { id: randomUUID(), conversationId: message.conversationId, messageId, reporterUserId: userId, targetUserId: message.senderUserId, reason, details, evidenceSnapshot: context as unknown as Prisma.InputJsonValue, evidenceHoldUntil: new Date(Date.now() + 365 * 86400000) } })
  } catch (error: any) {
    if (error?.code === 'P2002') fail(409, 'CHAT_REPORT_PENDING', '该消息已有待处理举报')
    throw error
  }
}

export async function listReports(query: any) {
  const status = ['pending', 'resolved', 'dismissed'].includes(query.status) ? query.status : undefined
  const page = Math.max(1, Number(query.page) || 1), pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  const where = status ? { status } : {}
  const [items, total] = await Promise.all([
    prisma.chatReport.findMany({ where, select: { id: true, reason: true, status: true, createdAt: true, reviewedAt: true, Reporter: { select: { username: true } }, Target: { select: { username: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.chatReport.count({ where }),
  ])
  return { items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } }
}

export async function getReport(actorUserId: string, reportId: string, accessReason: unknown) {
  const reason = typeof accessReason === 'string' ? accessReason.trim().slice(0, 500) : ''
  if (!reason) fail(422, 'REPORT_ACCESS_REASON_REQUIRED', '查看举报内容前必须填写查看原因')
  const report = await prisma.chatReport.findUnique({ where: { id: reportId }, include: { Reporter: { select: { username: true } }, Target: { select: { username: true } } } })
  if (!report) fail(404, 'CHAT_REPORT_NOT_FOUND', '举报不存在')
  await prisma.platformAuditLog.create({ data: { id: randomUUID(), actorUserId, action: 'chat_report_evidence_viewed', targetType: 'ChatReport', targetId: reportId, metadata: { reason } } })
  return report
}

export async function reviewReport(actorUserId: string, reportId: string, status: 'resolved' | 'dismissed', note: unknown) {
  const resolutionNote = typeof note === 'string' ? note.trim().slice(0, 2000) : ''
  if (!resolutionNote) fail(422, 'REPORT_RESOLUTION_REQUIRED', '请填写处理说明')
  return prisma.$transaction(async tx => {
    const changed = await tx.chatReport.updateMany({ where: { id: reportId, status: 'pending' }, data: { status, resolutionNote, reviewedByUserId: actorUserId, reviewedAt: new Date() } })
    if (!changed.count) fail(409, 'CHAT_REPORT_ALREADY_PROCESSED', '举报已处理或不存在')
    await tx.platformAuditLog.create({ data: { id: randomUUID(), actorUserId, action: `chat_report_${status}`, targetType: 'ChatReport', targetId: reportId, metadata: { resolutionNote } } })
    return tx.chatReport.findUnique({ where: { id: reportId } })
  })
}

export async function eventBacklog(userId: string, afterId: bigint, take = 200) {
  return prisma.chatUserEvent.findMany({ where: { userId, id: { gt: afterId }, expiresAt: { gt: new Date() } }, orderBy: { id: 'asc' }, take })
}

export async function isEventCursorExpired(userId: string, cursor: bigint) {
  if (cursor <= 0n) return false
  return !await prisma.chatUserEvent.findFirst({ where: { userId, id: cursor, expiresAt: { gt: new Date() } }, select: { id: true } })
}
