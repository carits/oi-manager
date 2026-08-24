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
import { serializeMyContent } from '../problem/problem.user-content.routes'
import { ContentSnapshotEditError, editActivityContentSnapshot } from './training.content-snapshot.service'

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

function snapshotEditFailure(res: any, error: unknown) {
  const known = error instanceof ContentSnapshotEditError
  return res.status(known ? error.status : 400).json({
    success: false,
    message: error instanceof Error ? error.message : '活动内容编辑失败',
    ...(known && error.code ? { code: error.code } : {}),
  })
}

trainingContentRouter.put('/trainings/:id/problems/:trainingProblemId/content-snapshots/:kind/:snapshotId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const loaded = await requireAccess(req, res, true)
  const contentKind = kind(req.params.kind)
  if (!loaded || !contentKind) return
  try {
    const result = await editActivityContentSnapshot({
      trainingProblemId: loaded.trainingProblem.id, kind: contentKind,
      snapshotId: req.params.snapshotId, selectedBy: req.user!.userId,
      mode: 'markdown', content: String(req.body?.content || ''),
    })
    res.json({ success: true, data: result })
  } catch (error) {
    snapshotEditFailure(res, error)
  }
}))

trainingContentRouter.post('/trainings/:id/problems/:trainingProblemId/content-snapshots/:kind/:snapshotId/pdf', authenticate, pdfUpload.single('file'), asyncHandler(async (req: AuthRequest, res) => {
  const loaded = await requireAccess(req, res, true)
  const contentKind = kind(req.params.kind)
  if (!loaded || !contentKind || !req.file) {
    if (req.file?.path) fs.unlinkSync(req.file.path)
    if (loaded && contentKind) return res.status(400).json({ success: false, message: '请选择 PDF 文件' })
    return
  }
  let uploadedId: string | null = null
  try {
    const uploaded = await fileService.uploadFromMulter(req.file, {
      category: 'pdf', ownerType: 'training_content', ownerId: loaded.trainingProblem.id, isPublic: false,
    })
    uploadedId = uploaded.id
    const result = await editActivityContentSnapshot({
      trainingProblemId: loaded.trainingProblem.id, kind: contentKind,
      snapshotId: req.params.snapshotId, selectedBy: req.user!.userId,
      mode: 'pdf', fileId: uploaded.id, fileName: uploaded.originalName,
    })
    res.json({ success: true, data: result })
  } catch (error) {
    if (uploadedId) await fileService.softDelete(uploadedId).catch(() => undefined)
    snapshotEditFailure(res, error)
  }
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
  const solutionOptions = [...options.solution]
  let solutionOptionKey = currentKey(solution, solutionOptions)
  if (solution && solution.sourceType !== 'none' && !solutionOptionKey) {
    const frozen = {
      key: `snapshot:${solution.id}`, kind: 'solution' as const, sourceType: 'training' as const,
      sourceId: solution.id, sourceRevision: solution.revision, title: solution.title,
      format: solution.format, language: solution.language, content: solution.content,
      fileId: solution.snapshotFileId, fileName: solution.fileName,
      authorUserId: solution.authorUserId, authorUsername: solution.authorUsernameSnapshot,
      shareKeys: [],
    }
    solutionOptions.unshift(frozen)
    solutionOptionKey = frozen.key
  }
  res.json({
    success: true,
    data: {
      statement: options.statement.map(publicOption),
      solution: solutionOptions.map(publicOption),
      currentSelection: {
        statementOptionKey: currentKey(statement, options.statement),
        solutionOptionKey,
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
  let option = [...options.statement, ...options.solution].find(item => item.key === key)
  if (!option && key.startsWith('snapshot:')) {
    const snapshot = await latestContentSnapshot(loaded.trainingProblem.id, 'solution')
    if (snapshot?.id === key.slice('snapshot:'.length) && snapshot.sourceType !== 'none') option = {
      key, kind: 'solution', sourceType: 'training', sourceId: snapshot.id,
      sourceRevision: snapshot.revision, title: snapshot.title, format: snapshot.format,
      language: snapshot.language, content: snapshot.content, fileId: snapshot.snapshotFileId,
      fileName: snapshot.fileName, authorUserId: snapshot.authorUserId,
      authorUsername: snapshot.authorUsernameSnapshot, shareKeys: [],
    }
  }
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
  if (!resolved) return
  if (!resolved.option.fileId) return res.status(404).json({ success: false, message: 'PDF 不存在' })
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
