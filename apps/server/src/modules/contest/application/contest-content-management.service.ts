import crypto from 'node:crypto'
import { prisma } from '../../../prisma'
import { fileService } from '../../../lib/storage'
import { canAccessContest, canManageContest, requireContestStarted } from '../contest.helpers'
import {
  activityOrganizationId,
  listContentOptions,
  publicOption,
  type ContentKind,
  type ContentOption,
} from '../../problem/problem.content.service'
import { findActivityForAccess } from '../../contest/contest-query.facade'

export class ContestContentError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message) }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new ContestContentError(statusCode, code, message)
}

export function parseContentKind(value: string): ContentKind {
  if (value !== 'statement' && value !== 'solution') fail(404, 'CONTENT_KIND_NOT_FOUND', '内容类型不存在')
  return value
}

const managedFileId = (url: string | null | undefined) =>
  url?.match(/\/api\/files\/([^/?#]+)\/(?:download|public)/)?.[1] || null

async function loadContext(contestId: number, contestProblemId: string) {
  const access = await findActivityForAccess(contestId)
  const contest = access?.activity || null
  const row = access?.contest ? await prisma.contestProblem.findFirst({
    where: { id: contestProblemId, contestId: access.contest.id },
    include: { CanonicalProblem: true, ContestResource: { orderBy: { uploadedAt: 'desc' } } },
  }) : null
  if (!contest || !row?.canonicalProblemId) fail(404, 'CONTEST_PROBLEM_NOT_FOUND', '比赛题目不存在')
  return { contest, contestProblem: { ...row, problemId: row.canonicalProblemId } }
}

async function requireContext(contestId: number, contestProblemId: string, userId: string, manager = false) {
  const loaded = await loadContext(contestId, contestProblemId)
  const allowed = manager
    ? await canManageContest(userId, loaded.contest)
    : await canAccessContest(userId, loaded.contest)
  if (!allowed) fail(403, 'CONTEST_CONTENT_FORBIDDEN', '无权限')
  if (!manager) {
    const notStarted = await requireContestStarted(loaded.contest, userId)
    if (notStarted) fail(403, 'CONTEST_NOT_STARTED', notStarted)
  }
  return loaded
}

export async function getContestMyContent(contestId: number, contestProblemId: string, userId: string) {
  const { contestProblem } = await requireContext(contestId, contestProblemId, userId)
  const contents = await prisma.userProblemContent.findMany({
    where: { problemId: contestProblem.problemId, userId, deletedAt: null },
    orderBy: { kind: 'asc' },
  })
  return {
    contents: contents.map(item => ({
      id: item.id, kind: item.kind, title: item.title, format: item.format,
      language: item.language, content: item.content, fileId: item.fileId,
      fileUrl: item.fileId ? `/api/files/${item.fileId}/download` : null,
      revision: item.revision, updatedAt: item.updatedAt.toISOString(),
      shareKeys: item.visibility === 'public' ? ['platform'] : [],
    })),
    shareTargets: [],
  }
}

async function removeResources(contestProblemId: string, kind: ContentKind) {
  const rows = await prisma.contestResource.findMany({
    where: { contestProblemId, fileType: kind }, select: { id: true, fileUrl: true },
  })
  await prisma.contestResource.deleteMany({ where: { id: { in: rows.map(row => row.id) } } })
  await Promise.all(rows.map(row => {
    const fileId = managedFileId(row.fileUrl)
    return fileId ? fileService.softDelete(fileId).catch(() => undefined) : Promise.resolve()
  }))
}

async function applyMarkdown(contestProblemId: string, kind: ContentKind, content: string) {
  await removeResources(contestProblemId, kind)
  return prisma.contestProblem.update({
    where: { id: contestProblemId },
    data: kind === 'statement'
      ? { statementType: 'markdown', statementMarkdown: content, updatedAt: new Date() }
      : { solutionType: 'markdown', solutionMarkdown: content, updatedAt: new Date() },
  })
}

async function applyPdf(contestId: string, contestProblemId: string, kind: ContentKind, fileId: string, fileName: string) {
  await removeResources(contestProblemId, kind)
  await prisma.$transaction(async tx => {
    await tx.contestResource.create({ data: {
      id: crypto.randomUUID(), contestId, contestProblemId, fileName,
      fileType: kind, fileFormat: 'pdf', fileUrl: `/api/files/${fileId}/download`,
      visibleRoles: 'all', uploadedBy: 'system',
    } })
    await tx.contestProblem.update({
      where: { id: contestProblemId },
      data: kind === 'statement'
        ? { statementType: 'pdf', statementMarkdown: null, updatedAt: new Date() }
        : { solutionType: 'pdf', solutionMarkdown: null, updatedAt: new Date() },
    })
  })
}

export async function editContestContentMarkdown(input: {
  contestId: number; contestProblemId: string; userId: string; kind: ContentKind; snapshotId: string; content: string
}) {
  const loaded = await requireContext(input.contestId, input.contestProblemId, input.userId, true)
  await applyMarkdown(loaded.contestProblem.id, input.kind, input.content)
  return { id: loaded.contestProblem.id, kind: input.kind, format: 'markdown', content: input.content }
}

export async function replaceContestContentPdf(input: {
  contestId: number; contestProblemId: string; userId: string; kind: ContentKind; snapshotId: string; file?: Express.Multer.File
}) {
  const loaded = await requireContext(input.contestId, input.contestProblemId, input.userId, true)
  if (!input.file) fail(400, 'PDF_REQUIRED', '请选择 PDF 文件')
  const uploaded = await fileService.uploadFromMulter(input.file, {
    category: 'pdf', ownerType: 'contest', ownerId: loaded.contestProblem.id, isPublic: false,
  })
  try {
    await applyPdf(loaded.contestProblem.contestId, loaded.contestProblem.id, input.kind, uploaded.id, uploaded.originalName)
    return { id: loaded.contestProblem.id, kind: input.kind, format: 'pdf', fileName: uploaded.originalName }
  } catch (error) {
    await fileService.softDelete(uploaded.id).catch(() => undefined)
    throw error
  }
}

async function managerOptions(contestId: number, contestProblemId: string, userId: string) {
  const loaded = await requireContext(contestId, contestProblemId, userId, true)
  const organizationId = await activityOrganizationId(loaded.contest)
  const options = await listContentOptions(loaded.contestProblem.problemId, userId, organizationId)
  return { loaded, options }
}

function selectedOptionKey(kind: ContentKind, loaded: Awaited<ReturnType<typeof loadContext>>, candidates: ContentOption[]) {
  const markdown = kind === 'statement' ? loaded.contestProblem.statementMarkdown : loaded.contestProblem.solutionMarkdown
  const type = kind === 'statement' ? loaded.contestProblem.statementType : loaded.contestProblem.solutionType
  if (type === 'none') return 'none'
  if (type === 'markdown') return candidates.find(option => option.format === 'markdown' && option.content === markdown)?.key || null
  const resource = loaded.contestProblem.ContestResource.find(item => item.fileType === kind)
  const fileId = managedFileId(resource?.fileUrl)
  return candidates.find(option => option.format === 'pdf' && option.fileId === fileId)?.key || null
}

export async function getContestContentOptions(contestId: number, contestProblemId: string, userId: string) {
  const { loaded, options } = await managerOptions(contestId, contestProblemId, userId)
  return {
    statement: options.statement.map(publicOption),
    solution: options.solution.map(publicOption),
    currentSelection: {
      statementOptionKey: selectedOptionKey('statement', loaded, options.statement),
      solutionOptionKey: selectedOptionKey('solution', loaded, options.solution),
      statementRevision: null,
      solutionRevision: null,
    },
  }
}

async function resolveManagerOption(contestId: number, contestProblemId: string, userId: string, encodedKey: string) {
  const { loaded, options } = await managerOptions(contestId, contestProblemId, userId)
  let key: string
  try { key = decodeURIComponent(encodedKey) } catch { fail(400, 'CONTENT_OPTION_KEY_INVALID', '内容版本参数无效') }
  const option = [...options.statement, ...options.solution].find(item => item.key === key)
  if (!option) fail(404, 'CONTENT_OPTION_NOT_FOUND', '内容版本不存在或不可用')
  return { loaded, option }
}

export async function previewContestContentOption(contestId: number, contestProblemId: string, userId: string, optionKey: string) {
  const { option } = await resolveManagerOption(contestId, contestProblemId, userId, optionKey)
  return { ...publicOption(option), content: option.content, hasFile: Boolean(option.fileId) }
}

export async function downloadContestContentOption(contestId: number, contestProblemId: string, userId: string, optionKey: string) {
  const { option } = await resolveManagerOption(contestId, contestProblemId, userId, optionKey)
  if (!option.fileId) fail(404, 'CONTENT_PDF_NOT_FOUND', 'PDF 不存在')
  return fileService.download(option.fileId)
}

async function applyOption(loaded: Awaited<ReturnType<typeof loadContext>>, kind: ContentKind, option: ContentOption) {
  if (option.format === 'pdf') {
    if (!option.fileId) fail(400, 'CONTENT_SELECTION_INVALID', '所选 PDF 文件不存在')
    const source = await fileService.download(option.fileId)
    const copied = await fileService.upload(source.buffer, {
      category: 'pdf', ownerType: 'contest', ownerId: loaded.contestProblem.id,
      originalName: source.originalName, mimeType: source.mimeType, isPublic: false,
    })
    await applyPdf(loaded.contestProblem.contestId, loaded.contestProblem.id, kind, copied.id, copied.originalName)
    return
  }
  if (option.format === 'none') {
    await removeResources(loaded.contestProblem.id, kind)
    await prisma.contestProblem.update({
      where: { id: loaded.contestProblem.id },
      data: kind === 'statement'
        ? { statementType: 'none', statementMarkdown: null, updatedAt: new Date() }
        : { solutionType: 'none', solutionMarkdown: null, updatedAt: new Date() },
    })
    return
  }
  await applyMarkdown(loaded.contestProblem.id, kind, option.content || '')
}

export async function updateContestContentSelection(input: {
  contestId: number; contestProblemId: string; userId: string; statementOptionKey: string; solutionOptionKey: string
}) {
  const { loaded, options } = await managerOptions(input.contestId, input.contestProblemId, input.userId)
  const statement = options.statement.find(option => option.key === input.statementOptionKey)
  const solution = options.solution.find(option => option.key === input.solutionOptionKey)
  if (!statement || !solution) fail(400, 'CONTENT_SELECTION_INVALID', '所选题面或题解不可用')
  await applyOption(loaded, 'statement', statement)
  await applyOption(loaded, 'solution', solution)
  return { snapshots: [{ kind: 'statement', revision: null }, { kind: 'solution', revision: null }] }
}

export async function downloadContestContentSnapshot(input: {
  contestId: number; contestProblemId: string; userId: string; kind: ContentKind
}) {
  const loaded = await requireContext(input.contestId, input.contestProblemId, input.userId)
  if (input.kind === 'solution') {
    const isAdmin = await canManageContest(input.userId, loaded.contest)
    const solutionAllowed = isAdmin || loaded.contest.solutionVisible
      || loaded.contest.status === 'finished' || new Date() > loaded.contest.endTime
    if (!solutionAllowed) fail(403, 'SOLUTION_NOT_VISIBLE', '题解尚未开放')
  }
  const resource = loaded.contestProblem.ContestResource.find(item => item.fileType === input.kind)
  const fileId = managedFileId(resource?.fileUrl)
  if (!fileId) fail(404, 'CONTENT_PDF_NOT_FOUND', 'PDF 不存在')
  return fileService.download(fileId)
}
