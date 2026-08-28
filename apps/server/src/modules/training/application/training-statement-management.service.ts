import crypto from 'crypto'
import { prisma } from '../../../prisma'
import { fileService } from '../../../lib/storage'
import { canAccessTraining, canManageTraining, requireTrainingStarted } from '../training.helpers'
import {
  activityOrganizationId,
  listContentOptions,
  type ContentOption,
} from '../../problem/problem.content.service'

export class TrainingStatementManagementError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new TrainingStatementManagementError(statusCode, code, message)
}

function loadTraining(trainingId: number) {
  return prisma.training.findUnique({
    where: { id: trainingId },
    include: {
      Team: { select: { organizationId: true } },
      TrainingProblem: {
        orderBy: { orderIndex: 'asc' },
        include: { Problem: { select: { title: true } } },
      },
    },
  })
}

function currentStatementSet(trainingProblemId: string) {
  return prisma.trainingProblemStatementSet.findFirst({
    where: { trainingProblemId },
    orderBy: { revision: 'desc' },
    include: { Snapshot: { orderBy: { orderIndex: 'asc' } } },
  })
}

function livePublicOption(option: ContentOption, managerId: string) {
  const author = option.authorUsername || 'System'
  const name = option.sourceType === 'canonical'
    ? option.language === 'zh'
      ? '官方中文'
      : option.language === 'en'
        ? 'Official English'
        : '官方题面'
    : option.title || option.fileName || '用户题面'
  const groupKey = option.sourceType === 'canonical'
    ? `canonical:${option.language || 'none'}:${option.format}`
    : `user:${option.authorUserId}:${name.normalize('NFKC').toLocaleLowerCase('zh-CN')}:${option.language || 'none'}:${option.format}`
  return {
    key: option.key,
    groupKey,
    name,
    title: option.title,
    authorUsername: author,
    language: option.language,
    format: option.format,
    visibility: option.sourceType === 'canonical'
      ? 'public'
      : option.authorUserId === managerId
        ? 'mine'
        : 'public',
    sourceType: option.sourceType,
    sourceContentId: option.sourceId,
    unavailable: false,
  }
}

async function optionsForProblem(
  problemId: string,
  managerId: string,
  organizationId: string | null,
) {
  const options = await listContentOptions(problemId, managerId, organizationId)
  const raw = options.statement.filter(item => item.sourceType !== 'none')
  return { raw, public: raw.map(item => livePublicOption(item, managerId)) }
}

async function requireManagedTraining(trainingId: number, userId: string) {
  const training = await loadTraining(trainingId)
  if (!training) fail(404, 'TRAINING_NOT_FOUND', '活动不存在')
  if (!await canManageTraining(userId, training)) {
    fail(403, 'TRAINING_STATEMENT_MANAGE_DENIED', '无权管理活动题面')
  }
  return training
}

export async function getTrainingStatementManagement(trainingId: number, userId: string) {
  const training = await requireManagedTraining(trainingId, userId)
  const organizationId = await activityOrganizationId(training)
  const problems = []
  for (const trainingProblem of training.TrainingProblem) {
    const [{ public: options }, selected] = await Promise.all([
      optionsForProblem(trainingProblem.problemId, userId, organizationId),
      currentStatementSet(trainingProblem.id),
    ])
    const liveKeys = new Set(options.map(item => item.key))
    const selectedOptions = selected?.Snapshot.map(snapshot => {
      const directKey = snapshot.sourceType === 'user'
        ? `user:${snapshot.sourceContentId}`
        : snapshot.sourceContentId
          ? `canonical:${snapshot.sourceContentId}`
          : null
      const key = directKey && liveKeys.has(directKey) ? directKey : `snapshot:${snapshot.id}`
      if (!liveKeys.has(key)) {
        options.push({
          key,
          groupKey: `snapshot:${snapshot.id}`,
          name: snapshot.name,
          title: snapshot.title,
          authorUsername: snapshot.authorUsernameSnapshot || 'System',
          language: snapshot.language,
          format: snapshot.format,
          visibility: 'frozen',
          sourceType: snapshot.sourceType as ContentOption['sourceType'],
          sourceContentId: snapshot.sourceContentId,
          unavailable: true,
        })
      }
      return { key, isDefault: snapshot.isDefault, orderIndex: snapshot.orderIndex }
    }) || []
    problems.push({
      trainingProblemId: trainingProblem.id,
      alias: trainingProblem.alias,
      orderIndex: trainingProblem.orderIndex,
      title: trainingProblem.Problem.title,
      selectionRevision: selected?.revision || 0,
      options,
      selected: selectedOptions,
    })
  }
  return {
    training: { id: training.id, title: training.title, type: training.type },
    problems,
  }
}

