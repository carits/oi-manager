import { prisma } from '../../../prisma'

export async function runChatMaintenance() {
  const now = new Date()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const expiredEvents = await prisma.chatUserEvent.deleteMany({ where: { expiresAt: { lte: now } } })
  const expiredRequests = await prisma.friendRequest.updateMany({ where: { status: 'pending', expiresAt: { lte: now } }, data: { status: 'expired', respondedAt: now } })

  let repairedUnread = 0
  const members = await prisma.directConversationMember.findMany({ take: 500, orderBy: { updatedAt: 'asc' } })
  for (const member of members) {
    const expected = await prisma.directMessage.count({ where: { conversationId: member.conversationId, senderUserId: { not: member.userId }, seq: { gt: Math.max(member.lastReadSeq, member.clearedThroughSeq) } } })
    if (expected !== member.unreadCount) {
      await prisma.directConversationMember.update({ where: { id: member.id }, data: { unreadCount: expected } })
      repairedUnread += 1
    }
  }

  let deletedMessages = 0
  const conversations = await prisma.directConversation.findMany({
    where: { Members: { every: { clearedThroughSeq: { gt: 0 } } }, lastMessageAt: { lt: thirtyDaysAgo } },
    include: { Members: { select: { clearedThroughSeq: true } } }, take: 100,
  })
  for (const conversation of conversations) {
    if (conversation.Members.length !== 2) continue
    const throughSeq = Math.min(...conversation.Members.map(member => member.clearedThroughSeq))
    const removed = await prisma.directMessage.deleteMany({ where: { conversationId: conversation.id, seq: { lte: throughSeq }, createdAt: { lt: thirtyDaysAgo }, Reports: { none: {} } } })
    deletedMessages += removed.count
  }
  return { expiredEvents: expiredEvents.count, expiredRequests: expiredRequests.count, repairedUnread, deletedMessages }
}
