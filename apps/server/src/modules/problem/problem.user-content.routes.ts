import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { canViewProblem } from './problem.access'
import { fileService } from '../../lib/storage'
import { STORAGE_ROOT } from '../../config/storage'
import { listContentOptions, publicOption, type ContentKind } from './problem.content.service'

export const problemUserContentRouter = Router()
const KINDS = new Set<ContentKind>(['statement', 'solution'])
const MAX_MARKDOWN_BYTES = 1024 * 1024
const tempDir = path.join(STORAGE_ROOT, 'temp/uploads')
fs.mkdirSync(tempDir, { recursive: true })

const pdfUpload = multer({
  dest: tempDir,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf'),
})

function parseKind(value: string): ContentKind | null {
  return KINDS.has(value as ContentKind) ? value as ContentKind : null
}

async function visibleProblem(req: any, id: string) {
  const problem = await prisma.problem.findUnique({ where: { id } })
  return problem && canViewProblem(req.user, problem) ? problem : null
}

export async function serializeMyContent(problemId: string, userId: string) {
  const contents = await prisma.userProblemContent.findMany({
    where: { problemId, userId, deletedAt: null }, orderBy: { kind: 'asc' },
  })
  return {
    contents: contents.map(item => ({
      id: item.id, kind: item.kind, title: item.title, format: item.format, language: item.language,
      content: item.content, fileId: item.fileId, fileUrl: item.fileId ? `/api/files/${item.fileId}/download` : null,
      revision: item.revision, updatedAt: item.updatedAt.toISOString(), shareKeys: item.visibility === 'public' ? ['platform'] : [],
    })),
    shareTargets: [],
  }
}

export async function saveMarkdownContent(input: {
  problemId: string
  userId: string
  kind: ContentKind
  title?: string | null
  language?: string | null
  content: string
}) {
  if (!input.content.trim()) throw new Error('内容不能为空')
  if (Buffer.byteLength(input.content, 'utf8') > MAX_MARKDOWN_BYTES) throw new Error('Markdown 内容不能超过 1MB')
  const existing = await prisma.userProblemContent.findFirst({
    where: { problemId: input.problemId, userId: input.userId, kind: input.kind, deletedAt: null },
  })
  const saved = existing ? await prisma.userProblemContent.update({
    where: { id: existing.id }, data: {
      title: input.kind === 'statement' ? input.title?.trim() || null : null,
      format: 'markdown', language: input.language || 'zh', content: input.content, fileId: null,
      revision: { increment: 1 },
    },
  }) : await prisma.userProblemContent.create({
    data: {
      id: crypto.randomUUID(), problemId: input.problemId, userId: input.userId, kind: input.kind,
      title: input.kind === 'statement' ? input.title?.trim() || null : null,
      format: 'markdown', language: input.language || 'zh', content: input.content, revision: 1,
    },
  })
  if (existing?.fileId) await fileService.softDelete(existing.fileId)
  return saved
}

export async function replaceContentShares(contentId: string, userId: string, shareKeys: string[]) {
  const content = await prisma.userProblemContent.findUnique({ where: { id: contentId } })
  if (!content || content.userId !== userId) throw new Error('个人内容不存在')
  if (shareKeys.some(key => key !== 'platform')) throw new Error('仅支持私有或全平台公开')
  await prisma.userProblemContent.update({ where: { id: contentId }, data: { visibility: shareKeys.includes('platform') ? 'public' : 'private' } })
}

