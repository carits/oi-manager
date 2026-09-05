import { createHash } from 'node:crypto'
import { prisma } from '../../../prisma'
import { chatMetrics } from '../chat-metrics'

async function readCursor(name: string) {
  return (await prisma.chatMaintenanceCursor.findUnique({ where: { name }, select: { cursor: true } }))?.cursor || null
}

async function advanceCursor(name: string, ids: string[], batchSize: number) {
  const cursor = ids.length < batchSize ? null : ids.at(-1) || null
  await prisma.chatMaintenanceCursor.upsert({ where: { name }, create: { name, cursor }, update: { cursor } })
}

async function repairUnreadProjection() {
  const batchSize = 500
  const cursor = await readCursor('unread_repair')
  const members = await prisma.directConversationMember.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: 'asc' }, take: batchSize })
  let repaired = 0
  for (const member of members) {
    const expected = await prisma.directMessage.count({ where: { conversationId: member.conversationId, senderUserId: { not: member.userId }, seq: { gt: Math.max(member.lastReadSeq, member.clearedThroughSeq) } } })
    if (expected !== member.unreadCount) {
      await prisma.directConversationMember.update({ where: { id: member.id }, data: { unreadCount: expected } })
      repaired += 1
    }
  }
  await advanceCursor('unread_repair', members.map(member => member.id), batchSize)
  return { scanned: members.length, repaired }
}

async function releaseExpiredReportEvidence(now: Date) {
  const batchSize = 100
  const cursor = await readCursor('report_evidence_gc')
  const reports = await prisma.chatReport.findMany({
    where: { ...(cursor ? { id: { gt: cursor } } : {}), status: { in: ['resolved', 'dismissed'] }, evidenceReleasedAt: null, evidenceHoldUntil: { not: null, lte: now } },
    orderBy: { id: 'asc' }, take: batchSize,
  })
  for (const report of reports) {
    const serialized = JSON.stringify(report.evidenceSnapshot)
    await prisma.chatReport.update({
      where: { id: report.id },
      data: {
        messageId: null,
        evidenceReleasedAt: now,
        evidenceSnapshot: {
          released: true, releasedAt: now.toISOString(),
          sha256: createHash('sha256').update(serialized).digest('hex'),
          itemCount: Array.isArray(report.evidenceSnapshot) ? report.evidenceSnapshot.length : undefined,
        },
      },
    })
  }
  await advanceCursor('report_evidence_gc', reports.map(report => report.id), batchSize)
  return reports.length
}

async function collectClearedMessages(now: Date) {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const batchSize = 100
  const cursor = await readCursor('message_gc')
  const conversations = await prisma.directConversation.findMany({
    where: { ...(cursor ? { id: { gt: cursor } } : {}), Members: { every: { clearedThroughSeq: { gt: 0 } } }, lastMessageAt: { lt: thirtyDaysAgo } },
    include: { Members: { select: { clearedThroughSeq: true } } }, orderBy: { id: 'asc' }, take: batchSize,
  })
  let deleted = 0
  for (const conversation of conversations) {
    if (conversation.Members.length !== 2) continue
    const throughSeq = Math.min(...conversation.Members.map(member => member.clearedThroughSeq))
    const removed = await prisma.directMessage.deleteMany({ where: { conversationId: conversation.id, seq: { lte: throughSeq }, createdAt: { lt: thirtyDaysAgo }, Reports: { none: {} } } })
    deleted += removed.count
  }
  await advanceCursor('message_gc', conversations.map(conversation => conversation.id), batchSize)
  return { scanned: conversations.length, deleted }
}

export async function runChatMaintenance() {
  try {
    const now = new Date()
    const expiredEvents = await prisma.chatUserEvent.deleteMany({ where: { expiresAt: { lte: now } } })
    const expiredRequests = await prisma.friendRequest.updateMany({ where: { status: 'pending', expiresAt: { lte: now } }, data: { status: 'expired', respondedAt: now } })
    const unread = await repairUnreadProjection()
    const releasedEvidence = await releaseExpiredReportEvidence(now)
    const messages = await collectClearedMessages(now)
    chatMetrics.maintenance(unread.scanned + messages.scanned + releasedEvidence, true)
    return { expiredEvents: expiredEvents.count, expiredRequests: expiredRequests.count, repairedUnread: unread.repaired, scannedUnread: unread.scanned, releasedEvidence, deletedMessages: messages.deleted, scannedConversations: messages.scanned }
  } catch (error) {
    chatMetrics.maintenance(0, false)
    throw error
  }
}
