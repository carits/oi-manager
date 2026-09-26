import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { chatMetrics } from '../chat-metrics'
import { ChatError, fail } from './chat-errors'
import { resolveSendableSticker, serializeChatMessage } from './chat-sticker.service'
export { ChatError, fail } from './chat-errors'
const ordered = (a: string, b: string) => a < b ? [a, b] as const : [b, a] as const
const eventExpiry = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
const requestExpiry = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
const safeUser = (user: { id: string; username: string; avatar: string | null }) => ({ id: user.id, username: user.username, avatar: user.avatar })

function parsePageSize(value: unknown, fallback: number, maximum: number) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) fail(422, 'CHAT_MESSAGE_PAGE_INVALID', `分页大小必须为 1～${maximum}`)
  return parsed
}

function parseSequence(value: unknown, field: string, allowZero = false) {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) fail(422, 'CHAT_MESSAGE_PAGE_INVALID', `${field} 无效`)
  return parsed
}

type ConversationCursor = { activityAt: string; id: string }
function encodeConversationCursor(cursor: ConversationCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}
function decodeConversationCursor(value: unknown): ConversationCursor | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 512) fail(422, 'CHAT_INVALID_CURSOR', '会话游标无效')
  try {
    const parsed = JSON.parse(Buffer.from(value as string, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.contestAt !== 'string' || !Number.isFinite(Date.parse(parsed.contestAt))) throw new Error('invalid')
    return parsed
  } catch {
    fail(422, 'CHAT_INVALID_CURSOR', '会话游标无效')
  }
}

