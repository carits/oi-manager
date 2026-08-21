import crypto from 'crypto'
import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import type { AuthRequest } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { canAccessTraining, canManageTraining, parseTrainingId, requireTrainingStarted } from './training.helpers'
import { activityOrganizationId, listContentOptions, type ContentOption } from '../problem/problem.content.service'
import { fileService } from '../../lib/storage'
import { normalizeStatementName, serializeStatementVersion } from '../problem/problem.statement-version.service'

export const trainingStatementManagementRouter = Router()

async function context(trainingId: number) {
  return prisma.training.findUnique({
    where: { id: trainingId }, include: {
      Team: { select: { organizationId: true } },
      TrainingProblem: { orderBy: { orderIndex: 'asc' }, include: { Problem: { select: { title: true } } } },
    },
  })
}

async function currentSet(trainingProblemId: string) {
  return prisma.trainingProblemStatementSet.findFirst({
    where: { trainingProblemId }, orderBy: { revision: 'desc' },
    include: { Snapshot: { orderBy: { orderIndex: 'asc' } } },
  })
}

function livePublicOption(option: ContentOption, managerId: string) {
  const author = option.authorUsername || 'System'
  const name = option.title || option.fileName || (option.language === 'zh' ? '官方中文' : option.language === 'en' ? 'Official English' : '官方题面')
  const groupKey = option.sourceType === 'canonical'
    ? `canonical:${option.language || 'none'}:${option.format}`
    : `user:${option.authorUserId}:${name.normalize('NFKC').toLocaleLowerCase('zh-CN')}:${option.language || 'none'}:${option.format}`
  return {
    key: option.key, groupKey, name, title: option.title, authorUsername: author,
    language: option.language, format: option.format, visibility: option.sourceType === 'canonical' ? 'public' : option.authorUserId === managerId ? 'mine' : 'public',
    sourceType: option.sourceType, sourceContentId: option.sourceId, unavailable: false,
  }
}

async function optionsForProblem(problemId: string, managerId: string, organizationId: string | null) {
  const options = await listContentOptions(problemId, managerId, organizationId)
  return { raw: options.statement.filter(item => item.sourceType !== 'none'), public: options.statement.filter(item => item.sourceType !== 'none').map(item => livePublicOption(item, managerId)) }
}

trainingStatementManagementRouter.get('/trainings/:id/statement-management', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = parseTrainingId(req.params.id)
  const training = await context(id)
  if (!training) return res.status(404).json({ success: false, message: '活动不存在' })
  if (!await canManageTraining(req.user!.userId, training)) return res.status(403).json({ success: false, message: '无权管理活动题面' })
  const organizationId = await activityOrganizationId(training)
  const problems = []
  for (const tp of training.TrainingProblem) {
    const [{ public: options }, selected] = await Promise.all([
      optionsForProblem(tp.problemId, req.user!.userId, organizationId), currentSet(tp.id),
    ])
    const liveKeys = new Set(options.map(item => item.key))
    const selectedOptions = selected?.Snapshot.map(snapshot => {
      const directKey = snapshot.sourceType === 'user' ? `user:${snapshot.sourceContentId}` : snapshot.sourceContentId ? `canonical:${snapshot.sourceContentId}` : null
      const key = directKey && liveKeys.has(directKey) ? directKey : `snapshot:${snapshot.id}`
      if (!liveKeys.has(key)) options.push({
        key, groupKey: `snapshot:${snapshot.id}`, name: snapshot.name, title: snapshot.title,
        authorUsername: snapshot.authorUsernameSnapshot || 'System', language: snapshot.language,
        format: snapshot.format, visibility: 'frozen', sourceType: snapshot.sourceType as ContentOption['sourceType'],
        sourceContentId: snapshot.sourceContentId, unavailable: true,
      })
      return { key, isDefault: snapshot.isDefault, orderIndex: snapshot.orderIndex }
    }) || []
    problems.push({
      trainingProblemId: tp.id, alias: tp.alias, orderIndex: tp.orderIndex, title: tp.Problem.title,
      selectionRevision: selected?.revision || 0, options, selected: selectedOptions,
    })
  }
  res.json({ success: true, data: { training: { id: training.id, title: training.title, type: training.type }, problems } })
}))

type Prepared = {
  option: ContentOption | null
  frozen: any | null
  key: string
  isDefault: boolean
  orderIndex: number
  snapshotId: string
  copiedFileId: string | null
}

