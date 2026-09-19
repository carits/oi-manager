import { prisma } from '../../../prisma'
import { fileService } from '../../../lib/storage'
import { canAccessTraining, canManageTraining, requireTrainingStarted } from '../training.helpers'
import {
  activityOrganizationId,
  latestContentSnapshot,
  listContentOptions,
  publicOption,
  selectTrainingProblemContent,
  type ContentKind,
  type ContentOption,
} from '../../problem/problem.content.service'
import { ContentSnapshotEditError, editActivityContentSnapshot } from '../training.content-snapshot.service'
import { findActivityForAccess } from '../../contest/contest-query.facade'

export class TrainingContentError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new TrainingContentError(statusCode, code, message)
}

export function parseContentKind(value: string): ContentKind {
  if (value !== 'statement' && value !== 'solution') {
    fail(404, 'CONTENT_KIND_NOT_FOUND', '内容类型不存在')
  }
  return value
}

async function loadContext(trainingId: number, trainingProblemId: string) {
  const training = (await findActivityForAccess(trainingId))?.activity || null
  const trainingProblem = await prisma.trainingProblem.findFirst({
    where: { id: trainingProblemId, trainingId },
  })
  if (!training || !trainingProblem) {
    fail(404, 'TRAINING_PROBLEM_NOT_FOUND', '活动题目不存在')
  }
  return { training, trainingProblem }
}

async function requireContext(
  trainingId: number,
  trainingProblemId: string,
  userId: string,
  manager = false,
) {
  const loaded = await loadContext(trainingId, trainingProblemId)
  const allowed = manager
    ? await canManageTraining(userId, loaded.training)
    : await canAccessTraining(userId, loaded.training)
  if (!allowed) fail(403, 'TRAINING_CONTENT_FORBIDDEN', '无权限')
  if (!manager) {
    const notStarted = await requireTrainingStarted(loaded.training, userId)
    if (notStarted) fail(403, 'TRAINING_NOT_STARTED', notStarted)
  }
  return loaded
}