type PreparedItem = {
  option: ContentOption | null
  frozen: any | null
  key: string
  isDefault: boolean
  orderIndex: number
  snapshotId: string
  copiedFileId: string | null
}

type StatementSelection = {
  trainingProblemId?: unknown
  visibleOptionKeys?: unknown
  defaultOptionKey?: unknown
  expectedSelectionRevision?: unknown
}

export async function saveTrainingStatementManagement(input: {
  trainingId: number
  userId: string
  selections: unknown
}) {
  const training = await requireManagedTraining(input.trainingId, input.userId)
  const selections: StatementSelection[] = Array.isArray(input.selections) ? input.selections : []
  if (selections.length !== training.TrainingProblem.length) {
    fail(400, 'STATEMENT_SELECTION_INCOMPLETE', '必须提交活动中全部题目的题面选择')
  }
  const selectionIds = selections.map(item => String(item.trainingProblemId || ''))
  if (new Set(selectionIds).size !== selectionIds.length) {
    fail(400, 'STATEMENT_SELECTION_DUPLICATE', '活动题面选择包含重复题目')
  }

  const organizationId = await activityOrganizationId(training)
  const preparedProblems: Array<{
    trainingProblem: typeof training.TrainingProblem[number]
    current: Awaited<ReturnType<typeof currentStatementSet>>
    items: PreparedItem[]
  }> = []
  const copiedFileIds: string[] = []

  try {
    for (const trainingProblem of training.TrainingProblem) {
      const selection = selections.find(item => String(item.trainingProblemId) === trainingProblem.id)
      if (!selection) fail(400, 'STATEMENT_SELECTION_INCOMPLETE', '必须提交活动中全部题目的题面选择')
      const keys = Array.isArray(selection.visibleOptionKeys)
        ? Array.from(new Set(selection.visibleOptionKeys.map(value => String(value))))
        : []
      const defaultKey = String(selection.defaultOptionKey || '')
      const label = trainingProblem.alias || trainingProblem.orderIndex + 1
      if (!keys.length || !keys.includes(defaultKey)) {
        fail(400, 'STATEMENT_DEFAULT_REQUIRED', `${label} 题必须选择至少一份题面并指定默认题面`)
      }

      const [{ raw }, current] = await Promise.all([
        optionsForProblem(trainingProblem.problemId, input.userId, organizationId),
        currentStatementSet(trainingProblem.id),
      ])
      if (selection.expectedSelectionRevision !== undefined) {
        const expected = Number(selection.expectedSelectionRevision)
        if (!Number.isInteger(expected) || expected !== (current?.revision || 0)) {
          fail(409, 'STATEMENT_SELECTION_STALE', `${label} 题的题面选择已被其他管理员更新，请刷新后重试`)
        }
      }

      const rawMap = new Map(raw.map(item => [item.key, item]))
      const currentKey = (item: any) => {
        const liveKey = item.sourceContentId
          ? `${item.sourceType === 'user' ? 'user' : 'canonical'}:${item.sourceContentId}`
          : null
        return liveKey && rawMap.has(liveKey) ? liveKey : `snapshot:${item.id}`
      }
      const frozenMap = new Map((current?.Snapshot || []).map(item => [currentKey(item), item]))
      const items: PreparedItem[] = []
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]
        const frozen = frozenMap.get(key) || null
        const option = frozen ? null : rawMap.get(key) || null
        if (!option && !frozen) {
          fail(400, 'STATEMENT_OPTION_UNAVAILABLE', `${label} 题包含不可用的题面版本`)
        }
        let copiedFileId: string | null = null
        const sourceFileId = option?.fileId || frozen?.snapshotFileId || null
        if (sourceFileId && option) {
          const file = await fileService.download(sourceFileId)
          const copy = await fileService.upload(file.buffer, {
            category: 'pdf',
            ownerType: 'training_content',
            ownerId: trainingProblem.id,
            originalName: file.originalName,
            mimeType: file.mimeType,
            isPublic: false,
          })
          copiedFileId = copy.id
          copiedFileIds.push(copy.id)
        } else if (frozen?.snapshotFileId) {
          copiedFileId = frozen.snapshotFileId
        }
        items.push({
          option,
          frozen,
          key,
          isDefault: key === defaultKey,
          orderIndex: index,
          snapshotId: crypto.randomUUID(),
          copiedFileId,
        })
      }
      const currentSignature = (current?.Snapshot || [])
        .map(item => `${currentKey(item)}:${item.isDefault}`)
        .join('|')
      const nextSignature = items.map(item => `${item.key}:${item.isDefault}`).join('|')
      if (currentSignature !== nextSignature) {
        preparedProblems.push({ trainingProblem, current, items })
      }
    }

    const revisions = await prisma.$transaction(async tx => {
      const result = []
      for (const prepared of preparedProblems) {
        const latest = await tx.trainingProblemStatementSet.findFirst({
          where: { trainingProblemId: prepared.trainingProblem.id },
          orderBy: { revision: 'desc' },
          select: { id: true },
        })
        if ((latest?.id || null) !== (prepared.current?.id || null)) {
          fail(
            409,
            'STATEMENT_SELECTION_STALE',
            `${prepared.trainingProblem.alias || prepared.trainingProblem.orderIndex + 1} 题的题面选择已被其他管理员更新，请刷新后重试`,
          )
        }
        const set = await tx.trainingProblemStatementSet.create({
          data: {
            id: crypto.randomUUID(),
            trainingProblemId: prepared.trainingProblem.id,
            revision: (prepared.current?.revision || 0) + 1,
            selectedBy: input.userId,
          },
        })
        for (const item of prepared.items) {
          const source = item.option || item.frozen
          await tx.trainingProblemStatementSnapshot.create({
            data: {
              id: item.snapshotId,
              statementSetId: set.id,
              sourceType: source.sourceType,
              sourceContentId: item.option?.sourceId || source.sourceContentId,
              name: item.option?.title || source.name || source.fileName || '题面',
              title: source.title,
              language: source.language,
              format: source.format,
              content: source.content,
              snapshotFileId: item.copiedFileId,
              fileName: source.fileName,
              authorUserId: item.option?.authorUserId || source.authorUserId,
              authorUsernameSnapshot: item.option?.authorUsername || source.authorUsernameSnapshot,
              isDefault: item.isDefault,
              orderIndex: item.orderIndex,
            },
          })
        }
        result.push({ trainingProblemId: prepared.trainingProblem.id, revision: set.revision })
      }
      return result
    })
    return { changedCount: revisions.length, revisions }
  } catch (error) {
    await Promise.all(copiedFileIds.map(fileId => fileService.softDelete(fileId).catch(() => undefined)))
    if (error instanceof TrainingStatementManagementError) throw error
    fail(400, 'STATEMENT_SELECTION_INVALID', error instanceof Error ? error.message : '活动题面选择失败')
  }
}