trainingStatementManagementRouter.put('/trainings/:id/statement-management', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = parseTrainingId(req.params.id)
  const training = await context(id)
  if (!training) return res.status(404).json({ success: false, message: '活动不存在' })
  if (!await canManageTraining(req.user!.userId, training)) return res.status(403).json({ success: false, message: '无权管理活动题面' })
  const selections = Array.isArray(req.body?.selections) ? req.body.selections : []
  if (selections.length !== training.TrainingProblem.length) return res.status(400).json({ success: false, message: '必须提交活动中全部题目的题面选择' })
  const organizationId = await activityOrganizationId(training)
  const preparedProblems: Array<{ tp: typeof training.TrainingProblem[number]; current: Awaited<ReturnType<typeof currentSet>>; items: Prepared[] }> = []
  const copiedFileIds: string[] = []
  try {
    for (const tp of training.TrainingProblem) {
      const selection = selections.find((item: any) => item.trainingProblemId === tp.id)
      const keys: string[] = Array.isArray(selection?.visibleOptionKeys)
        ? Array.from(new Set<string>(selection.visibleOptionKeys.map((value: unknown) => String(value))))
        : []
      const defaultKey = String(selection?.defaultOptionKey || '')
      if (!keys.length || !keys.includes(defaultKey)) throw new Error(`${tp.alias || tp.orderIndex + 1} 题必须选择至少一份题面并指定默认题面`)
      const [{ raw }, current] = await Promise.all([optionsForProblem(tp.problemId, req.user!.userId, organizationId), currentSet(tp.id)])
      const rawMap = new Map(raw.map(item => [item.key, item]))
      const currentKey = (item: any) => {
        const liveKey = item.sourceContentId
          ? `${item.sourceType === 'user' ? 'user' : 'canonical'}:${item.sourceContentId}`
          : null
        return liveKey && rawMap.has(liveKey) ? liveKey : `snapshot:${item.id}`
      }
      // 已经固化进活动的题面必须继续从当前快照复制。即使来源后来被编辑，管理员
      // 仅增加另一份题面时，也不能顺便把原题面静默更新成来源的最新内容。
      const frozenMap = new Map((current?.Snapshot || []).map(item => [currentKey(item), item]))
      const items: Prepared[] = []
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]
        const frozen = frozenMap.get(key) || null
        const option = frozen ? null : rawMap.get(key) || null
        if (!option && !frozen) throw new Error(`${tp.alias || tp.orderIndex + 1} 题包含不可用的题面版本`)
        let copiedFileId: string | null = null
        const sourceFileId = option?.fileId || frozen?.snapshotFileId || null
        if (sourceFileId && option) {
          const file = await fileService.download(sourceFileId)
          const copy = await fileService.upload(file.buffer, {
            category: 'pdf', ownerType: 'training_content', ownerId: tp.id,
            originalName: file.originalName, mimeType: file.mimeType, isPublic: false,
          })
          copiedFileId = copy.id
          copiedFileIds.push(copy.id)
        } else if (frozen?.snapshotFileId) copiedFileId = frozen.snapshotFileId
        items.push({ option, frozen, key, isDefault: key === defaultKey, orderIndex: index, snapshotId: crypto.randomUUID(), copiedFileId })
      }
      const currentSignature = (current?.Snapshot || []).map(item => `${currentKey(item)}:${item.isDefault}`).join('|')
      const nextSignature = items.map(item => `${item.key}:${item.isDefault}`).join('|')
      if (currentSignature !== nextSignature) preparedProblems.push({ tp, current, items })
    }
    const revisions = await prisma.$transaction(async tx => {
      const result = []
      for (const prepared of preparedProblems) {
        const set = await tx.trainingProblemStatementSet.create({
          data: {
            id: crypto.randomUUID(), trainingProblemId: prepared.tp.id,
            revision: (prepared.current?.revision || 0) + 1, selectedBy: req.user!.userId,
          },
        })
        for (const item of prepared.items) {
          const source = item.option || item.frozen
          await tx.trainingProblemStatementSnapshot.create({ data: {
            id: item.snapshotId, statementSetId: set.id,
            sourceType: source.sourceType, sourceContentId: item.option?.sourceId || source.sourceContentId,
            name: item.option?.title || source.name || source.fileName || '题面', title: source.title,
            language: source.language, format: source.format, content: source.content,
            snapshotFileId: item.copiedFileId, fileName: source.fileName,
            authorUserId: item.option?.authorUserId || source.authorUserId,
            authorUsernameSnapshot: item.option?.authorUsername || source.authorUsernameSnapshot,
            isDefault: item.isDefault, orderIndex: item.orderIndex,
          } })
        }
        result.push({ trainingProblemId: prepared.tp.id, revision: set.revision })
      }
      return result
    })
    res.json({ success: true, data: { changedCount: revisions.length, revisions } })
  } catch (error: any) {
    await Promise.all(copiedFileIds.map(fileId => fileService.softDelete(fileId).catch(() => undefined)))
    res.status(400).json({ success: false, message: error.message })
  }
}))

