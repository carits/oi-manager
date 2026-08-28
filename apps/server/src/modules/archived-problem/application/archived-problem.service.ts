import crypto from 'crypto'
import { paginatedResponse } from '../../../lib/pagination'
import logger from '../../../lib/logger'
import { prisma } from '../../../prisma'

export class ArchivedProblemError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
    this.name = 'ArchivedProblemError'
  }
}

function notFound(): never { throw new ArchivedProblemError(404, '归档记录不存在') }

export async function listArchivedProblems(userId: string, query: any, page: number, pageSize: number, skip: number) {
  const platform = typeof query.platform === 'string' ? query.platform : undefined
  const keyword = typeof query.keyword === 'string' ? query.keyword : undefined
  const where = {
    userId,
    ...(platform ? { platform } : {}),
    ...(keyword ? { OR: [
      { title: { contains: keyword, mode: 'insensitive' as const } },
      { problemId: { contains: keyword, mode: 'insensitive' as const } },
    ] } : {}),
  }
  const [items, total] = await Promise.all([
    prisma.userArchivedProblem.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    prisma.userArchivedProblem.count({ where }),
  ])
  return paginatedResponse(items, total, page, pageSize)
}

export async function getArchivedProblemStats(userId: string) {
  const [total, byPlatform] = await Promise.all([
    prisma.userArchivedProblem.count({ where: { userId } }),
    prisma.userArchivedProblem.groupBy({ by: ['platform'], where: { userId }, _count: { id: true } }),
  ])
  return { total, byPlatform: byPlatform.map(row => ({ platform: row.platform, count: row._count.id })) }
}

export async function getArchivedProblem(userId: string, id: string) {
  const item = await prisma.userArchivedProblem.findFirst({ where: { id, userId } })
  if (!item) notFound()
  return item
}

export async function archiveProblem(userId: string, body: any) {
  const { platform, problemId, title, difficulty, tags, solvedAt, sourceUrl, note } = body
  if (!platform || !problemId) throw new ArchivedProblemError(400, '平台和题号不能为空')
  const existing = await prisma.userArchivedProblem.findUnique({
    where: { userId_platform_problemId: { userId, platform, problemId } },
  })
  if (existing) {
    const updated = await prisma.userArchivedProblem.update({
      where: { id: existing.id },
      data: {
        title: title || existing.title,
        difficulty: difficulty || existing.difficulty,
        tags: tags || existing.tags,
        solvedAt: solvedAt ? new Date(solvedAt) : existing.solvedAt,
        sourceUrl: sourceUrl || existing.sourceUrl,
        note: note ?? existing.note,
      },
    })
    return { item: updated, created: false }
  }
  const item = await prisma.userArchivedProblem.create({
    data: {
      id: crypto.randomUUID(), userId, platform, problemId, title, difficulty,
      tags: tags ? JSON.stringify(tags) : null,
      solvedAt: solvedAt ? new Date(solvedAt) : null,
      sourceUrl, note,
    },
  })
  logger.info('archived_problem_created', { action: 'archive_problem', userId, metadata: { platform, problemId } })
  return { item, created: true }
}

export async function updateArchivedProblem(userId: string, id: string, body: any) {
  const existing = await prisma.userArchivedProblem.findFirst({ where: { id, userId } })
  if (!existing) notFound()
  return prisma.userArchivedProblem.update({
    where: { id },
    data: {
      title: body.title ?? existing.title,
      difficulty: body.difficulty ?? existing.difficulty,
      tags: body.tags ? JSON.stringify(body.tags) : existing.tags,
      note: body.note ?? existing.note,
    },
  })
}

export async function deleteArchivedProblem(userId: string, id: string) {
  const existing = await prisma.userArchivedProblem.findFirst({ where: { id, userId } })
  if (!existing) notFound()
  await prisma.userArchivedProblem.delete({ where: { id } })
  logger.info('archived_problem_deleted', {
    action: 'unarchive_problem', userId,
    metadata: { platform: existing.platform, problemId: existing.problemId },
  })
}

export async function deleteArchivedProblems(userId: string, ids: unknown) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== 'string')) {
    throw new ArchivedProblemError(400, '请提供要删除的归档ID列表')
  }
  const result = await prisma.userArchivedProblem.deleteMany({ where: { id: { in: ids }, userId } })
  logger.info('archived_problems_bulk_deleted', { action: 'bulk_unarchive', userId, metadata: { count: result.count } })
  return result.count
}
