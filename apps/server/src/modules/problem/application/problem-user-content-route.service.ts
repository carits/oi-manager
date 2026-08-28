import crypto from 'crypto'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../../prisma'
import { fileService } from '../../../lib/storage'
import { canViewProblem } from '../problem.access'
import {
  listContentOptions,
  publicOption,
  type ContentKind,
} from '../problem.content.service'

const MAX_MARKDOWN_BYTES = 1024 * 1024

export class ProblemUserContentRouteError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new ProblemUserContentRouteError(statusCode, code, message)
}

export function parseUserContentKind(value: string): ContentKind {
  if (value !== 'statement' && value !== 'solution') {
    fail(404, 'CONTENT_KIND_NOT_FOUND', '题目或内容类型不存在')
  }
  return value
}

async function requireVisibleProblem(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canViewProblem(user, problem)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  return problem
}

export async function getMyProblemContent(user: JwtPayload, problemId: string) {
  const problem = await requireVisibleProblem(user, problemId)
  const contents = await prisma.userProblemContent.findMany({
    where: { problemId: problem.id, userId: user.userId, deletedAt: null },
    orderBy: { kind: 'asc' },
  })
  return {
    contents: contents.map(item => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      format: item.format,
      language: item.language,
      content: item.content,
      fileId: item.fileId,
      fileUrl: item.fileId ? `/api/files/${item.fileId}/download` : null,
      revision: item.revision,
      updatedAt: item.updatedAt.toISOString(),
      shareKeys: item.visibility === 'public' ? ['platform'] : [],
    })),
    shareTargets: [],
  }
}

export async function getProblemContentOptions(user: JwtPayload, problemId: string) {
  const problem = await requireVisibleProblem(user, problemId)
  const options = await listContentOptions(
    problem.id,
    user.userId,
    user.organizationId || null,
  )
  return {
    statement: options.statement.map(publicOption),
    solution: options.solution.map(publicOption),
  }
}

export async function saveProblemMarkdownContent(input: {
  user: JwtPayload
  problemId: string
  kind: ContentKind
  title?: string | null
  language?: string | null
  content: string
}) {
  const problem = await requireVisibleProblem(input.user, input.problemId)
  if (!input.content.trim()) fail(400, 'CONTENT_REQUIRED', '内容不能为空')
  if (Buffer.byteLength(input.content, 'utf8') > MAX_MARKDOWN_BYTES) {
    fail(400, 'CONTENT_TOO_LARGE', 'Markdown 内容不能超过 1MB')
  }
  const existing = await prisma.userProblemContent.findFirst({
    where: {
      problemId: problem.id,
      userId: input.user.userId,
      kind: input.kind,
      deletedAt: null,
    },
  })
  const saved = existing
    ? await prisma.userProblemContent.update({
        where: { id: existing.id },
        data: {
          title: input.kind === 'statement' ? input.title?.trim() || null : null,
          format: 'markdown',
          language: input.language || 'zh',
          content: input.content,
          fileId: null,
          revision: { increment: 1 },
        },
      })
    : await prisma.userProblemContent.create({
        data: {
          id: crypto.randomUUID(),
          problemId: problem.id,
          userId: input.user.userId,
          kind: input.kind,
          title: input.kind === 'statement' ? input.title?.trim() || null : null,
          format: 'markdown',
          language: input.language || 'zh',
          content: input.content,
          revision: 1,
        },
      })
  if (existing?.fileId) await fileService.softDelete(existing.fileId).catch(() => undefined)
  return { id: saved.id, revision: saved.revision }
}

export async function saveProblemPdfContent(input: {
  user: JwtPayload
  problemId: string
  kind: ContentKind
  title?: unknown
  language?: unknown
  file?: Express.Multer.File
}) {
  const problem = await requireVisibleProblem(input.user, input.problemId)
  if (!input.file) fail(400, 'PDF_REQUIRED', '题目、内容类型或 PDF 无效')
  const existing = await prisma.userProblemContent.findFirst({
    where: {
      problemId: problem.id,
      userId: input.user.userId,
      kind: input.kind,
      deletedAt: null,
    },
  })
  const uploaded = await fileService.uploadFromMulter(input.file, {
    category: 'pdf',
    ownerType: 'user',
    ownerId: input.user.userId,
    isPublic: false,
  })
  try {
    const saved = existing
      ? await prisma.userProblemContent.update({
          where: { id: existing.id },
          data: {
            title: input.kind === 'statement'
              ? String(input.title || '').trim() || null
              : null,
            format: 'pdf',
            language: typeof input.language === 'string' ? input.language : null,
            content: null,
            fileId: uploaded.id,
            revision: { increment: 1 },
          },
        })
      : await prisma.userProblemContent.create({
          data: {
            id: crypto.randomUUID(),
            problemId: problem.id,
            userId: input.user.userId,
            kind: input.kind,
            title: input.kind === 'statement'
              ? String(input.title || '').trim() || null
              : null,
            format: 'pdf',
            language: typeof input.language === 'string' ? input.language : null,
            fileId: uploaded.id,
            revision: 1,
          },
        })
    if (existing?.fileId && existing.fileId !== uploaded.id) {
      await fileService.softDelete(existing.fileId).catch(() => undefined)
    }
    return {
      id: saved.id,
      revision: saved.revision,
      fileUrl: `/api/files/${uploaded.id}/download`,
    }
  } catch (error) {
    await fileService.softDelete(uploaded.id).catch(() => undefined)
    throw error
  }
}

export async function updateProblemContentVisibility(input: {
  user: JwtPayload
  problemId: string
  kind: ContentKind
  shareKeys: unknown
}) {
  const problem = await requireVisibleProblem(input.user, input.problemId)
  const content = await prisma.userProblemContent.findFirst({
    where: {
      problemId: problem.id,
      userId: input.user.userId,
      kind: input.kind,
      deletedAt: null,
    },
  })
  if (!content) fail(404, 'PERSONAL_CONTENT_NOT_FOUND', '请先保存个人内容')
  const shareKeys = Array.isArray(input.shareKeys)
    ? input.shareKeys.map(value => String(value))
    : []
  if (shareKeys.some(key => key !== 'platform')) {
    fail(400, 'INVALID_CONTENT_VISIBILITY', '仅支持私有或全平台公开')
  }
  await prisma.userProblemContent.update({
    where: { id: content.id },
    data: { visibility: shareKeys.includes('platform') ? 'public' : 'private' },
  })
}

export async function deleteMyProblemContent(input: {
  user: JwtPayload
  problemId: string
  kind: ContentKind
}) {
  const problem = await requireVisibleProblem(input.user, input.problemId)
  const content = await prisma.userProblemContent.findFirst({
    where: {
      problemId: problem.id,
      userId: input.user.userId,
      kind: input.kind,
      deletedAt: null,
    },
  })
  if (!content) fail(404, 'PERSONAL_CONTENT_NOT_FOUND', '个人内容不存在')
  await prisma.userProblemContent.update({
    where: { id: content.id },
    data: { deletedAt: new Date() },
  })
  if (content.fileId) await fileService.softDelete(content.fileId).catch(() => undefined)
}