problemUserContentRouter.get('/:id/my-content', authenticate, asyncHandler(async (req: any, res) => {
  const problem = await visibleProblem(req, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  res.json({ success: true, data: await serializeMyContent(problem.id, req.user.userId) })
}))

problemUserContentRouter.get('/:id/content-options', authenticate, asyncHandler(async (req: any, res) => {
  const problem = await visibleProblem(req, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const options = await listContentOptions(problem.id, req.user.userId, req.user.organizationId || null)
  res.json({
    success: true,
    data: { statement: options.statement.map(publicOption), solution: options.solution.map(publicOption) },
  })
}))

problemUserContentRouter.put('/:id/my-content/:kind', authenticate, asyncHandler(async (req: any, res) => {
  const problem = await visibleProblem(req, req.params.id)
  const kind = parseKind(req.params.kind)
  if (!problem || !kind) return res.status(404).json({ success: false, message: '题目或内容类型不存在' })
  try {
    const saved = await saveMarkdownContent({
      problemId: problem.id, userId: req.user.userId, kind,
      title: req.body?.title, language: req.body?.language, content: String(req.body?.content || ''),
    })
    res.json({ success: true, data: { id: saved.id, revision: saved.revision } })
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message })
  }
}))

problemUserContentRouter.post('/:id/my-content/:kind/pdf', authenticate, pdfUpload.single('file'), asyncHandler(async (req: any, res) => {
  const problem = await visibleProblem(req, req.params.id)
  const kind = parseKind(req.params.kind)
  if (!problem || !kind || !req.file) {
    if (req.file?.path) fs.unlinkSync(req.file.path)
    return res.status(400).json({ success: false, message: '题目、内容类型或 PDF 无效' })
  }
  const existing = await prisma.userProblemContent.findFirst({ where: { problemId: problem.id, userId: req.user.userId, kind, deletedAt: null } })
  const uploaded = await fileService.uploadFromMulter(req.file, {
    category: 'pdf', ownerType: 'user', ownerId: req.user.userId, isPublic: false,
  })
  const saved = existing ? await prisma.userProblemContent.update({
    where: { id: existing.id }, data: {
      title: kind === 'statement' ? String(req.body?.title || '').trim() || null : null,
      format: 'pdf', language: req.body?.language || null, content: null, fileId: uploaded.id,
      revision: { increment: 1 },
    },
  }) : await prisma.userProblemContent.create({ data: {
      id: crypto.randomUUID(), problemId: problem.id, userId: req.user.userId, kind,
      title: kind === 'statement' ? String(req.body?.title || '').trim() || null : null,
      format: 'pdf', language: req.body?.language || null, fileId: uploaded.id, revision: 1,
    } })
  if (existing?.fileId && existing.fileId !== uploaded.id) await fileService.softDelete(existing.fileId)
  res.json({ success: true, data: { id: saved.id, revision: saved.revision, fileUrl: `/api/files/${uploaded.id}/download` } })
}))

problemUserContentRouter.put('/:id/my-content/:kind/shares', authenticate, asyncHandler(async (req: any, res) => {
  const problem = await visibleProblem(req, req.params.id)
  const kind = parseKind(req.params.kind)
  if (!problem || !kind) return res.status(404).json({ success: false, message: '题目或内容类型不存在' })
  const content = await prisma.userProblemContent.findFirst({ where: { problemId: problem.id, userId: req.user.userId, kind, deletedAt: null } })
  if (!content) return res.status(404).json({ success: false, message: '请先保存个人内容' })
  try {
    await replaceContentShares(content.id, req.user.userId, Array.isArray(req.body?.shareKeys) ? req.body.shareKeys : [])
    res.json({ success: true })
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message })
  }
}))

problemUserContentRouter.delete('/:id/my-content/:kind', authenticate, asyncHandler(async (req: any, res) => {
  const problem = await visibleProblem(req, req.params.id)
  const kind = parseKind(req.params.kind)
  if (!problem || !kind) return res.status(404).json({ success: false, message: '题目或内容类型不存在' })
  const content = await prisma.userProblemContent.findFirst({ where: { problemId: problem.id, userId: req.user.userId, kind, deletedAt: null } })
  if (!content) return res.status(404).json({ success: false, message: '个人内容不存在' })
  await prisma.userProblemContent.delete({ where: { id: content.id } })
  if (content.fileId) await fileService.softDelete(content.fileId)
  res.json({ success: true })
}))
