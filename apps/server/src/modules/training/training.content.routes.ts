import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { STORAGE_ROOT } from '../../config/storage'
import { fileService } from '../../lib/storage'
import { canAccessTraining, canManageTraining, parseTrainingId, requireTrainingStarted } from './training.helpers'
import {
  activityOrganizationId,
  latestContentSnapshot,
  listContentOptions,
  publicOption,
  selectTrainingProblemContent,
  type ContentKind,
} from '../problem/problem.content.service'
import { replaceContentShares, saveMarkdownContent, serializeMyContent } from '../problem/problem.user-content.routes'

export const trainingContentRouter = Router()
const tempDir = path.join(STORAGE_ROOT, 'temp/uploads')
fs.mkdirSync(tempDir, { recursive: true })
const pdfUpload = multer({
  dest: tempDir,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf'),
})

function kind(value: string): ContentKind | null {
  return value === 'statement' || value === 'solution' ? value : null
}

async function context(trainingId: number, trainingProblemId: string) {
  const training = await prisma.training.findUnique({
    where: { id: trainingId }, include: { Team: { select: { organizationId: true } } },
  })
  const trainingProblem = await prisma.trainingProblem.findUnique({ where: { id: trainingProblemId } })
  if (!training || !trainingProblem || trainingProblem.trainingId !== trainingId) return null
  return { training, trainingProblem }
}

async function requireAccess(req: AuthRequest, res: any, manager = false) {
  const trainingId = parseTrainingId(req.params.id)
  const loaded = await context(trainingId, req.params.trainingProblemId)
  if (!loaded) {
    res.status(404).json({ success: false, message: '活动题目不存在' })
    return null
  }
  const allowed = manager
    ? await canManageTraining(req.user!.userId, loaded.training)
    : await canAccessTraining(req.user!.userId, loaded.training)
  if (!allowed) {
    res.status(403).json({ success: false, message: '无权限' })
    return null
  }
  if (!manager) {
    const notStarted = await requireTrainingStarted(loaded.training, req.user!.userId)
    if (notStarted) {
      res.status(403).json({ success: false, message: notStarted })
      return null
    }
  }
  return loaded
}

trainingContentRouter.get('/trainings/:id/problems/:trainingProblemId/my-content', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const loaded = await requireAccess(req, res)
  if (!loaded) return
  res.json({ success: true, data: await serializeMyContent(loaded.trainingProblem.problemId, req.user!.userId) })
}))

trainingContentRouter.put('/trainings/:id/problems/:trainingProblemId/my-content/:kind', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const loaded = await requireAccess(req, res)
  const contentKind = kind(req.params.kind)
  if (!loaded || !contentKind) return
  try {
    const saved = await saveMarkdownContent({
      problemId: loaded.trainingProblem.problemId, userId: req.user!.userId, kind: contentKind,
      title: req.body?.title, language: req.body?.language, content: String(req.body?.content || ''),
    })
    res.json({ success: true, data: { id: saved.id, revision: saved.revision } })
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message })
  }
}))

trainingContentRouter.post('/trainings/:id/problems/:trainingProblemId/my-content/:kind/pdf', authenticate, pdfUpload.single('file'), asyncHandler(async (req: AuthRequest, res) => {
  const loaded = await requireAccess(req, res)
  const contentKind = kind(req.params.kind)
  if (!loaded || !contentKind || !req.file) {
    if (req.file?.path) fs.unlinkSync(req.file.path)
    return res.status(400).json({ success: false, message: '活动题目、内容类型或 PDF 无效' })
  }
  const problemId = loaded.trainingProblem.problemId
  const userId = req.user!.userId
  const existing = await prisma.userProblemContent.findFirst({ where: { problemId, userId, kind: contentKind, deletedAt: null } })
  const uploaded = await fileService.uploadFromMulter(req.file, {
    category: 'pdf', ownerType: 'user', ownerId: userId, isPublic: false,
  })
  const saved = existing ? await prisma.userProblemContent.update({ where: { id: existing.id }, data: {
      title: contentKind === 'statement' ? String(req.body?.title || '').trim() || null : null,
      format: 'pdf', language: req.body?.language || null, content: null, fileId: uploaded.id,
      revision: { increment: 1 },
    } }) : await prisma.userProblemContent.create({ data: {
      id: crypto.randomUUID(), problemId, userId, kind: contentKind,
      title: contentKind === 'statement' ? String(req.body?.title || '').trim() || null : null,
      format: 'pdf', language: req.body?.language || null, fileId: uploaded.id,
    } })
  if (existing?.fileId && existing.fileId !== uploaded.id) await fileService.softDelete(existing.fileId)
  res.json({ success: true, data: { id: saved.id, revision: saved.revision } })
}))

trainingContentRouter.put('/trainings/:id/problems/:trainingProblemId/my-content/:kind/shares', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const loaded = await requireAccess(req, res)
  const contentKind = kind(req.params.kind)
  if (!loaded || !contentKind) return
  const content = await prisma.userProblemContent.findFirst({ where: { problemId: loaded.trainingProblem.problemId, userId: req.user!.userId, kind: contentKind, deletedAt: null } })
  if (!content) return res.status(404).json({ success: false, message: '请先保存个人内容' })
  try {
    await replaceContentShares(content.id, req.user!.userId, Array.isArray(req.body?.shareKeys) ? req.body.shareKeys : [])
    res.json({ success: true })
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message })
  }
}))

