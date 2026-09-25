import { prisma } from '../../../prisma'
import { fileService } from '../../../lib/storage'
import { canAccessContest, canManageContest, requireContestStarted } from '../contest.helpers'
import { activityOrganizationId, listContentOptions, type ContentOption } from '../../problem/problem.content.service'
import { findActivityForAccess } from '../../contest/contest-query.facade'

export class ContestStatementManagementError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message) }
}
function fail(statusCode: number, code: string, message: string): never { throw new ContestStatementManagementError(statusCode, code, message) }
const managedFileId = (url: string | null | undefined) => url?.match(/\/api\/files\/([^/?#]+)\/(?:download|public)/)?.[1] || null

async function loadContest(contestId: number) {
  const access = await findActivityForAccess(contestId)
  if (!access) return null
  const contest = await prisma.contest.findUnique({
    where: { id: access.contest.id },
    include: {
      Team: { select: { organizationId: true } },
      ContestProblem: {
        orderBy: { orderIndex: 'asc' },
        include: { CanonicalProblem: { select: { id: true, title: true } }, ContestResource: true },
      },
    },
  })
  return contest ? { activity: access.activity, contest } : null
}

function livePublicOption(option: ContentOption, managerId: string) {
  const author = option.authorUsername || 'System'
  const name = option.sourceType === 'canonical'
    ? option.language === 'zh' ? '官方中文' : option.language === 'en' ? 'Official English' : '官方题面'
    : option.title || option.fileName || '用户题面'
  const groupKey = option.sourceType === 'canonical'
    ? `canonical:${option.language || 'none'}:${option.format}`
    : `user:${option.authorUserId}:${name.normalize('NFKC').toLocaleLowerCase('zh-CN')}:${option.language || 'none'}:${option.format}`
  return {
    key: option.key, groupKey, name, title: option.title, authorUsername: author,
    language: option.language, format: option.format,
    visibility: option.sourceType === 'canonical' ? 'public' : option.authorUserId === managerId ? 'mine' : 'public',
    sourceType: option.sourceType, sourceContentId: option.sourceId, unavailable: false,
  }
}

async function optionsForProblem(problemId: string, managerId: string, organizationId: string | null) {
  const options = await listContentOptions(problemId, managerId, organizationId)
  const raw = options.statement.filter(item => item.sourceType !== 'none')
  return { raw, public: raw.map(item => livePublicOption(item, managerId)) }
}

async function requireManagedContest(contestId: number, userId: string) {
  const loaded = await loadContest(contestId)
  if (!loaded) fail(404, 'CONTEST_NOT_FOUND', '比赛不存在')
  if (!await canManageContest(userId, loaded.activity)) fail(403, 'CONTEST_STATEMENT_MANAGE_DENIED', '无权管理比赛题面')
  return loaded
}

function currentKey(problem: any, options: ContentOption[]) {
  if (problem.statementType === 'markdown') {
    return options.find(option => option.format === 'markdown' && option.content === problem.statementMarkdown)?.key || null
  }
  if (problem.statementType === 'pdf') {
    const resource = problem.ContestResource.find((item: any) => item.fileType === 'statement')
    const fileId = managedFileId(resource?.fileUrl)
    return options.find(option => option.format === 'pdf' && option.fileId === fileId)?.key || null
  }
  return null
}

export async function getContestStatementManagement(contestId: number, userId: string) {
  const loaded = await requireManagedContest(contestId, userId)
  const organizationId = await activityOrganizationId(loaded.activity)
  const problems = []
  for (const problem of loaded.contest.ContestProblem) {
    if (!problem.canonicalProblemId || !problem.CanonicalProblem) continue
    const { raw, public: options } = await optionsForProblem(problem.canonicalProblemId, userId, organizationId)
    const selectedKey = currentKey(problem, raw)
    problems.push({
      contestProblemId: problem.id, alias: problem.alias, orderIndex: problem.orderIndex,
      title: problem.title || problem.CanonicalProblem.title, selectionRevision: 0,
      options, selected: selectedKey ? [{ key: selectedKey, isDefault: true, orderIndex: 0 }] : [],
    })
  }
  return { contest: { id: loaded.activity.id, title: loaded.activity.title, type: 'contest' }, problems }
}

type StatementSelection = { contestProblemId?: unknown; visibleOptionKeys?: unknown; defaultOptionKey?: unknown; expectedSelectionRevision?: unknown }

async function replaceStatementPdf(contestId: string, contestProblemId: string, option: ContentOption, selectedBy: string) {
  if (!option.fileId) fail(400, 'STATEMENT_OPTION_UNAVAILABLE', '所选 PDF 题面不存在')
  const source = await fileService.download(option.fileId)
  const copied = await fileService.upload(source.buffer, {
    category: 'pdf', ownerType: 'contest', ownerId: contestProblemId,
    originalName: source.originalName, mimeType: source.mimeType, isPublic: false,
  })
  const old = await prisma.contestResource.findMany({ where: { contestProblemId, fileType: 'statement' } })
  await prisma.$transaction(async tx => {
    await tx.contestResource.deleteMany({ where: { contestProblemId, fileType: 'statement' } })
    await tx.contestResource.create({ data: {
      id: copied.id, contestId, contestProblemId, fileName: copied.originalName,
      fileType: 'statement', fileFormat: 'pdf', fileUrl: `/api/files/${copied.id}/download`,
      visibleRoles: 'all', uploadedBy: selectedBy,
    } })
    await tx.contestProblem.update({ where: { id: contestProblemId }, data: {
      statementType: 'pdf', statementMarkdown: null, updatedAt: new Date(),
    } })
  })
  await Promise.all(old.map(item => {
    const id = managedFileId(item.fileUrl)
    return id ? fileService.softDelete(id).catch(() => undefined) : Promise.resolve()
  }))
}

export async function saveContestStatementManagement(input: { contestId: number; userId: string; selections: unknown }) {
  const loaded = await requireManagedContest(input.contestId, input.userId)
  const selections: StatementSelection[] = Array.isArray(input.selections) ? input.selections : []
  if (selections.length !== loaded.contest.ContestProblem.length) fail(400, 'STATEMENT_SELECTION_INCOMPLETE', '必须提交比赛中全部题目的题面选择')
  const organizationId = await activityOrganizationId(loaded.activity)
  const changed = []
  for (const problem of loaded.contest.ContestProblem) {
    if (!problem.canonicalProblemId) fail(422, 'CANONICAL_PROBLEM_REQUIRED', '比赛题目缺少规范题目身份')
    const selection = selections.find(item => String(item.contestProblemId || '') === problem.id)
    if (!selection) fail(400, 'STATEMENT_SELECTION_INCOMPLETE', '必须提交比赛中全部题目的题面选择')
    const defaultKey = String(selection.defaultOptionKey || '')
    const visibleKeys = Array.isArray(selection.visibleOptionKeys) ? selection.visibleOptionKeys.map(String) : []
    if (!defaultKey || !visibleKeys.includes(defaultKey)) fail(400, 'STATEMENT_DEFAULT_REQUIRED', '每道题必须指定默认题面')
    const options = await listContentOptions(problem.canonicalProblemId, input.userId, organizationId)
    const selected = options.statement.find(option => option.key === defaultKey && option.sourceType !== 'none')
    if (!selected) fail(400, 'STATEMENT_OPTION_UNAVAILABLE', '题面版本不存在或不可用')
    if (selected.format === 'pdf') await replaceStatementPdf(loaded.contest.id, problem.id, selected, input.userId)
    else {
      const old = await prisma.contestResource.findMany({ where: { contestProblemId: problem.id, fileType: 'statement' } })
      await prisma.$transaction(async tx => {
        await tx.contestResource.deleteMany({ where: { contestProblemId: problem.id, fileType: 'statement' } })
        await tx.contestProblem.update({ where: { id: problem.id }, data: {
          statementType: 'markdown', statementMarkdown: selected.content || '', updatedAt: new Date(),
        } })
      })
      await Promise.all(old.map(item => {
        const id = managedFileId(item.fileUrl)
        return id ? fileService.softDelete(id).catch(() => undefined) : Promise.resolve()
      }))
    }
    changed.push({ contestProblemId: problem.id, revision: null })
  }
  return { changedCount: changed.length, revisions: changed }
}

async function requireAccessibleProblem(contestId: number, contestProblemId: string, userId: string, hideUnauthorized = false) {
  const loaded = await loadContest(contestId)
  const problem = loaded?.contest.ContestProblem.find(item => item.id === contestProblemId)
  if (!loaded || !problem) fail(404, 'CONTEST_PROBLEM_NOT_FOUND', hideUnauthorized ? '文件不存在' : '比赛题目不存在')
  if (!await canAccessContest(userId, loaded.activity)) fail(hideUnauthorized ? 404 : 403, 'CONTEST_STATEMENT_FORBIDDEN', hideUnauthorized ? '文件不存在' : '无权限')
  const notStarted = await requireContestStarted(loaded.activity, userId)
  if (notStarted) fail(403, 'CONTEST_NOT_STARTED', notStarted)
  return { loaded, problem }
}

export async function getContestStatementVersions(contestId: number, contestProblemId: string, userId: string) {
  const { loaded, problem } = await requireAccessibleProblem(contestId, contestProblemId, userId)
  const isManager = await canManageContest(userId, loaded.activity)
  const resource = problem.ContestResource.find(item => item.fileType === 'statement')
  const hasFile = problem.statementType === 'pdf' && Boolean(managedFileId(resource?.fileUrl))
  if (problem.statementType === 'none') return { selectionRevision: 0, statements: [] }
  return {
    selectionRevision: 0,
    statements: [{
      id: problem.id, name: problem.title || problem.CanonicalProblem?.title || '比赛题面',
      title: problem.title || problem.CanonicalProblem?.title || null, language: 'zh',
      format: problem.statementType, content: problem.statementMarkdown, hasFile,
      authorUsername: isManager ? 'System' : null, isDefault: true, orderIndex: 0,
    }],
  }
}

export async function downloadContestStatementVersion(input: { contestId: number; contestProblemId: string; snapshotId: string; userId: string }) {
  const { problem } = await requireAccessibleProblem(input.contestId, input.contestProblemId, input.userId, true)
  if (input.snapshotId !== problem.id) fail(404, 'STATEMENT_PDF_NOT_FOUND', 'PDF 不存在')
  const resource = problem.ContestResource.find(item => item.fileType === 'statement')
  const fileId = managedFileId(resource?.fileUrl)
  if (!fileId) fail(404, 'STATEMENT_PDF_NOT_FOUND', 'PDF 不存在')
  return fileService.download(fileId)
}
