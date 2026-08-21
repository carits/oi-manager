import crypto from 'crypto'
import { prisma } from '../../prisma'
import { fileService } from '../../lib/storage'

export const MAX_STATEMENT_NAME = 80
export const MAX_STATEMENT_MARKDOWN_BYTES = 1024 * 1024

export function normalizeStatementName(value: unknown) {
  const name = String(value || '').normalize('NFKC').trim()
  if (!name || name.length > MAX_STATEMENT_NAME) throw new Error('题面名称长度必须为 1～80 个字符')
  return { name, nameKey: name.toLocaleLowerCase('zh-CN') }
}

export function serializeStatementVersion(item: any, currentUserId: string) {
  return {
    id: item.id,
    name: item.name,
    title: item.title,
    language: item.language,
    format: item.format,
    visibility: item.visibility,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    sourceNameSnapshot: item.sourceNameSnapshot,
    sourceAuthorSnapshot: item.sourceAuthorSnapshot,
    authorUserId: item.userId,
    authorUsername: item.User?.username || null,
    isMine: item.userId === currentUserId,
    content: item.content,
    fileUrl: item.fileId ? `/api/problems/${item.problemId}/statement-versions/${item.id}/file` : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

export async function accessibleStatementVersion(id: string, userId: string) {
  const item = await prisma.userProblemContent.findFirst({
    where: { id, kind: 'statement', deletedAt: null, OR: [{ userId }, { visibility: 'public' }] },
    include: { User: { select: { username: true } } },
  })
  return item
}

function managedFileId(url: string | null | undefined) {
  return url?.match(/\/api\/files\/([^/?#]+)\/(?:download|public)/)?.[1] || null
}

async function copyFile(fileId: string, ownerId: string) {
  const source = await fileService.download(fileId)
  return fileService.upload(source.buffer, {
    category: 'pdf', ownerType: 'user', ownerId,
    originalName: source.originalName, mimeType: source.mimeType, isPublic: false,
  })
}

export async function resolveStatementSource(input: {
  problemId: string
  userId: string
  sourceType: 'canonical' | 'user' | 'blank'
  sourceId?: string | null
}) {
  if (input.sourceType === 'blank') return {
    content: '', fileId: null as string | null, format: 'markdown', language: 'zh',
    sourceId: null, sourceName: null, sourceAuthor: null, title: null,
  }
  if (input.sourceType === 'user') {
    if (!input.sourceId) throw new Error('请选择来源题面')
    const source = await accessibleStatementVersion(input.sourceId, input.userId)
    if (!source || source.problemId !== input.problemId) throw new Error('来源题面不存在或不可访问')
    return {
      content: source.content || '', fileId: source.fileId, format: source.format, language: source.language || 'zh',
      sourceId: source.id, sourceName: source.name, sourceAuthor: source.User.username, title: source.title,
    }
  }
  const problem = await prisma.problem.findUnique({
    where: { id: input.problemId }, include: { ProblemStatement: { where: { type: 'statement', isVisible: true } } },
  })
  if (!problem) throw new Error('题目不存在')
  if (input.sourceId === 'description') return {
    content: problem.description || '', fileId: null, format: 'markdown', language: 'zh',
    sourceId: 'description', sourceName: '官方题面', sourceAuthor: 'System', title: problem.title,
  }
  const source = problem.ProblemStatement.find(item => item.id === input.sourceId)
  if (!source) throw new Error('官方题面不存在')
  return {
    content: source.content || '', fileId: managedFileId(source.fileUrl), format: source.format,
    language: source.language || 'zh', sourceId: source.id,
    sourceName: source.language === 'zh' ? '官方中文' : source.language === 'en' ? 'Official English' : '官方题面',
    sourceAuthor: 'System', title: problem.title,
  }
}

export async function createStatementVersion(input: {
  problemId: string
  userId: string
  name: unknown
  language?: string | null
  visibility?: string
  format?: string
  sourceType: 'canonical' | 'user' | 'blank'
  sourceId?: string | null
}) {
  const { name, nameKey } = normalizeStatementName(input.name)
  if (!['private', 'public'].includes(input.visibility || 'private')) throw new Error('题面可见性无效')
  const duplicate = await prisma.userProblemContent.findFirst({
    where: { problemId: input.problemId, userId: input.userId, kind: 'statement', nameKey, deletedAt: null },
    select: { id: true },
  })
  if (duplicate) throw Object.assign(new Error('同名题面已经存在'), { code: 'P2002' })
  const source = await resolveStatementSource(input)
  const id = crypto.randomUUID()
  let fileId: string | null = null
  // 空白版本没有可复制的 PDF；必须先创建 Markdown，再由专用上传接口切换为 PDF。
  const format = source.format === 'pdf' && source.fileId ? 'pdf' : 'markdown'
  if (format === 'pdf' && source.fileId) fileId = (await copyFile(source.fileId, input.userId)).id
  try {
    return await prisma.userProblemContent.create({
      data: {
        id, problemId: input.problemId, userId: input.userId, kind: 'statement', name, nameKey,
        title: source.title, language: input.language || source.language, format,
        content: format === 'markdown' ? source.content : null, fileId,
        visibility: input.visibility || 'private', sourceType: input.sourceType, sourceId: source.sourceId,
        sourceNameSnapshot: source.sourceName, sourceAuthorSnapshot: source.sourceAuthor,
      },
      include: { User: { select: { username: true } } },
    })
  } catch (error) {
    if (fileId) await fileService.softDelete(fileId)
    throw error
  }
}

export async function updateStatementMetadata(problemId: string, id: string, userId: string, input: any) {
  const current = await prisma.userProblemContent.findFirst({ where: { id, problemId, userId, kind: 'statement', deletedAt: null } })
  if (!current) throw new Error('题面版本不存在')
  const name = input.name === undefined ? { name: current.name!, nameKey: current.nameKey! } : normalizeStatementName(input.name)
  const visibility = input.visibility === undefined ? current.visibility : String(input.visibility)
  if (!['private', 'public'].includes(visibility)) throw new Error('题面可见性无效')
  return prisma.userProblemContent.update({
    where: { id }, data: { name: name.name, nameKey: name.nameKey, visibility, language: input.language ?? current.language },
    include: { User: { select: { username: true } } },
  })
}

export async function updateStatementMarkdown(problemId: string, id: string, userId: string, content: string, title?: string | null) {
  const current = await prisma.userProblemContent.findFirst({ where: { id, problemId, userId, kind: 'statement', deletedAt: null } })
  if (!current) throw new Error('题面版本不存在')
  if (!content.trim()) throw new Error('题面内容不能为空')
  if (Buffer.byteLength(content, 'utf8') > MAX_STATEMENT_MARKDOWN_BYTES) throw new Error('Markdown 内容不能超过 1MB')
  const updated = await prisma.userProblemContent.update({
    where: { id }, data: { format: 'markdown', content, title: title?.trim() || current.title, fileId: null },
    include: { User: { select: { username: true } } },
  })
  if (current.fileId) await fileService.softDelete(current.fileId)
  return updated
}
