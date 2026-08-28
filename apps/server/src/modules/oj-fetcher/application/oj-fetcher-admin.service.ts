import crypto from 'crypto'
import { isKnownPlatform } from '../../../oj-adapters'
import { parsePagination, paginatedResponse } from '../../../lib/pagination'
import { prisma } from '../../../prisma'

const MAX_BATCH_PROBLEM_IDS = 200
const MAX_COOKIE_CONFIG_BYTES = 64 * 1024

export class OjFetcherAdminError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

function fail(statusCode: number, message: string): never { throw new OjFetcherAdminError(statusCode, message) }

function requirePlatform(platform: string) {
  if (!isKnownPlatform(platform)) fail(400, `不支持的 OJ 平台: ${platform}`)
}

function cookieSummary(platform: string, cookies: Record<string, string>, lastUsedAt: Date | null | undefined) {
  return {
    platform,
    configured: Object.keys(cookies).length > 0,
    cookieNames: Object.keys(cookies),
    lastUsedAt: lastUsedAt || null,
  }
}

export async function getOjPlatformConfig(platform: string) {
  requirePlatform(platform)
  const config = await prisma.ojPlatformConfig.findUnique({ where: { platform } })
  let cookies: Record<string, string> = {}
  if (config?.cookies) {
    try { cookies = JSON.parse(config.cookies) } catch { cookies = {} }
  }
  return cookieSummary(platform, cookies, config?.lastUsedAt)
}

export async function updateOjPlatformConfig(platform: string, rawCookies: unknown) {
  requirePlatform(platform)
  if (rawCookies != null && (typeof rawCookies !== 'object' || Array.isArray(rawCookies) ||
      Object.values(rawCookies).some(value => typeof value !== 'string'))) {
    fail(400, 'Cookie 配置必须是字符串键值对象')
  }
  const cookies = Object.fromEntries(
    Object.entries((rawCookies || {}) as Record<string, string>)
      .map(([key, value]) => [key.trim(), value.trim()]).filter(([key, value]) => key && value),
  )
  const serialized = Object.keys(cookies).length ? JSON.stringify(cookies) : null
  if (serialized && Buffer.byteLength(serialized, 'utf8') > MAX_COOKIE_CONFIG_BYTES) fail(400, 'Cookie 配置过大')
  const config = await prisma.ojPlatformConfig.upsert({
    where: { platform },
    update: { cookies: serialized, lastUsedAt: new Date() },
    create: { id: crypto.randomUUID(), platform, cookies: serialized, lastUsedAt: new Date() },
  })
  return cookieSummary(platform, cookies, config.lastUsedAt)
}

export async function listOjFetchJobs(query: any) {
  const { page, pageSize, skip } = parsePagination(query)
  const where: any = {}
  if (query.status) where.status = query.status
  if (query.platform) where.platform = query.platform
  if (typeof query.problemId === 'string' && query.problemId) where.problemId = { contains: query.problemId }
  const [jobs, total] = await Promise.all([
    prisma.ojFetchJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    prisma.ojFetchJob.count({ where }),
  ])
  return paginatedResponse(jobs, total, page, pageSize)
}

export async function createOjFetchJobs(platform: unknown, problemIds: unknown) {
  if (typeof platform !== 'string' || !Array.isArray(problemIds) || !problemIds.length) fail(400, '缺少必要参数')
  requirePlatform(platform)
  if (problemIds.length > MAX_BATCH_PROBLEM_IDS || problemIds.some(id => typeof id !== 'string')) {
    fail(400, `题目数量不能超过 ${MAX_BATCH_PROBLEM_IDS}，且题号必须是字符串`)
  }
  const uniqueIds = [...new Set((problemIds as string[]).map(id => id.trim()).filter(Boolean))]
  const existing = await prisma.ojFetchJob.findMany({
    where: { platform, problemId: { in: uniqueIds } }, select: { problemId: true },
  })
  const existingIds = new Set(existing.map(job => job.problemId))
  const results = await prisma.$transaction(async tx => {
    const output = []
    for (const problemId of uniqueIds) {
      if (existingIds.has(problemId)) {
        await tx.ojFetchJob.update({
          where: { platform_problemId: { platform, problemId } },
          data: { status: 'pending', message: null, attachmentStatus: null },
        })
        output.push({ problemId, status: 'pending', isNew: false, reset: true })
      } else {
        const job = await tx.ojFetchJob.create({
          data: { id: crypto.randomUUID(), platform, problemId, status: 'pending' },
        })
        output.push({ problemId, jobId: job.id, status: 'pending', isNew: true })
      }
    }
    return output
  })
  return {
    platform,
    data: {
      total: uniqueIds.length,
      new: results.filter(result => result.isNew).length,
      existing: results.filter(result => !result.isNew).length,
      results,
    },
  }
}

export async function retryOjFetchJob(id: string) {
  const job = await prisma.ojFetchJob.findUnique({ where: { id } })
  if (!job) fail(404, '任务不存在')
  await prisma.ojFetchJob.update({
    where: { id }, data: { status: 'pending', message: null, attachmentStatus: null },
  })
  return { platform: job.platform }
}

export async function deleteOjFetchJob(id: string) {
  const result = await prisma.ojFetchJob.deleteMany({ where: { id } })
  if (!result.count) fail(404, '任务不存在')
}