async function notify(tx: Prisma.TransactionClient, userIds: string[], eventType: string, conversationId?: string, messageId?: string, payload?: Prisma.InputJsonValue) {
  // Always acquire user foreign-key/index locks in a deterministic order.
  // This matters when two participants send concurrently: the two transactions
  // must never insert their per-user events in opposite orders.
  for (const userId of [...new Set(userIds)].sort()) {
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

async function lockChatRelation(tx: Prisma.TransactionClient, a: string, b: string) {
  const [userLowId, userHighId] = ordered(a, b)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chat-relation:${userLowId}:${userHighId}`}, 0))`
}

async function lockChatActorBudget(tx: Prisma.TransactionClient, purpose: 'friend-request' | 'message', userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chat-${purpose}:${userId}`}, 0))`
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
  try {
    return await prisma.$transaction(async tx => {
      await lockChatActorBudget(tx, 'friend-request', userId)
      const now = new Date()
      const [dayCount, pendingCount] = await Promise.all([
        tx.friendRequest.count({ where: { requesterId: userId, createdAt: { gte: new Date(now.getTime() - 86400000) } } }),
        tx.friendRequest.count({ where: { requesterId: userId, status: 'pending', expiresAt: { gt: now } } }),
      ])
      if (dayCount >= 20 || pendingCount >= 50) fail(429, 'FRIEND_REQUEST_RATE_LIMITED', '好友申请过于频繁，请稍后再试')
      await lockChatRelation(tx, userId, addresseeId)
      if (await blockedBetween(userId, addresseeId, tx)) fail(404, 'CHAT_USER_NOT_AVAILABLE', '用户不存在或不可联系')
      if ((await activeFriendship(userId, addresseeId, tx))?.status === 'active') fail(409, 'ALREADY_FRIENDS', '你们已经是好友')
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
    const candidate = await tx.friendRequest.findUnique({ where: { id: requestId }, select: { requesterId: true, addresseeId: true } })
    if (!candidate) throw new ChatError(404, 'FRIEND_REQUEST_NOT_FOUND', '好友申请不存在')
    await lockChatRelation(tx, candidate.requesterId, candidate.addresseeId)
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
    await lockChatRelation(tx, userId, otherId)
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
    await lockChatRelation(tx, userId, blockedId)
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
  return prisma.$transaction(async tx => {
    await lockChatRelation(tx, userId, blockedId)
    await tx.userBlock.deleteMany({ where: { blockerId: userId, blockedId } })
    return { blocked: false }
  })
}

async function requireConversationMember(userId: string, conversationId: string) {
  const member = await prisma.directConversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } }, include: { Conversation: true } })
  if (!member) throw new ChatError(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
  return member
}

export async function createConversation(userId: string, body: any) {
  const otherId = typeof body.userId === 'string' ? body.userId : ''
  const activeUsers = await prisma.user.count({ where: { id: { in: [userId, otherId] }, status: 'active' } })
  if (activeUsers !== 2) fail(404, 'CHAT_TARGET_UNAVAILABLE', '联系人当前不可用')
  const friendship = await activeFriendship(userId, otherId)
  if (!friendship || friendship.status !== 'active' || await blockedBetween(userId, otherId)) fail(403, 'FRIENDSHIP_REQUIRED', '只有好友可以发起聊天')
  const [userLowId, userHighId] = ordered(userId, otherId)
  return prisma.directConversation.upsert({
    where: { userLowId_userHighId: { userLowId, userHighId } },
    create: { id: randomUUID(), userLowId, userHighId, Members: { create: [{ id: randomUUID(), userId: userLowId }, { id: randomUUID(), userId: userHighId }] } },
    update: {},
  })
}

export async function listConversations(userId: string, query: any = {}) {
  const v2 = query.pagination === 'v2'
  const scope = v2 ? (query.scope || 'active') : (query.archived === true || query.archived === 'true' ? 'all' : 'active')
  if (!['active', 'archived', 'all'].includes(scope)) fail(422, 'CHAT_INVALID_CURSOR', '会话范围无效')
  const pageSize = v2 ? parsePageSize(query.pageSize, 30, 100) : 100
  const cursor = v2 ? decodeConversationCursor(query.cursor) : undefined
  const activityBefore = cursor ? new Date(cursor.activityAt) : undefined
  const members = await prisma.directConversationMember.findMany({
    where: {
      userId,
      ...(scope === 'active' ? { archivedAt: null } : scope === 'archived' ? { archivedAt: { not: null } } : {}),
      ...(cursor ? { Conversation: { OR: [{ lastActivityAt: { lt: activityBefore } }, { lastActivityAt: activityBefore, id: { lt: cursor.id } }] } } : {}),
    },
    include: { Conversation: { include: { LowUser: { select: { id: true, username: true, avatar: true, status: true } }, HighUser: { select: { id: true, username: true, avatar: true, status: true } } } } },
    orderBy: [{ Conversation: { lastActivityAt: 'desc' } }, { Conversation: { id: 'desc' } }], take: pageSize + (v2 ? 1 : 0),
  })
  const pageMembers = v2 && members.length > pageSize ? members.slice(0, pageSize) : members
  const otherIds = pageMembers.map(member => member.Conversation.userLowId === userId ? member.Conversation.userHighId : member.Conversation.userLowId)
  const [friendships, blocks] = await Promise.all([
    prisma.friendship.findMany({ where: { status: 'active', OR: [{ userLowId: userId, userHighId: { in: otherIds } }, { userHighId: userId, userLowId: { in: otherIds } }] }, select: { userLowId: true, userHighId: true } }),
    prisma.userBlock.findMany({ where: { OR: [{ blockerId: userId, blockedId: { in: otherIds } }, { blockedId: userId, blockerId: { in: otherIds } }] }, select: { blockerId: true, blockedId: true } }),
  ])
  const friendIds = new Set(friendships.map(item => item.userLowId === userId ? item.userHighId : item.userLowId))
  const blockedIds = new Set(blocks.map(item => item.blockerId === userId ? item.blockedId : item.blockerId))
  const items = pageMembers.map(member => {
    const conversation = member.Conversation
    const other = conversation.userLowId === userId ? conversation.HighUser : conversation.LowUser
    return { id: conversation.id, other: safeUser(other), lastMessageSeq: conversation.lastMessageSeq, lastMessagePreview: conversation.lastMessageSeq > member.clearedThroughSeq ? conversation.lastMessagePreview : null, lastMessageAt: conversation.lastMessageAt, unreadCount: member.unreadCount, archivedAt: member.archivedAt, canSend: other.status === 'active' && friendIds.has(other.id) && !blockedIds.has(other.id) }
  })
  if (!v2) return items
  const last = pageMembers.at(-1)?.Conversation
  return { items, nextCursor: members.length > pageSize && last ? encodeConversationCursor({ activityAt: last.lastActivityAt.toISOString(), id: last.id }) : null }
}

export async function listMessages(userId: string, conversationId: string, query: any) {
  const member = await requireConversationMember(userId, conversationId)
  const v2 = query.pagination === 'v2'
  const pageSize = v2 ? parsePageSize(query.pageSize, 50, 100) : 100
  const parsedAfter = parseSequence(query.afterSeq, 'afterSeq', true)
  const beforeSeq = parseSequence(query.beforeSeq, 'beforeSeq')
  if (parsedAfter !== undefined && beforeSeq !== undefined) fail(422, 'CHAT_MESSAGE_PAGE_INVALID', 'beforeSeq 与 afterSeq 不能同时使用')
  const afterSeq = Math.max(member.clearedThroughSeq, parsedAfter || member.clearedThroughSeq)
  const isLatestPage = parsedAfter === undefined && beforeSeq === undefined
  const rows = await prisma.directMessage.findMany({
    where: { conversationId, seq: { gt: afterSeq, ...(beforeSeq ? { lt: beforeSeq } : {}) } },
    include: { Sticker: { select: { id: true, label: true, width: true, height: true, frameCount: true } } },
    orderBy: { seq: beforeSeq || isLatestPage ? 'desc' : 'asc' }, take: pageSize + (v2 ? 1 : 0),
  })
  const hasExtra = v2 && rows.length > pageSize
  const pageRows = hasExtra ? rows.slice(0, pageSize) : rows
  const items = (beforeSeq || isLatestPage ? pageRows.reverse() : pageRows).map(serializeChatMessage)
  if (!v2) return items
  return {
    items,
    page: {
      hasMoreBefore: beforeSeq !== undefined || isLatestPage ? hasExtra : Boolean(items[0] && items[0].seq > member.clearedThroughSeq + 1),
      hasMoreAfter: parsedAfter !== undefined ? hasExtra : false,
      oldestSeq: items[0]?.seq,
      newestSeq: items.at(-1)?.seq,
    },
  }
}

function validateMessageContent(value: unknown) {
  if (typeof value !== 'string') throw new ChatError(422, 'INVALID_MESSAGE', '消息内容不能为空')
  const content = value.trim()
  if (!content || [...content].length > 5000 || Buffer.byteLength(content, 'utf8') > 10240) fail(422, 'INVALID_MESSAGE', '消息最多 5000 个字符且不超过 10 KiB')
  return content
}

async function sendMessageImpl(userId: string, conversationId: string, body: any) {
  const messageType = body.type === undefined ? 'text' : body.type
  if (messageType !== 'text' && messageType !== 'sticker') fail(422, 'INVALID_MESSAGE_TYPE', '消息类型无效')
  const stickerId = messageType === 'sticker' && typeof body.stickerId === 'string' ? body.stickerId : null
  if (messageType === 'sticker' && (!stickerId || stickerId.length > 128)) fail(422, 'INVALID_STICKER', '请选择有效表情')
  const textContent = messageType === 'text' ? validateMessageContent(body.content) : null
  const clientMessageId = typeof body.clientMessageId === 'string' && /^[0-9a-f-]{16,64}$/i.test(body.clientMessageId) ? body.clientMessageId : fail(422, 'INVALID_CLIENT_MESSAGE_ID', '消息幂等标识无效')
  const samePayload = (message: { messageType: string; stickerId: string | null; content: string }) => message.messageType === messageType && (messageType === 'sticker' ? message.stickerId === stickerId : message.content === textContent)
  const existingBeforeLimit = await prisma.directMessage.findUnique({ where: { conversationId_senderUserId_clientMessageId: { conversationId, senderUserId: userId, clientMessageId } }, include: { Sticker: { select: { id: true, label: true, width: true, height: true, frameCount: true } } } })
  if (existingBeforeLimit) {
    if (!samePayload(existingBeforeLimit)) fail(409, 'CHAT_IDEMPOTENCY_CONFLICT', '同一消息标识不能用于不同内容')
    return serializeChatMessage(existingBeforeLimit)
  }
  const sticker = stickerId ? await resolveSendableSticker(stickerId) : null
  if (messageType === 'sticker' && !sticker) fail(422, 'STICKER_NOT_SENDABLE', '该表情已停用或不存在')
  const content = textContent || `[表情：${sticker!.label}]`
  const preview = messageType === 'sticker' ? '[表情]' : content.slice(0, 120)
  try {
    return await prisma.$transaction(async tx => {
      await lockChatActorBudget(tx, 'message', userId)
      const existing = await tx.directMessage.findUnique({ where: { conversationId_senderUserId_clientMessageId: { conversationId, senderUserId: userId, clientMessageId } }, include: { Sticker: { select: { id: true, label: true, width: true, height: true, frameCount: true } } } })
      if (existing) {
        if (!samePayload(existing)) fail(409, 'CHAT_IDEMPOTENCY_CONFLICT', '同一消息标识不能用于不同内容')
        return serializeChatMessage(existing)
      }
      const now = new Date()
      const [minuteCount, hourCount, conversationCount] = await Promise.all([
        tx.directMessage.count({ where: { senderUserId: userId, createdAt: { gte: new Date(now.getTime() - 60000) } } }),
        tx.directMessage.count({ where: { senderUserId: userId, createdAt: { gte: new Date(now.getTime() - 3600000) } } }),
        tx.directMessage.count({ where: { senderUserId: userId, conversationId, createdAt: { gte: new Date(now.getTime() - 10000) } } }),
      ])
      if (minuteCount >= 20 || hourCount >= 300 || conversationCount >= 10) fail(429, 'CHAT_RATE_LIMITED', '消息发送过于频繁，请稍后再试')
      const locked = await tx.$queryRaw<Array<{ id: string; userLowId: string; userHighId: string; lastMessageSeq: number }>>`SELECT id, "userLowId", "userHighId", "lastMessageSeq" FROM "DirectConversation" WHERE id=${conversationId} FOR UPDATE`
      const conversation = locked[0]
      if (!conversation || ![conversation.userLowId, conversation.userHighId].includes(userId)) fail(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
      const otherId = conversation.userLowId === userId ? conversation.userHighId : conversation.userLowId
      const memberIds = [userId, otherId].sort()
      // Lock both member rows in the same order used by every message sender.
      // The subsequent unread/archive updates then cannot deadlock with a
      // concurrent send from the other participant.
      await tx.$queryRaw`SELECT id FROM "DirectConversationMember" WHERE "conversationId"=${conversationId} AND "userId" IN (${memberIds[0]}, ${memberIds[1]}) ORDER BY "userId" FOR UPDATE`
      const users = await tx.user.findMany({ where: { id: { in: [userId, otherId] } }, select: { id: true, status: true } })
      if (users.find(user => user.id === userId)?.status !== 'active') fail(403, 'CHAT_USER_DISABLED', '当前账号无法发送消息')
      if (users.find(user => user.id === otherId)?.status !== 'active') fail(409, 'CHAT_TARGET_UNAVAILABLE', '联系人当前不可用')
      const friendship = await activeFriendship(userId, otherId, tx)
      if (!friendship || friendship.status !== 'active' || await blockedBetween(userId, otherId, tx)) fail(403, 'FRIENDSHIP_REQUIRED', '当前不是好友，无法发送消息')
      const seq = conversation.lastMessageSeq + 1
      if (stickerId && !(await tx.chatSticker.findFirst({ where: { id: stickerId, status: 'active', Pack: { status: 'active' } }, select: { id: true } }))) fail(422, 'STICKER_NOT_SENDABLE', '该表情已停用或不存在')
      const message = await tx.directMessage.create({ data: { id: randomUUID(), conversationId, senderUserId: userId, clientMessageId, seq, content, messageType, stickerId }, include: { Sticker: { select: { id: true, label: true, width: true, height: true, frameCount: true } } } })
      await tx.directConversation.update({ where: { id: conversationId }, data: { lastMessageSeq: seq, lastMessagePreview: preview, lastMessageAt: message.createdAt, lastActivityAt: message.createdAt } })
      const otherMember = { conversationId_userId: { conversationId, userId: otherId } }
      const senderMember = { conversationId_userId: { conversationId, userId } }
      // Keep writes deterministic too, while preserving the sender/recipient
      // semantics of unreadCount.
      for (const memberId of memberIds) {
        if (memberId === otherId) await tx.directConversationMember.update({ where: otherMember, data: { unreadCount: { increment: 1 }, archivedAt: null } })
        else await tx.directConversationMember.update({ where: senderMember, data: { archivedAt: null } })
      }
      await notify(tx, [userId, otherId], 'message_created', conversationId, message.id, { seq })
      return serializeChatMessage(message)
    })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const existing = await prisma.directMessage.findUnique({ where: { conversationId_senderUserId_clientMessageId: { conversationId, senderUserId: userId, clientMessageId } }, include: { Sticker: { select: { id: true, label: true, width: true, height: true, frameCount: true } } } })
      if (!existing) throw error
      if (!samePayload(existing)) fail(409, 'CHAT_IDEMPOTENCY_CONFLICT', '同一消息标识不能用于不同内容')
      return serializeChatMessage(existing)
    }
    throw error
  }
}

function isTransientTransactionError(error: any) {
  const databaseCode = error?.meta?.code || error?.meta?.database_error_code
  return error?.code === '40P01' || error?.code === '40001' || error?.code === 'P2034' || databaseCode === '40P01' || databaseCode === '40001'
}

async function withTransientTransactionRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isTransientTransactionError(error) || attempt === maxAttempts) throw error
      await new Promise(resolve => setTimeout(resolve, 10 * attempt * attempt))
    }
  }
  throw lastError
}

