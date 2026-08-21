import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { canViewProblem } from './problem.access'
import { STORAGE_ROOT } from '../../config/storage'
import { fileService } from '../../lib/storage'
import {
  accessibleStatementVersion,
  createStatementVersion,
  normalizeStatementName,
  serializeStatementVersion,
  updateStatementMarkdown,
  updateStatementMetadata,
} from './problem.statement-version.service'

export const problemStatementVersionRouter = Router()
const tempDir = path.join(STORAGE_ROOT, 'temp/uploads')
fs.mkdirSync(tempDir, { recursive: true })
const pdfUpload = multer({
  dest: tempDir,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf'),
})

async function visibleProblem(req: any, id: string) {
  const problem = await prisma.problem.findUnique({ where: { id }, include: { ProblemStatement: { where: { type: 'statement', isVisible: true }, orderBy: { createdAt: 'asc' } } } })
  return problem && canViewProblem(req.user, problem) ? problem : null
}

function officialVersions(problem: any) {
  const rows = problem.ProblemStatement.map((item: any) => ({
    id: item.id, key: `canonical:${item.id}`, name: item.language === 'zh' ? '官方中文' : item.language === 'en' ? 'Official English' : `官方题面 · ${item.language || '未标注语言'}`,
    title: problem.title, language: item.language, format: item.format, content: item.content,
    fileUrl: item.fileUrl, visibility: 'public', authorUsername: 'System', isOfficial: true,
  }))
  if (problem.description && !rows.some((item: any) => item.content === problem.description)) rows.push({
    id: 'description', key: 'canonical:description', name: '官方中文', title: problem.title,
    language: 'zh', format: 'markdown', content: problem.description, fileUrl: null,
    visibility: 'public', authorUsername: 'System', isOfficial: true,
  })
  return rows
}

problemStatementVersionRouter.get('/:id/statement-versions', authenticate, asyncHandler(async (req: any, res) => {
  const problem = await visibleProblem(req, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10))
  const [mine, publicRows, publicTotal] = await Promise.all([
    prisma.userProblemContent.findMany({
      where: { problemId: problem.id, userId: req.user.userId, kind: 'statement', deletedAt: null },
      include: { User: { select: { username: true } } }, orderBy: { updatedAt: 'desc' },
    }),
    prisma.userProblemContent.findMany({
      where: { problemId: problem.id, kind: 'statement', deletedAt: null, visibility: 'public', userId: { not: req.user.userId } },
      include: { User: { select: { username: true } } }, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
    }),
    prisma.userProblemContent.count({ where: { problemId: problem.id, kind: 'statement', deletedAt: null, visibility: 'public', userId: { not: req.user.userId } } }),
  ])
  res.json({ success: true, data: {
    official: officialVersions(problem),
    mine: mine.map(item => serializeStatementVersion(item, req.user.userId)),
    public: publicRows.map(item => serializeStatementVersion(item, req.user.userId)),
    publicPagination: { page, pageSize, total: publicTotal },
  } })
}))

problemStatementVersionRouter.get('/:id/statement-versions/:versionId', authenticate, asyncHandler(async (req: any, res) => {
  const problem = await visibleProblem(req, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const item = await accessibleStatementVersion(req.params.versionId, req.user.userId)
  if (!item || item.problemId !== problem.id) return res.status(404).json({ success: false, message: '题面版本不存在' })
  res.json({ success: true, data: serializeStatementVersion(item, req.user.userId) })
}))

problemStatementVersionRouter.post('/:id/statement-versions', authenticate, asyncHandler(async (req: any, res) => {
  const problem = await visibleProblem(req, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  try {
    const sourceType = String(req.body?.source?.type || 'blank') as 'canonical' | 'user' | 'blank'
    if (!['canonical', 'user', 'blank'].includes(sourceType)) throw new Error('来源类型无效')
    const created = await createStatementVersion({
      problemId: problem.id, userId: req.user.userId, name: req.body?.name,
      language: req.body?.language, visibility: req.body?.visibility, format: req.body?.format,
      sourceType, sourceId: req.body?.source?.id,
    })
    res.status(201).json({ success: true, data: serializeStatementVersion(created, req.user.userId) })
  } catch (error: any) {
    res.status(error?.code === 'P2002' ? 409 : 400).json({ success: false, message: error?.code === 'P2002' ? '同名题面已经存在' : error.message })
  }
}))

problemStatementVersionRouter.put('/:id/statement-versions/:versionId/content', authenticate, asyncHandler(async (req: any, res) => {
  try {
    const updated = await updateStatementMarkdown(req.params.id, req.params.versionId, req.user.userId, String(req.body?.content || ''), req.body?.title)
    res.json({ success: true, data: serializeStatementVersion(updated, req.user.userId) })
  } catch (error: any) { res.status(400).json({ success: false, message: error.message }) }
}))

problemStatementVersionRouter.patch('/:id/statement-versions/:versionId', authenticate, asyncHandler(async (req: any, res) => {
  try {
    const updated = await updateStatementMetadata(req.params.id, req.params.versionId, req.user.userId, req.body || {})
    res.json({ success: true, data: serializeStatementVersion(updated, req.user.userId) })
  } catch (error: any) { res.status(error?.code === 'P2002' ? 409 : 400).json({ success: false, message: error?.code === 'P2002' ? '同名题面已经存在' : error.message }) }
}))

problemStatementVersionRouter.post('/:id/statement-versions/:versionId/pdf', authenticate, pdfUpload.single('file'), asyncHandler(async (req: any, res) => {
  const current = await prisma.userProblemContent.findFirst({ where: { id: req.params.versionId, problemId: req.params.id, userId: req.user.userId, kind: 'statement', deletedAt: null } })
  if (!current || !req.file) {
    if (req.file?.path) fs.unlinkSync(req.file.path)
    return res.status(400).json({ success: false, message: '题面版本或 PDF 无效' })
  }
  const uploaded = await fileService.uploadFromMulter(req.file, { category: 'pdf', ownerType: 'user', ownerId: req.user.userId, isPublic: false })
  const updated = await prisma.userProblemContent.update({
    where: { id: current.id }, data: { format: 'pdf', content: null, fileId: uploaded.id, title: String(req.body?.title || '').trim() || current.title },
    include: { User: { select: { username: true } } },
  })
  if (current.fileId) await fileService.softDelete(current.fileId)
  res.json({ success: true, data: serializeStatementVersion(updated, req.user.userId) })
}))

problemStatementVersionRouter.get('/:id/statement-versions/:versionId/file', authenticate, asyncHandler(async (req: any, res) => {
  const item = await accessibleStatementVersion(req.params.versionId, req.user.userId)
  if (!item || item.problemId !== req.params.id || !item.fileId) return res.status(404).json({ success: false, message: 'PDF 不存在' })
  const file = await fileService.download(item.fileId)
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`)
  res.send(file.buffer)
}))

problemStatementVersionRouter.delete('/:id/statement-versions/:versionId', authenticate, asyncHandler(async (req: any, res) => {
  const item = await prisma.userProblemContent.findFirst({ where: { id: req.params.versionId, problemId: req.params.id, userId: req.user.userId, kind: 'statement', deletedAt: null } })
  if (!item) return res.status(404).json({ success: false, message: '题面版本不存在' })
  await prisma.userProblemContent.update({ where: { id: item.id }, data: { deletedAt: new Date() } })
  if (item.fileId) await fileService.softDelete(item.fileId)
  res.json({ success: true })
}))
