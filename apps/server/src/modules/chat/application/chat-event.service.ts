import { prisma } from '../../../prisma'
import { fail } from './chat-errors'

export async function eventBacklog(userId: string, afterId: bigint, take = 200) {
  return prisma.chatUserEvent.findMany({ where: { userId, id: { gt: afterId }, expiresAt: { gt: new Date() } }, orderBy: { id: 'asc' }, take })
}

export async function isEventCursorExpired(userId: string, cursor: bigint) {
  if (cursor <= 0n) return false
  return !await prisma.chatUserEvent.findFirst({ where: { userId, id: cursor, expiresAt: { gt: new Date() } }, select: { id: true } })
}

export async function latestEventCursor(userId: string) {
  return (await prisma.chatUserEvent.findFirst({ where: { userId, expiresAt: { gt: new Date() } }, orderBy: { id: 'desc' }, select: { id: true } }))?.id || 0n
}

export async function resolveEventCursor(userId: string, rawCursor?: string) {
  let cursor = 0n
  try { cursor = rawCursor === undefined ? await latestEventCursor(userId) : BigInt(rawCursor) }
  catch { fail(422, 'INVALID_EVENT_CURSOR', '实时事件游标无效') }
  if (cursor < 0n) fail(422, 'INVALID_EVENT_CURSOR', '实时事件游标无效')
  const resync = rawCursor !== undefined && await isEventCursorExpired(userId, cursor)
  return { cursor: resync ? await latestEventCursor(userId) : cursor, resync }
}