async function requireAccessibleProblem(
  trainingId: number,
  trainingProblemId: string,
  userId: string,
  hideUnauthorized = false,
) {
  const training = await loadTraining(trainingId)
  const trainingProblem = training?.TrainingProblem.find(item => item.id === trainingProblemId)
  if (!training || !trainingProblem) {
    fail(404, 'TRAINING_PROBLEM_NOT_FOUND', hideUnauthorized ? '文件不存在' : '活动题目不存在')
  }
  if (!await canAccessTraining(userId, training)) {
    fail(hideUnauthorized ? 404 : 403, 'TRAINING_STATEMENT_FORBIDDEN', hideUnauthorized ? '文件不存在' : '无权限')
  }
  const notStarted = await requireTrainingStarted(training, userId)
  if (notStarted) fail(403, 'TRAINING_NOT_STARTED', notStarted)
  return { training, trainingProblem }
}

export async function getTrainingStatementVersions(
  trainingId: number,
  trainingProblemId: string,
  userId: string,
) {
  const { training, trainingProblem } = await requireAccessibleProblem(trainingId, trainingProblemId, userId)
  const isManager = await canManageTraining(userId, training)
  const selected = await currentStatementSet(trainingProblem.id)
  const statements = (selected?.Snapshot || []).map(item => ({
    id: item.id,
    name: item.name,
    title: item.title,
    language: item.language,
    format: item.format,
    content: item.content,
    hasFile: Boolean(item.snapshotFileId),
    authorUsername: isManager
      ? item.authorUsernameSnapshot || 'System'
      : item.sourceType === 'canonical'
        ? 'System'
        : null,
    isDefault: item.isDefault,
    orderIndex: item.orderIndex,
  }))
  return { selectionRevision: selected?.revision || 0, statements }
}

export async function downloadTrainingStatementVersion(input: {
  trainingId: number
  trainingProblemId: string
  snapshotId: string
  userId: string
}) {
  const { trainingProblem } = await requireAccessibleProblem(
    input.trainingId,
    input.trainingProblemId,
    input.userId,
    true,
  )
  const selected = await currentStatementSet(trainingProblem.id)
  const snapshot = selected?.Snapshot.find(item => item.id === input.snapshotId)
  if (!snapshot?.snapshotFileId) fail(404, 'STATEMENT_PDF_NOT_FOUND', 'PDF 不存在')
  return fileService.download(snapshot.snapshotFileId)
}
