import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { ChatError, fail } from './chat-errors'

export async function createReport(userId: string, body: any) {
  const messageId = typeof body.messageId === 'string' ? body.messageId : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 100) : ''
  const details = typeof body.details === 'string' ? body.details.trim().slice(0, 2000) : null
  if (!messageId || !reason) fail(422, 'INVALID_CHAT_REPORT', '请选择举报原因')
  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chat-report:${userId}`}, 0))`
      if (await tx.chatReport.count({ where: { reporterUserId: userId, createdAt: { gte: new Date(Date.now() - 86400000) } } }) >= 10) fail(429, 'CHAT_REPORT_RATE_LIMITED', '举报提交过于频繁')
      const message = await tx.directMessage.findUnique({ where: { id: messageId }, include: { Conversation: true } })
      if (!message) throw new ChatError(404, 'MESSAGE_NOT_REPORTABLE', '消息不存在或不可举报')
      if (![message.Conversation.userLowId, message.Conversation.userHighId].includes(userId) || message.senderUserId === userId) fail(404, 'MESSAGE_NOT_REPORTABLE', '消息不存在或不可举报')
      const context = await tx.directMessage.findMany({ where: { conversationId: message.conversationId, seq: { gte: Math.max(1, message.seq - 10), lte: message.seq + 10 } }, orderBy: { seq: 'asc' }, select: { id: true, senderUserId: true, seq: true, content: true, createdAt: true, Sender: { select: { username: true } } } })
      return tx.chatReport.create({ data: { id: randomUUID(), conversationId: message.conversationId, messageId, reporterUserId: userId, targetUserId: message.senderUserId, reason, details, evidenceSnapshot: context as unknown as Prisma.InputJsonValue, evidenceHoldUntil: new Date(Date.now() + 365 * 86400000) } })
    })
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
    prisma.chatReport.findMany({ where, select: { id: true, reason: true, status: true, createdAt: true, reviewedAt: true, evidenceReleasedAt: true, Reporter: { select: { username: true } }, Target: { select: { username: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
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
    if (!changed.count) {
      const existing = await tx.chatReport.findUnique({ where: { id: reportId } })
      if (!existing) throw new ChatError(404, 'CHAT_REPORT_NOT_FOUND', '举报不存在')
      // Terminal review is idempotent. A retry (including a concurrent retry
      // after the winner commits) returns the stored decision without writing
      // a second audit event.
      if (existing.status === 'resolved' || existing.status === 'dismissed') return existing
      fail(409, 'CHAT_REPORT_ALREADY_PROCESSED', '举报已处理或不存在')
    }
    await tx.platformAuditLog.create({ data: { id: randomUUID(), actorUserId, action: `chat_report_${status}`, targetType: 'ChatReport', targetId: reportId, metadata: { resolutionNote } } })
    return tx.chatReport.findUnique({ where: { id: reportId } })
  })
}
