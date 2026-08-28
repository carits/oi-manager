import crypto from 'crypto'
import type { OjProblem } from '../../../oj-adapters'
import { prisma } from '../../../prisma'
import { canModifyProblem, canViewProblem } from '../../problem/problem.access'

export class OjFetcherQueueError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

export async function getOjFetchCookies(platform: string): Promise<Record<string, string>> {
  const config = await prisma.ojPlatformConfig.findUnique({ where: { platform } })
  if (!config?.cookies) return {}
  try {
    const parsed = JSON.parse(config.cookies)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Claim one pending job using a database compare-and-set. Unlike an in-memory
 * mutex, this is safe while blue and green API/worker processes overlap.
 */
export async function claimNextOjFetchJob(platform: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = await prisma.ojFetchJob.findFirst({
      where: { platform, status: 'pending' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    if (!candidate) return null
    const claimed = await prisma.ojFetchJob.updateMany({
      where: { id: candidate.id, status: 'pending' },
      data: { status: 'fetching', message: null, updatedAt: new Date() },
    })
    if (claimed.count === 1) return { ...candidate, status: 'fetching' }
  }
  return null
}

export async function recoverStaleOjFetchJobs(maxAgeMs = 15 * 60_000) {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const recovered = await prisma.ojFetchJob.updateMany({
    where: { status: 'fetching', updatedAt: { lt: cutoff } },
    data: { status: 'pending', message: '后台进程中断，任务已自动重新排队', updatedAt: new Date() },
  })
  return recovered.count
}

export async function listPendingOjFetchPlatforms() {
  const rows = await prisma.ojFetchJob.findMany({
    where: { status: 'pending' },
    distinct: ['platform'],
    select: { platform: true },
    orderBy: { platform: 'asc' },
  })
  return rows.map(row => row.platform)
}

export async function failOjFetchJob(id: string, message: string) {
  await prisma.ojFetchJob.updateMany({
    where: { id, status: 'fetching' },
    data: { status: 'failed', message, updatedAt: new Date() },
  })
}

export async function completeOjFetchJob(
  id: string,
  problemId: string,
  hasAttachment: boolean,
  attachmentStatus: string | null = null,
  message: string | null = null,
) {
  await prisma.ojFetchJob.updateMany({
    where: { id, status: 'fetching' },
    data: {
      status: 'success',
      createdProblemId: problemId,
      hasAttachment,
      attachmentStatus,
      message,
      updatedAt: new Date(),
    },
  })
}

export async function updateOjFetchAttachmentStatus(id: string, status: string, message: string | null = null) {
  await prisma.ojFetchJob.updateMany({
    where: { id, status: { in: ['fetching', 'success'] } },
    data: { attachmentStatus: status, message, updatedAt: new Date() },
  })
}

function statementRows(problemId: string, problemData: OjProblem) {
  return (problemData.statements || []).map(statement => ({
    id: crypto.randomUUID(),
    problemId,
    type: statement.type,
    format: statement.format,
    language: statement.language || null,
    content: statement.content || null,
    fileUrl: statement.fileUrl || null,
    isVisible: statement.isVisible,
  }))
}

/** Persist the problem and its statement set atomically. */
export async function persistFetchedProblem(platform: string, remoteProblemId: string, problemData: OjProblem) {
  return prisma.$transaction(async tx => {
    const existing = await tx.problem.findFirst({
      where: { libraryScope: 'platform', platform, problemId: remoteProblemId },
    })
    const pdfStatement = problemData.statements?.find(statement => statement.format === 'pdf' && statement.fileUrl)
    const common = {
      title: problemData.title,
      description: problemData.description,
      statementType: pdfStatement ? 'pdf' : 'markdown',
      statementPdfUrl: pdfStatement?.fileUrl || null,
      timeLimit: problemData.timeLimit,
      memoryLimit: problemData.memoryLimit,
      difficulty: problemData.difficulty,
      allowedLanguages: problemData.allowedLanguages ? JSON.stringify(problemData.allowedLanguages) : null,
    }

    let problemId: string
    let created = false
    if (existing) {
      problemId = existing.id
      await tx.problem.update({ where: { id: problemId }, data: common })
      await tx.problemStatement.deleteMany({ where: { problemId } })
    } else {
      const owner = await tx.user.findFirst({
        where: { role: { in: ['super_admin', 'platform_admin'] }, status: 'active' },
        orderBy: { createdAt: 'asc' },
      })
      if (!owner) throw new Error('没有可用的管理员用户作为题目所有者')
      problemId = crypto.randomUUID()
      created = true
      await tx.problem.create({
        data: {
          id: problemId,
          platform,
          problemId: remoteProblemId,
          ...common,
          ojBindings: JSON.stringify([{ platform, problemId: remoteProblemId, url: problemData.source.url }]),
          visibility: 'public',
          ownerType: 'admin',
          ownerId: owner.id,
          libraryScope: 'platform',
          libraryKey: 'platform',
          organizationId: null,
          status: 'published',
          publishedAt: new Date(),
        },
      })
    }

    const statements = statementRows(problemId, problemData)
    if (statements.length) await tx.problemStatement.createMany({ data: statements })
    const oldImageIds = created ? [] : (await tx.file.findMany({
      where: { ownerType: 'problem', ownerId: problemId, category: 'image' },
      select: { id: true },
    })).map(file => file.id)
    return { problemId, created, oldImageIds, statementCount: statements.length }
  })
}

export async function getProblemStatementsForImageProcessing(problemId: string) {
  return prisma.problemStatement.findMany({ where: { problemId } })
}

export async function updateFetchedProblemDescription(problemId: string, description: string) {
  await prisma.problem.update({ where: { id: problemId }, data: { description } })
}

export async function updateFetchedStatementContent(statementId: string, content: string) {
  await prisma.problemStatement.update({ where: { id: statementId }, data: { content } })
}

export async function requireModifiableProblem(user: any, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canViewProblem(user, problem)) throw new OjFetcherQueueError(404, '题目不存在')
  if (!canModifyProblem(user, problem)) throw new OjFetcherQueueError(403, '没有权限修改该题目')
  return problem
}

export async function replaceProblemAttachment(
  problemId: string,
  filename: string,
  fileSize: number,
  fileUrl: string,
  description: string,
) {
  return prisma.$transaction(async tx => {
    const existing = await tx.problemAttachment.findFirst({ where: { problemId, fileName: filename } })
    if (existing) await tx.problemAttachment.delete({ where: { id: existing.id } })
    const attachment = await tx.problemAttachment.create({
      data: { id: crypto.randomUUID(), problemId, fileName: filename, fileSize, fileUrl, description },
    })
    return {
      attachment,
      oldFileId: existing?.fileUrl.startsWith('/api/files/') ? existing.fileUrl.split('/')[3] : null,
    }
  })
}

export async function findExistingProblemImage(problemId: string, filename: string) {
  return prisma.file.findFirst({
    where: { ownerType: 'problem', ownerId: problemId, category: 'image', originalName: filename },
    select: { id: true },
  })
}