export async function sendMessage(userId: string, conversationId: string, body: any) {
  const startedAt = Date.now()
  try {
    const result = await withTransientTransactionRetry(() => sendMessageImpl(userId, conversationId, body))
    chatMetrics.messageSend(Date.now() - startedAt, true)
    return result
  } catch (error) {
    chatMetrics.messageSend(Date.now() - startedAt, false)
    throw error
  }
}

export async function markRead(userId: string, conversationId: string, rawThroughSeq: unknown) {
  const requested = Number(rawThroughSeq)
  if (!Number.isSafeInteger(requested) || requested < 0) fail(422, 'INVALID_READ_SEQUENCE', '已读位置无效')
  return prisma.$transaction(async tx => {
    const conversations = await tx.$queryRaw<Array<{ id: string; userLowId: string; userHighId: string; lastMessageSeq: number }>>`SELECT id, "userLowId", "userHighId", "lastMessageSeq" FROM "DirectConversation" WHERE id=${conversationId} FOR UPDATE`
    const conversation = conversations[0]
    if (!conversation || ![conversation.userLowId, conversation.userHighId].includes(userId)) throw new ChatError(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
    const members = await tx.$queryRaw<Array<{ id: string; lastReadSeq: number; unreadCount: number }>>`SELECT id, "lastReadSeq", "unreadCount" FROM "DirectConversationMember" WHERE "conversationId"=${conversationId} AND "userId"=${userId} FOR UPDATE`
    const member = members[0]
    if (!member) throw new ChatError(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
    const throughSeq = Math.min(requested, conversation.lastMessageSeq)
    if (throughSeq <= member.lastReadSeq) return { lastReadSeq: member.lastReadSeq, unreadCount: member.unreadCount }
    const unreadCount = await tx.directMessage.count({ where: { conversationId, senderUserId: { not: userId }, seq: { gt: throughSeq } } })
    const updated = await tx.directConversationMember.update({ where: { id: member.id }, data: { lastReadSeq: throughSeq, unreadCount } })
    const otherId = conversation.userLowId === userId ? conversation.userHighId : conversation.userLowId
    await notify(tx, [userId, otherId], 'conversation_read', conversationId, undefined, { userId, throughSeq })
    return { lastReadSeq: updated.lastReadSeq, unreadCount: updated.unreadCount }
  })
}

export async function archiveConversation(userId: string, conversationId: string) {
  return prisma.$transaction(async tx => {
    const conversations = await tx.$queryRaw<Array<{ id: string; userLowId: string; userHighId: string }>>`SELECT id, "userLowId", "userHighId" FROM "DirectConversation" WHERE id=${conversationId} FOR UPDATE`
    if (!conversations[0] || ![conversations[0].userLowId, conversations[0].userHighId].includes(userId)) throw new ChatError(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
    await tx.directConversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data: { archivedAt: new Date() } })
    await notify(tx, [userId], 'conversation_archived', conversationId)
    return { archived: true }
  })
}

export async function unarchiveConversation(userId: string, conversationId: string) {
  return prisma.$transaction(async tx => {
    const conversations = await tx.$queryRaw<Array<{ id: string; userLowId: string; userHighId: string }>>`SELECT id, "userLowId", "userHighId" FROM "DirectConversation" WHERE id=${conversationId} FOR UPDATE`
    if (!conversations[0] || ![conversations[0].userLowId, conversations[0].userHighId].includes(userId)) throw new ChatError(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
    await tx.directConversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data: { archivedAt: null } })
    await notify(tx, [userId], 'conversation_unarchived', conversationId)
    return { archived: false }
  })
}