export async function getTrainingMyContent(
  trainingId: number,
  trainingProblemId: string,
  userId: string,
) {
  const { trainingProblem } = await requireContext(trainingId, trainingProblemId, userId)
  const contents = await prisma.userProblemContent.findMany({
    where: { problemId: trainingProblem.problemId, userId, deletedAt: null },
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

function rethrowSnapshotError(error: unknown): never {
  if (error instanceof ContentSnapshotEditError) {
    throw new TrainingContentError(error.status, error.code || 'CONTENT_SNAPSHOT_EDIT_FAILED', error.message)
  }
  throw error
}

export async function editTrainingContentMarkdown(input: {
  trainingId: number
  trainingProblemId: string
  userId: string
  kind: ContentKind
  snapshotId: string
  content: string
}) {
  const { trainingProblem } = await requireContext(
    input.trainingId,
    input.trainingProblemId,
    input.userId,
    true,
  )
  try {
    return await editActivityContentSnapshot({
      trainingProblemId: trainingProblem.id,
      kind: input.kind,
      snapshotId: input.snapshotId,
      selectedBy: input.userId,
      mode: 'markdown',
      content: input.content,
    })
  } catch (error) {
    rethrowSnapshotError(error)
  }
}

export async function replaceTrainingContentPdf(input: {
  trainingId: number
  trainingProblemId: string
  userId: string
  kind: ContentKind
  snapshotId: string
  file?: Express.Multer.File
}) {
  const { trainingProblem } = await requireContext(
    input.trainingId,
    input.trainingProblemId,
    input.userId,
    true,
  )
  if (!input.file) fail(400, 'PDF_REQUIRED', '请选择 PDF 文件')

  let uploadedId: string | null = null
  try {
    const uploaded = await fileService.uploadFromMulter(input.file, {
      category: 'pdf',
      ownerType: 'training_content',
      ownerId: trainingProblem.id,
      isPublic: false,
    })
    uploadedId = uploaded.id
    return await editActivityContentSnapshot({
      trainingProblemId: trainingProblem.id,
      kind: input.kind,
      snapshotId: input.snapshotId,
      selectedBy: input.userId,
      mode: 'pdf',
      fileId: uploaded.id,
      fileName: uploaded.originalName,
    })
  } catch (error) {
    if (uploadedId) await fileService.softDelete(uploadedId).catch(() => undefined)
    rethrowSnapshotError(error)
  }
}

function selectedOptionKey(
  snapshot: Awaited<ReturnType<typeof latestContentSnapshot>>,
  candidates: ContentOption[],
) {
  if (!snapshot) return null
  if (snapshot.sourceType === 'none') return 'none'
  const direct = snapshot.sourceContentId
    ? candidates.find(option => (
      option.sourceType === snapshot.sourceType && option.sourceId === snapshot.sourceContentId
    ))
    : candidates.find(option => (
      option.sourceType === snapshot.sourceType
      && option.content === snapshot.content
      && option.format === snapshot.format
    ))
  return direct?.key || null
}

async function managerOptions(
  trainingId: number,
  trainingProblemId: string,
  userId: string,
) {
  const loaded = await requireContext(trainingId, trainingProblemId, userId, true)
  const organizationId = await activityOrganizationId(loaded.training)
  const options = await listContentOptions(loaded.trainingProblem.problemId, userId, organizationId)
  return { loaded, organizationId, options }
}

export async function getTrainingContentOptions(
  trainingId: number,
  trainingProblemId: string,
  userId: string,
) {
  const { loaded, options } = await managerOptions(trainingId, trainingProblemId, userId)
  const [statement, solution] = await Promise.all([
    latestContentSnapshot(loaded.trainingProblem.id, 'statement'),
    latestContentSnapshot(loaded.trainingProblem.id, 'solution'),
  ])
  const solutionOptions = [...options.solution]
  let solutionOptionKey = selectedOptionKey(solution, solutionOptions)
  if (solution && solution.sourceType !== 'none' && !solutionOptionKey) {
    const frozen: ContentOption = {
      key: `snapshot:${solution.id}`,
      kind: 'solution',
      sourceType: 'training',
      sourceId: solution.id,
      sourceRevision: solution.revision,
      title: solution.title,
      format: solution.format,
      language: solution.language,
      content: solution.content,
      fileId: solution.snapshotFileId,
      fileName: solution.fileName,
      authorUserId: solution.authorUserId,
      authorUsername: solution.authorUsernameSnapshot,
      shareKeys: [],
    }
    solutionOptions.unshift(frozen)
    solutionOptionKey = frozen.key
  }
  return {
    statement: options.statement.map(publicOption),
    solution: solutionOptions.map(publicOption),
    currentSelection: {
      statementOptionKey: selectedOptionKey(statement, options.statement),
      solutionOptionKey,
      statementRevision: statement?.revision || null,
      solutionRevision: solution?.revision || null,
    },
  }
}

async function resolveManagerOption(
  trainingId: number,
  trainingProblemId: string,
  userId: string,
  encodedKey: string,
) {
  const { loaded, options } = await managerOptions(trainingId, trainingProblemId, userId)
  let key: string
  try { key = decodeURIComponent(encodedKey) } catch { fail(400, 'CONTENT_OPTION_KEY_INVALID', '内容版本参数无效') }
  let option = [...options.statement, ...options.solution].find(item => item.key === key)
  if (!option && key.startsWith('snapshot:')) {
    const snapshot = await latestContentSnapshot(loaded.trainingProblem.id, 'solution')
    if (snapshot?.id === key.slice('snapshot:'.length) && snapshot.sourceType !== 'none') {
      option = {
        key,
        kind: 'solution',
        sourceType: 'training',
        sourceId: snapshot.id,
        sourceRevision: snapshot.revision,
        title: snapshot.title,
        format: snapshot.format,
        language: snapshot.language,
        content: snapshot.content,
        fileId: snapshot.snapshotFileId,
        fileName: snapshot.fileName,
        authorUserId: snapshot.authorUserId,
        authorUsername: snapshot.authorUsernameSnapshot,
        shareKeys: [],
      }
    }
  }
  if (!option) fail(404, 'CONTENT_OPTION_NOT_FOUND', '内容版本不存在或不可用')
  return { loaded, option }
}

export async function previewTrainingContentOption(
  trainingId: number,
  trainingProblemId: string,
  userId: string,
  optionKey: string,
) {
  const { option } = await resolveManagerOption(trainingId, trainingProblemId, userId, optionKey)
  return {
    ...publicOption(option),
    content: option.content,
    hasFile: Boolean(option.fileId),
  }
}

export async function downloadTrainingContentOption(
  trainingId: number,
  trainingProblemId: string,
  userId: string,
  optionKey: string,
) {
  const { option } = await resolveManagerOption(trainingId, trainingProblemId, userId, optionKey)
  if (!option.fileId) fail(404, 'CONTENT_PDF_NOT_FOUND', 'PDF 不存在')
  return fileService.download(option.fileId)
}

export async function updateTrainingContentSelection(input: {
  trainingId: number
  trainingProblemId: string
  userId: string
  statementOptionKey: string
  solutionOptionKey: string
}) {
  const { loaded, organizationId } = await managerOptions(
    input.trainingId,
    input.trainingProblemId,
    input.userId,
  )
  try {
    const created = await selectTrainingProblemContent({
      trainingProblemId: loaded.trainingProblem.id,
      problemId: loaded.trainingProblem.problemId,
      selectedBy: input.userId,
      organizationId,
      statementOptionKey: input.statementOptionKey,
      solutionOptionKey: input.solutionOptionKey,
    })
    return { snapshots: created.map(item => ({ kind: item.kind, revision: item.revision })) }
  } catch (error) {
    if (error instanceof TrainingContentError) throw error
    fail(400, 'CONTENT_SELECTION_INVALID', error instanceof Error ? error.message : '内容选择失败')
  }
}

export async function downloadTrainingContentSnapshot(input: {
  trainingId: number
  trainingProblemId: string
  userId: string
  kind: ContentKind
}) {
  const loaded = await requireContext(input.trainingId, input.trainingProblemId, input.userId)
  if (input.kind === 'solution') {
    const isAdmin = await canManageTraining(input.userId, loaded.training)
    const solutionAllowed = isAdmin
      || loaded.training.solutionVisible
      || loaded.training.status === 'finished'
      || new Date() > loaded.training.endTime
    if (!solutionAllowed) fail(403, 'SOLUTION_NOT_VISIBLE', '题解尚未开放')
  }
  const snapshot = await latestContentSnapshot(loaded.trainingProblem.id, input.kind)
  if (!snapshot?.snapshotFileId) fail(404, 'CONTENT_PDF_NOT_FOUND', 'PDF 不存在')
  return fileService.download(snapshot.snapshotFileId)
}