trainingContentRouter.delete('/trainings/:id/problems/:trainingProblemId/my-content/:kind', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const loaded = await requireAccess(req, res)
  const contentKind = kind(req.params.kind)
  if (!loaded || !contentKind) return
  const content = await prisma.userProblemContent.findFirst({ where: {
    problemId: loaded.trainingProblem.problemId, userId: req.user!.userId, kind: contentKind, deletedAt: null,
  } })
  if (!content) return res.status(404).json({ success: false, message: '个人内容不存在' })
  await prisma.userProblemContent.delete({ where: { id: content.id } })
  if (content.fileId) await fileService.softDelete(content.fileId)
  res.json({ success: true })
}))

trainingContentRouter.get('/trainings/:id/problems/:trainingProblemId/content-options', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const loaded = await requireAccess(req, res, true)
  if (!loaded) return
  const organizationId = await activityOrganizationId(loaded.training)
  const options = await listContentOptions(loaded.trainingProblem.problemId, req.user!.userId, organizationId)
  const [statement, solution] = await Promise.all([
    latestContentSnapshot(loaded.trainingProblem.id, 'statement'),
    latestContentSnapshot(loaded.trainingProblem.id, 'solution'),
  ])
  const currentKey = (snapshot: typeof statement, candidates: typeof options.statement) => {
    if (!snapshot) return null
    if (snapshot.sourceType === 'none') return 'none'
    const direct = snapshot.sourceContentId
      ? candidates.find(option => option.sourceType === snapshot.sourceType && option.sourceId === snapshot.sourceContentId)
      : candidates.find(option => option.sourceType === snapshot.sourceType && option.content === snapshot.content && option.format === snapshot.format)
    return direct?.key || null
  }
  res.json({
    success: true,
    data: {
      statement: options.statement.map(publicOption),
      solution: options.solution.map(publicOption),
      currentSelection: {
        statementOptionKey: currentKey(statement, options.statement),
        solutionOptionKey: currentKey(solution, options.solution),
        statementRevision: statement?.revision || null,
        solutionRevision: solution?.revision || null,
      },
    },
  })
}))

async function optionForRequest(req: AuthRequest, res: any) {
  const loaded = await requireAccess(req, res, true)
  if (!loaded) return null
  const organizationId = await activityOrganizationId(loaded.training)
  const options = await listContentOptions(loaded.trainingProblem.problemId, req.user!.userId, organizationId)
  const key = decodeURIComponent(req.params.optionKey)
  const option = [...options.statement, ...options.solution].find(item => item.key === key)
  if (!option) {
    res.status(404).json({ success: false, message: '内容版本不存在或不可用' })
    return null
  }
  return { loaded, option }
}

trainingContentRouter.get('/trainings/:id/problems/:trainingProblemId/content-options/:optionKey/preview', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const resolved = await optionForRequest(req, res)
  if (!resolved) return
  res.json({
    success: true,
    data: {
      ...publicOption(resolved.option),
      content: resolved.option.content,
      fileUrl: resolved.option.fileId
        ? `/api/trainings/${req.params.id}/problems/${req.params.trainingProblemId}/content-options/${encodeURIComponent(resolved.option.key)}/file`
        : null,
    },
  })
}))

trainingContentRouter.get('/trainings/:id/problems/:trainingProblemId/content-options/:optionKey/file', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const resolved = await optionForRequest(req, res)
  if (!resolved || !resolved.option.fileId) return res.status(404).json({ success: false, message: 'PDF 不存在' })
  const file = await fileService.download(resolved.option.fileId)
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`)
  res.send(file.buffer)
}))

trainingContentRouter.put('/trainings/:id/problems/:trainingProblemId/content-selection', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const loaded = await requireAccess(req, res, true)
  if (!loaded) return
  try {
    const organizationId = await activityOrganizationId(loaded.training)
    const created = await selectTrainingProblemContent({
      trainingProblemId: loaded.trainingProblem.id,
      problemId: loaded.trainingProblem.problemId,
      selectedBy: req.user!.userId,
      organizationId,
      statementOptionKey: String(req.body?.statementOptionKey || ''),
      solutionOptionKey: String(req.body?.solutionOptionKey || 'none'),
    })
    res.json({ success: true, data: { snapshots: created.map(item => ({ kind: item.kind, revision: item.revision })) } })
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message })
  }
}))

trainingContentRouter.get('/trainings/:id/problems/:trainingProblemId/content-snapshot/:kind/file', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const loaded = await requireAccess(req, res)
  const contentKind = kind(req.params.kind)
  if (!loaded || !contentKind) return
  const isAdmin = await canManageTraining(req.user!.userId, loaded.training)
  const solutionAllowed = isAdmin || loaded.training.solutionVisible || loaded.training.status === 'finished' || new Date() > loaded.training.endTime
  if (contentKind === 'solution' && !solutionAllowed) return res.status(403).json({ success: false, message: '题解尚未开放' })
  const snapshot = await latestContentSnapshot(loaded.trainingProblem.id, contentKind)
  if (!snapshot?.snapshotFileId) return res.status(404).json({ success: false, message: 'PDF 不存在' })
  const file = await fileService.download(snapshot.snapshotFileId)
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`)
  res.send(file.buffer)
}))