export async function clearConversation(userId: string, conversationId: string) {
  return prisma.$transaction(async tx => {
    const conversations = await tx.$queryRaw<Array<{ id: string; userLowId: string; userHighId: string; lastMessageSeq: number }>>`SELECT id, "userLowId", "userHighId", "lastMessageSeq" FROM "DirectConversation" WHERE id=${conversationId} FOR UPDATE`
    const conversation = conversations[0]
    if (!conversation || ![conversation.userLowId, conversation.userHighId].includes(userId)) throw new ChatError(404, 'CONVERSATION_NOT_FOUND', '会话不存在')
    await tx.directConversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data: { clearedThroughSeq: conversation.lastMessageSeq, lastReadSeq: conversation.lastMessageSeq, unreadCount: 0 } })
    await notify(tx, [userId], 'conversation_cleared', conversationId, undefined, { throughSeq: conversation.lastMessageSeq })
    return { clearedThroughSeq: conversation.lastMessageSeq }
  })
}

export async function unreadSummary(userId: string) {
  const [messages, requests] = await Promise.all([
    prisma.directConversationMember.aggregate({ where: { userId }, _sum: { unreadCount: true } }),
    prisma.friendRequest.count({ where: { addresseeId: userId, status: 'pending', expiresAt: { gt: new Date() } } }),
  ])
  return { messageUnread: messages._sum.unreadCount || 0, pendingFriendRequests: requests, total: (messages._sum.unreadCount || 0) + requests }
}

export { createReport, getReport, listReports, reviewReport } from './chat-report.service'
export { eventBacklog, isEventCursorExpired, latestEventCursor, resolveEventCursor } from './chat-event.service'