trainingStatementManagementRouter.get('/trainings/:id/problems/:trainingProblemId/statement-versions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = parseTrainingId(req.params.id)
  const training = await context(id)
  const tp = training?.TrainingProblem.find(item => item.id === req.params.trainingProblemId)
  if (!training || !tp) return res.status(404).json({ success: false, message: '活动题目不存在' })
  if (!await canAccessTraining(req.user!.userId, training)) return res.status(403).json({ success: false, message: '无权限' })
  const notStarted = await requireTrainingStarted(training, req.user!.userId)
  if (notStarted) return res.status(403).json({ success: false, message: notStarted })
  const selected = await currentSet(tp.id)
  const statements = (selected?.Snapshot || []).map(item => ({
    id: item.id, name: item.name, title: item.title, language: item.language, format: item.format,
    content: item.content, fileUrl: item.snapshotFileId ? `/api/trainings/${id}/problems/${tp.id}/statement-versions/${item.id}/file` : null,
    authorUsername: item.authorUsernameSnapshot || 'System', isDefault: item.isDefault, orderIndex: item.orderIndex,
  }))
  res.json({ success: true, data: { selectionRevision: selected?.revision || 0, statements } })
}))

trainingStatementManagementRouter.get('/trainings/:id/problems/:trainingProblemId/statement-versions/:snapshotId/file', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = parseTrainingId(req.params.id)
  const training = await context(id)
  const tp = training?.TrainingProblem.find(item => item.id === req.params.trainingProblemId)
  if (!training || !tp || !await canAccessTraining(req.user!.userId, training)) return res.status(404).json({ success: false, message: '文件不存在' })
  const selected = await currentSet(tp.id)
  const snapshot = selected?.Snapshot.find(item => item.id === req.params.snapshotId)
  if (!snapshot?.snapshotFileId) return res.status(404).json({ success: false, message: 'PDF 不存在' })
  const file = await fileService.download(snapshot.snapshotFileId)
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`)
  res.send(file.buffer)
}))

trainingStatementManagementRouter.post('/trainings/:id/problems/:trainingProblemId/statement-versions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const id = parseTrainingId(req.params.id)
  const training = await context(id)
  const tp = training?.TrainingProblem.find(item => item.id === req.params.trainingProblemId)
  if (!training || !tp || !await canAccessTraining(req.user!.userId, training)) return res.status(404).json({ success: false, message: '活动题目不存在' })
  const { name, nameKey } = normalizeStatementName(req.body?.name)
  const visibility = req.body?.visibility === 'public' ? 'public' : 'private'
  const duplicate = await prisma.userProblemContent.findFirst({
    where: { problemId: tp.problemId, userId: req.user!.userId, kind: 'statement', nameKey, deletedAt: null },
    select: { id: true },
  })
  if (duplicate) return res.status(409).json({ success: false, message: '同名题面已经存在' })
  const sourceType = String(req.body?.source?.type || 'blank')
  let material: any = { content: '', format: 'markdown', language: req.body?.language || 'zh', snapshotFileId: null, name: null, authorUsernameSnapshot: null, sourceType: 'blank', sourceContentId: null }
  if (sourceType === 'snapshot') {
    const selected = await currentSet(tp.id)
    const snapshot = selected?.Snapshot.find(item => item.id === req.body?.source?.id)
    if (!snapshot) return res.status(400).json({ success: false, message: '来源活动题面不存在' })
    material = snapshot
  }
  let fileId: string | null = null
  if (material.snapshotFileId) {
    const file = await fileService.download(material.snapshotFileId)
    fileId = (await fileService.upload(file.buffer, { category: 'pdf', ownerType: 'user', ownerId: req.user!.userId, originalName: file.originalName, mimeType: file.mimeType, isPublic: false })).id
  }
  try {
    const created = await prisma.userProblemContent.create({ data: {
      id: crypto.randomUUID(), problemId: tp.problemId, userId: req.user!.userId, kind: 'statement', name, nameKey,
      title: material.title, language: req.body?.language || material.language || 'zh', format: material.format || 'markdown',
      content: material.content, fileId, visibility, sourceType: material.sourceType === 'user' ? 'user' : material.sourceType === 'canonical' ? 'canonical' : 'blank',
      sourceId: material.sourceContentId, sourceNameSnapshot: material.name, sourceAuthorSnapshot: material.authorUsernameSnapshot || 'System',
    }, include: { User: { select: { username: true } } } })
    res.status(201).json({ success: true, data: serializeStatementVersion(created, req.user!.userId) })
  } catch (error: any) {
    if (fileId) await fileService.softDelete(fileId)
    res.status(error?.code === 'P2002' ? 409 : 400).json({ success: false, message: error?.code === 'P2002' ? '同名题面已经存在' : error.message })
  }
}))
