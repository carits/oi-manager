import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../../prisma'
import { fileService } from '../../../lib/storage'
import { canViewProblem } from '../problem.access'
import {
  accessibleStatementVersion,
  createStatementVersion,
  serializeStatementVersion,
  updateStatementMarkdown,
  updateStatementMetadata,
} from '../problem.statement-version.service'

export class ProblemStatementVersionRouteError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new ProblemStatementVersionRouteError(statusCode, code, message)
}

async function requireVisibleProblem(user: JwtPayload, problemId: string, includeStatements = false) {
  const problem = includeStatements
    ? await prisma.problem.findUnique({
        where: { id: problemId },
        include: {
          ProblemStatement: {
            where: { type: 'statement', isVisible: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
    : await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canViewProblem(user, problem)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  return problem
}

function officialVersions(problem: any) {
  const rows = problem.ProblemStatement.map((item: any) => ({
    id: item.id,
    key: `canonical:${item.id}`,
    name: item.language === 'zh'
      ? '官方中文'
      : item.language === 'en'
        ? 'Official English'
        : `官方题面 · ${item.language || '未标注语言'}`,
    title: problem.title,
    language: item.language,
    format: item.format,
    content: item.content,
    fileUrl: item.fileUrl,
    visibility: 'public',
    authorUsername: 'System',
    isOfficial: true,
  }))
  if (problem.description && !rows.some((item: any) => item.content === problem.description)) {
    rows.push({
      id: 'description',
      key: 'canonical:description',
      name: '官方中文',
      title: problem.title,
      language: 'zh',
      format: 'markdown',
      content: problem.description,
      fileUrl: null,
      visibility: 'public',
      authorUsername: 'System',
      isOfficial: true,
    })
  }
  return rows
}

function rethrowStatementError(error: any): never {
  if (error?.code === 'P2002') {
    fail(409, 'STATEMENT_VERSION_EXISTS', '同名题面已经存在')
  }
  fail(400, 'STATEMENT_VERSION_INVALID', error instanceof Error ? error.message : '题面版本无效')
}

export async function listProblemStatementVersions(input: {
  user: JwtPayload
  problemId: string
  pageValue: unknown
  pageSizeValue: unknown
}) {
  const problem = await requireVisibleProblem(input.user, input.problemId, true) as any
  const page = Math.max(1, Number(input.pageValue) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(input.pageSizeValue) || 10))
  const [mine, publicRows, publicTotal] = await Promise.all([
    prisma.userProblemContent.findMany({
      where: {
        problemId: problem.id,
        userId: input.user.userId,
        kind: 'statement',
        deletedAt: null,
      },
      include: { User: { select: { username: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.userProblemContent.findMany({
      where: {
        problemId: problem.id,
        kind: 'statement',
        deletedAt: null,
        visibility: 'public',
        userId: { not: input.user.userId },
      },
      include: { User: { select: { username: true } } },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.userProblemContent.count({
      where: {
        problemId: problem.id,
        kind: 'statement',
        deletedAt: null,
        visibility: 'public',
        userId: { not: input.user.userId },
      },
    }),
  ])
  return {
    official: officialVersions(problem),
    mine: mine.map(item => serializeStatementVersion(item, input.user.userId)),
    public: publicRows.map(item => serializeStatementVersion(item, input.user.userId)),
    publicPagination: { page, pageSize, total: publicTotal },
  }
}

export async function getProblemStatementVersion(
  user: JwtPayload,
  problemId: string,
  versionId: string,
) {
  const problem = await requireVisibleProblem(user, problemId)
  const item = await accessibleStatementVersion(versionId, user.userId)
  if (!item || item.problemId !== problem.id) {
    fail(404, 'STATEMENT_VERSION_NOT_FOUND', '题面版本不存在')
  }
  return serializeStatementVersion(item, user.userId)
}

export async function createProblemStatementVersion(input: {
  user: JwtPayload
  problemId: string
  body: any
}) {
  const problem = await requireVisibleProblem(input.user, input.problemId)
  const sourceType = String(input.body?.source?.type || 'blank') as 'canonical' | 'user' | 'blank'
  if (!['canonical', 'user', 'blank'].includes(sourceType)) {
    fail(400, 'STATEMENT_SOURCE_INVALID', '来源类型无效')
  }
  try {
    const created = await createStatementVersion({
      problemId: problem.id,
      userId: input.user.userId,
      name: input.body?.name,
      language: input.body?.language,
      visibility: input.body?.visibility,
      format: input.body?.format,
      sourceType,
      sourceId: input.body?.source?.id,
    })
    return serializeStatementVersion(created, input.user.userId)
  } catch (error) {
    rethrowStatementError(error)
  }
}

export async function updateProblemStatementMarkdown(input: {
  user: JwtPayload
  problemId: string
  versionId: string
  content: string
  title?: string | null
}) {
  await requireVisibleProblem(input.user, input.problemId)
  try {
    const updated = await updateStatementMarkdown(
      input.problemId,
      input.versionId,
      input.user.userId,
      input.content,
      input.title,
    )
    return serializeStatementVersion(updated, input.user.userId)
  } catch (error) {
    rethrowStatementError(error)
  }
}

export async function updateProblemStatementMetadata(input: {
  user: JwtPayload
  problemId: string
  versionId: string
  body: any
}) {
  await requireVisibleProblem(input.user, input.problemId)
  try {
    const updated = await updateStatementMetadata(
      input.problemId,
      input.versionId,
      input.user.userId,
      input.body || {},
    )
    return serializeStatementVersion(updated, input.user.userId)
  } catch (error) {
    rethrowStatementError(error)
  }
}

export async function replaceProblemStatementPdf(input: {
  user: JwtPayload
  problemId: string
  versionId: string
  title?: unknown
  file?: Express.Multer.File
}) {
  await requireVisibleProblem(input.user, input.problemId)
  const current = await prisma.userProblemContent.findFirst({
    where: {
      id: input.versionId,
      problemId: input.problemId,
      userId: input.user.userId,
      kind: 'statement',
      deletedAt: null,
    },
  })
  if (!current || !input.file) {
    fail(400, 'STATEMENT_PDF_INVALID', '题面版本或 PDF 无效')
  }
  const uploaded = await fileService.uploadFromMulter(input.file, {
    category: 'pdf',
    ownerType: 'user',
    ownerId: input.user.userId,
    isPublic: false,
  })
  try {
    const updated = await prisma.userProblemContent.update({
      where: { id: current.id },
      data: {
        format: 'pdf',
        content: null,
        fileId: uploaded.id,
        title: String(input.title || '').trim() || current.title,
      },
      include: { User: { select: { username: true } } },
    })
    if (current.fileId) await fileService.softDelete(current.fileId).catch(() => undefined)
    return serializeStatementVersion(updated, input.user.userId)
  } catch (error) {
    await fileService.softDelete(uploaded.id).catch(() => undefined)
    throw error
  }
}

export async function downloadProblemStatementVersion(input: {
  user: JwtPayload
  problemId: string
  versionId: string
}) {
  await requireVisibleProblem(input.user, input.problemId)
  const item = await accessibleStatementVersion(input.versionId, input.user.userId)
  if (!item || item.problemId !== input.problemId || !item.fileId) {
    fail(404, 'STATEMENT_PDF_NOT_FOUND', 'PDF 不存在')
  }
  return fileService.download(item.fileId)
}

export async function deleteProblemStatementVersion(input: {
  user: JwtPayload
  problemId: string
  versionId: string
}) {
  await requireVisibleProblem(input.user, input.problemId)
  const item = await prisma.userProblemContent.findFirst({
    where: {
      id: input.versionId,
      problemId: input.problemId,
      userId: input.user.userId,
      kind: 'statement',
      deletedAt: null,
    },
  })
  if (!item) fail(404, 'STATEMENT_VERSION_NOT_FOUND', '题面版本不存在')
  await prisma.userProblemContent.update({
    where: { id: item.id },
    data: { deletedAt: new Date() },
  })
  if (item.fileId) await fileService.softDelete(item.fileId).catch(() => undefined)
}
