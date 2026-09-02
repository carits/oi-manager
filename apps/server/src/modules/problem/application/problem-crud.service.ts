import crypto from 'crypto'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../../prisma'
import { isPersonalContext } from '../../../middleware/auth'
import { paginatedResponse } from '../../../lib/pagination'
import logger from '../../../lib/logger'
import { generateCaritsProblemId } from '../problem.helpers'
import {
  canCopyProblemToSchool,
  canModifyProblem,
  canViewProblem,
  isPlatformManager,
  isSchoolStaff,
  problemLibraryKey,
  problemPermissions,
} from '../problem.access'
import { copyPlatformProblemToSchool } from '../problem.copy'
import { isHackableJudgeConfig, parseJudgeConfig, resolveJudgeMode } from '../problem.hack.service'
import { legacySubmissionIoSuggestion } from '../../judge/domain/submission-io'

export class ProblemCrudError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string, data?: unknown): never {
  throw new ProblemCrudError(statusCode, code, message, data)
}

function parsePlatforms(problem: { platform: string; ojBindings: string | null }) {
  if (problem.ojBindings) {
    try {
      const bindings = JSON.parse(problem.ojBindings)
      if (Array.isArray(bindings)) {
        const values = bindings.map(binding => binding?.platform).filter(Boolean)
        if (values.length > 0) return values
      }
    } catch { /* legacy malformed binding falls back to primary platform */ }
  }
  return problem.platform ? [problem.platform] : []
}

function resolveRequestedLibrary(
  user: JwtPayload,
  query: Record<string, unknown>,
): 'platform' | 'school' {
  if (query.library === 'platform' || query.visibility === 'public') return 'platform'
  if (query.library === 'school' || query.visibility === 'private') return 'school'
  return isPersonalContext(user) || isPlatformManager(user.role) ? 'platform' : 'school'
}

function requireLibraryAccess(user: JwtPayload, library: 'platform' | 'school') {
  const personalWorkspace = isPersonalContext(user)
  if (user.role === 'student' && !personalWorkspace) {
    fail(403, 'TEACHER_ONLY', '校内题库仅对教师开放')
  }
  if (library !== 'school') return
  if (!isSchoolStaff(user.role)) fail(403, 'TEACHER_ONLY', '校内题库仅对教师开放')
  if (!user.organizationId) {
    fail(403, 'ORGANIZATION_REQUIRED', 'Current identity is not assigned to an organization')
  }
}

export async function listProblems(input: {
  user: JwtPayload
  query: Record<string, unknown>
  pagination: { page: number; pageSize: number; skip: number }
}) {
  const personalWorkspace = isPersonalContext(input.user)
  const library = resolveRequestedLibrary(input.user, input.query)
  requireLibraryAccess(input.user, library)

  const where: any = library === 'platform'
    ? {
        libraryScope: 'platform',
        ...(isPlatformManager(input.user.role) && !personalWorkspace ? {} : { status: 'published' }),
      }
    : {
        libraryScope: 'school',
        organizationId: input.user.organizationId,
        ...(input.user.role === 'school_principal'
          ? {}
          : { OR: [{ status: 'published' }, { ownerId: input.user.userId }] }),
        status: { not: 'archived' },
      }

  const { status, keyword, platform, ownerId } = input.query
  const sourceGroup = input.query.sourceGroup
  if (sourceGroup !== undefined && sourceGroup !== 'carits' && sourceGroup !== 'external') {
    fail(400, 'INVALID_PROBLEM_SOURCE_GROUP', '题库来源分组无效')
  }
  if (sourceGroup !== undefined && library !== 'platform') {
    fail(400, 'INVALID_PROBLEM_SOURCE_GROUP', '校内题库不支持平台来源分组')
  }
  if (sourceGroup === 'carits' && typeof platform === 'string' && platform && platform !== 'carits') {
    fail(400, 'INVALID_PROBLEM_SOURCE_GROUP', 'Carits 平台题库不能筛选其他平台')
  }
  if (sourceGroup === 'external' && platform === 'carits') {
    fail(400, 'INVALID_PROBLEM_SOURCE_GROUP', '其他题库不能筛选 Carits 平台')
  }
  if (typeof status === 'string' && ['draft', 'published', 'archived'].includes(status)) {
    where.status = status
  }
  if (typeof ownerId === 'string' && library === 'school') where.ownerId = ownerId
  if (typeof keyword === 'string' && keyword.trim()) {
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { problemId: { contains: keyword.trim() } },
          { title: { contains: keyword.trim(), mode: 'insensitive' } },
        ],
      },
    ]
  }
  if (sourceGroup === 'carits') {
    where.platform = 'carits'
  } else if (sourceGroup === 'external' && !(typeof platform === 'string' && platform)) {
    where.platform = { not: 'carits' }
  } else if (typeof platform === 'string' && platform) {
    where.platform = platform
  }

  const [problems, total] = await Promise.all([
    prisma.problem.findMany({
      where,
      include: { Owner: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      skip: input.pagination.skip,
      take: input.pagination.pageSize,
    }),
    prisma.problem.count({ where }),
  ])
  const data = problems.map(({ Owner, ...problem }) => ({
    ...problem,
    ownerName: Owner.username,
    platforms: parsePlatforms(problem),
    permissions: problemPermissions(input.user, problem),
  }))
  return paginatedResponse(
    data,
    total,
    input.pagination.page,
    input.pagination.pageSize,
  )
}

function normalizeOptionalNumber(value: unknown, fieldName: string) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) fail(400, 'INVALID_PROBLEM_LIMIT', `${fieldName}无效`)
  return parsed
}

function normalizeVersions(statements: unknown, solutions: unknown) {
  if (!Array.isArray(statements) || !Array.isArray(solutions)) {
    fail(400, 'INVALID_PROBLEM_CONTENT', '题面和题解版本格式无效')
  }
  return [
    ...statements.map((item: any) => ({ ...item, type: 'statement' })),
    ...solutions.map((item: any) => ({ ...item, type: 'solution' })),
  ]
}

function validateVersion(version: any) {
  if (!version.content && !version.fileUrl) return false
  if (typeof version.format !== 'string' || !version.format) {
    fail(400, 'INVALID_PROBLEM_CONTENT', '题面或题解格式不能为空')
  }
  return true
}

export async function createProblem(user: JwtPayload, body: any) {
  if (!isSchoolStaff(user.role) && !isPlatformManager(user.role)) {
    fail(403, 'TEACHER_ONLY', '只有教师或平台管理员可以创建题目')
  }
  if (isSchoolStaff(user.role) && !user.organizationId) {
    fail(403, 'ORGANIZATION_REQUIRED', 'Current identity is not assigned to an organization')
  }

  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) fail(400, 'PROBLEM_TITLE_REQUIRED', '标题不能为空')
  const status = body?.status ?? 'draft'
  if (!['draft', 'published'].includes(status)) fail(400, 'INVALID_PROBLEM_STATUS', '题目状态无效')
  const statements = body?.statements ?? []
  const solutions = body?.solutions ?? []
  const versions = normalizeVersions(statements, solutions)

  const libraryScope = isSchoolStaff(user.role) ? 'school' : 'platform'
  const organizationId = libraryScope === 'school' ? user.organizationId! : null
  const libraryKey = problemLibraryKey(libraryScope, user.organizationId)
  let platform = 'carits'
  let problemId = await generateCaritsProblemId()
  const ojBindings = body?.ojBindings
  if (ojBindings !== undefined && !Array.isArray(ojBindings)) {
    fail(400, 'INVALID_OJ_BINDINGS', 'OJ 绑定格式无效')
  }
  if (Array.isArray(ojBindings) && ojBindings.length > 0) {
    platform = String(ojBindings[0]?.platform || 'carits')
    problemId = String(ojBindings[0]?.problemId || '')
    if (!problemId) fail(400, 'PROBLEM_ID_REQUIRED', '题号不能为空')
    if (platform === 'carits' && !/^\d+$/.test(problemId)) {
      fail(400, 'INVALID_CARITS_PROBLEM_ID', 'Carits 题号必须是纯数字')
    }
  }

  let problem
  try {
    problem = await prisma.$transaction(async tx => {
      const duplicate = await tx.problem.findUnique({
        where: { libraryKey_platform_problemId: { libraryKey, platform, problemId } },
        select: { id: true },
      })
      if (duplicate) {
        fail(
          409,
          'PROBLEM_EXISTS',
          `${platform}-${problemId} 已存在`,
          { id: duplicate.id },
        )
      }
      const created = await tx.problem.create({
        data: {
          id: crypto.randomUUID(),
          platform,
          problemId,
          title,
          description: body?.description || null,
          statementType: body?.statementType ?? 'none',
          solutionType: body?.solutionType ?? 'none',
          solutionMarkdown: body?.solutionMarkdown || null,
          solutionVisible: Boolean(body?.solutionVisible),
          difficulty: body?.difficulty || null,
          timeLimit: normalizeOptionalNumber(body?.timeLimit, '时间限制') ?? null,
          memoryLimit: normalizeOptionalNumber(body?.memoryLimit, '内存限制') ?? null,
          ownerId: user.userId,
          ownerType: libraryScope === 'school' ? 'teacher' : 'admin',
          libraryScope,
          libraryKey,
          organizationId,
          visibility: libraryScope === 'school' ? 'private' : 'public',
          status,
          publishedAt: status === 'published' ? new Date() : null,
          ojBindings: Array.isArray(ojBindings) ? JSON.stringify(ojBindings) : null,
        },
      })

      for (const version of versions) {
        if (!validateVersion(version)) continue
        await tx.problemStatement.create({
          data: {
            id: crypto.randomUUID(),
            problemId: created.id,
            type: version.type,
            format: version.format,
            language: version.language || null,
            content: version.content || null,
            fileUrl: version.fileUrl || null,
            isVisible: version.isVisible ?? true,
          },
        })
      }
      if (
        body?.description
        && !statements.some((item: any) => item.format === 'markdown' && item.language === 'zh')
      ) {
        await tx.problemStatement.create({
          data: {
            id: crypto.randomUUID(),
            problemId: created.id,
            type: 'statement',
            format: 'markdown',
            language: 'zh',
            content: body.description,
            isVisible: true,
          },
        })
      }
      if (
        body?.solutionMarkdown
        && !solutions.some((item: any) => item.format === 'markdown' && item.language === 'zh')
      ) {
        await tx.problemStatement.create({
          data: {
            id: crypto.randomUUID(),
            problemId: created.id,
            type: 'solution',
            format: 'markdown',
            language: 'zh',
            content: body.solutionMarkdown,
            isVisible: Boolean(body.solutionVisible),
          },
        })
      }
      return created
    })
  } catch (error: any) {
    if (error instanceof ProblemCrudError) throw error
    if (error?.code === 'P2002') {
      fail(409, 'PROBLEM_EXISTS', `${platform}-${problemId} 已存在`)
    }
    throw error
  }

  logger.audit('problem_created', {
    userId: user.userId,
    action: 'create_problem',
    target: `${libraryKey}:${platform}-${problemId}`,
    metadata: { libraryScope, organizationId, status },
  })
  return { ...problem, permissions: problemPermissions(user, problem) }
}

export async function copyProblemIntoSchool(user: JwtPayload, problemId: string) {
  const source = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!source || !canCopyProblemToSchool(user, source)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  if (!user.organizationId) {
    fail(403, 'ORGANIZATION_REQUIRED', '当前账号未关联学校')
  }
  const result = await copyPlatformProblemToSchool(source.id, user.userId, user.organizationId)
  if (!result) fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  if (result.existing) {
    fail(
      409,
      'SCHOOL_PROBLEM_EXISTS',
      '本校题库已存在该题目',
      { id: result.existing.id },
    )
  }
  logger.audit('problem_copied_to_school', {
    userId: user.userId,
    action: 'copy_problem_to_school',
    target: result.created!.id,
    metadata: {
      sourceProblemId: source.id,
      organizationId: user.organizationId,
      skippedFileCount: result.skippedFiles.length,
    },
  })
  return { problem: result.created, skippedFiles: result.skippedFiles }
}

export async function listSchoolProblemCreators(user: JwtPayload) {
  if (!isSchoolStaff(user.role)) fail(403, 'TEACHER_ONLY', '校内题库仅对教师开放')
  if (!user.organizationId) {
    fail(403, 'SCHOOL_MEMBERSHIP_REQUIRED', '当前账号未关联学校')
  }
  const where: any = {
    libraryScope: 'school',
    organizationId: user.organizationId,
    status: { not: 'archived' },
    ...(user.role === 'school_principal'
      ? {}
      : { OR: [{ status: 'published' }, { ownerId: user.userId }] }),
  }
  const owners = await prisma.problem.groupBy({
    by: ['ownerId'],
    where,
    _count: { _all: true },
  })
  const users = await prisma.user.findMany({
    where: { id: { in: owners.map(owner => owner.ownerId) } },
    select: { id: true, username: true },
  })
  const countByOwner = new Map(owners.map(owner => [owner.ownerId, owner._count._all]))
  return users
    .map(owner => ({ id: owner.id, name: owner.username, count: countByOwner.get(owner.id) || 0 }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
}

export async function getProblemDetail(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    include: {
      Owner: { select: { username: true } },
      ProblemStatement: {
        orderBy: [{ type: 'asc' }, { format: 'asc' }, { language: 'asc' }],
      },
      ProblemHackConfig: { select: { enabled: true } },
    },
  })
  if (!problem || !canViewProblem(user, problem)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  const canEdit = canModifyProblem(user, problem)
  const statements = problem.ProblemStatement.filter(item => (
    item.type === 'statement' && item.isVisible
  ))
  const solutions = problem.ProblemStatement.filter(item => (
    item.type === 'solution' && (canEdit || item.isVisible)
  ))
  const acceptedHackCount = await prisma.problemHackAttempt.count({
    where: { problemId: problem.id, status: 'accepted' },
  })
  const { ProblemStatement, ProblemHackConfig, Owner, ...data } = problem
  const permissions = problemPermissions(user, data)
  const judgeConfig = parseJudgeConfig(data.judgeConfig)
  const hackable = isHackableJudgeConfig(judgeConfig)
  const legacyIo = legacySubmissionIoSuggestion(judgeConfig)
  return {
    ...data,
    judgeConfig: canEdit ? data.judgeConfig : null,
    solutionMarkdown: canEdit || data.solutionVisible ? data.solutionMarkdown : null,
    solutionPdfUrl: canEdit || data.solutionVisible ? data.solutionPdfUrl : null,
    ownerName: Owner.username,
    statements,
    solutions,
    platforms: parsePlatforms(data),
    permissions: {
      ...permissions,
      canSubmit: data.status === 'published' && permissions.canView,
    },
    hack: {
      enabled: Boolean(ProblemHackConfig?.enabled) && hackable,
      acceptedCount: acceptedHackCount,
      canHack: Boolean(ProblemHackConfig?.enabled)
        && hackable
        && data.status === 'published'
        && permissions.canView,
      mode: resolveJudgeMode(judgeConfig),
    },
    legacyIoSuggestion: legacyIo ? { inputFilename: legacyIo.inputFilename, outputFilename: legacyIo.outputFilename } : null,
  }
}

async function syncStatements(
  client: any,
  problemId: string,
  statements: unknown,
  solutions: unknown,
) {
  const versions = normalizeVersions(statements, solutions)
  const existing = await client.problemStatement.findMany({ where: { problemId } })
  const retained = new Set<string>()
  for (const version of versions) {
    if (!validateVersion(version)) continue
    const current = version.id && !String(version.id).startsWith('legacy-')
      ? existing.find((item: any) => item.id === version.id)
      : existing.find((item: any) => (
          item.type === version.type
          && item.format === version.format
          && item.language === (version.language || null)
        ))
    if (current) {
      retained.add(current.id)
      await client.problemStatement.update({
        where: { id: current.id },
        data: {
          content: version.content || null,
          fileUrl: version.fileUrl || null,
          isVisible: version.isVisible ?? true,
        },
      })
    } else {
      const created = await client.problemStatement.create({
        data: {
          id: crypto.randomUUID(),
          problemId,
          type: version.type,
          format: version.format,
          language: version.language || null,
          content: version.content || null,
          fileUrl: version.fileUrl || null,
          isVisible: version.isVisible ?? true,
        },
      })
      retained.add(created.id)
    }
  }
  await client.problemStatement.deleteMany({
    where: { problemId, id: { notIn: Array.from(retained) } },
  })
}

export async function updateProblem(user: JwtPayload, problemId: string, body: any) {
  const existing = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!existing || !canModifyProblem(user, existing)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  if (body?.status !== undefined && !['draft', 'published', 'archived'].includes(body.status)) {
    fail(400, 'INVALID_PROBLEM_STATUS', '题目状态无效')
  }
  if (body?.title !== undefined && !String(body.title).trim()) {
    fail(400, 'PROBLEM_TITLE_REQUIRED', '标题不能为空')
  }

  const updateData: any = {
    title: body?.title === undefined ? undefined : String(body.title).trim(),
    description: body?.description,
    statementType: body?.statementType,
    solutionType: body?.solutionType,
    solutionMarkdown: body?.solutionMarkdown,
    solutionVisible: body?.solutionVisible,
    difficulty: body?.difficulty,
    timeLimit: normalizeOptionalNumber(body?.timeLimit, '时间限制'),
    memoryLimit: normalizeOptionalNumber(body?.memoryLimit, '内存限制'),
    status: body?.status,
    publishedAt: body?.status === undefined
      ? undefined
      : body.status === 'published'
        ? existing.publishedAt || new Date()
        : null,
    visibility: existing.libraryScope === 'school' ? 'private' : 'public',
  }
  if (body?.ojBindings !== undefined) {
    if (!Array.isArray(body.ojBindings)) fail(400, 'INVALID_OJ_BINDINGS', 'OJ 绑定格式无效')
    updateData.ojBindings = JSON.stringify(body.ojBindings)
    if (body.ojBindings.length > 0) {
      const platform = String(body.ojBindings[0]?.platform || existing.platform)
      const nextProblemId = String(body.ojBindings[0]?.problemId || '')
      if (!nextProblemId) fail(400, 'PROBLEM_ID_REQUIRED', '题号不能为空')
      if (platform === 'carits' && !/^\d+$/.test(nextProblemId)) {
        fail(400, 'INVALID_CARITS_PROBLEM_ID', 'Carits 题号必须是纯数字')
      }
      updateData.platform = platform
      updateData.problemId = nextProblemId
    }
  }

  let problem
  try {
    problem = await prisma.$transaction(async tx => {
      const updated = await tx.problem.update({ where: { id: existing.id }, data: updateData })
      if (body?.statements !== undefined || body?.solutions !== undefined) {
        await syncStatements(
          tx,
          existing.id,
          body.statements || [],
          body.solutions || [],
        )
      }
      return updated
    })
  } catch (error: any) {
    if (error instanceof ProblemCrudError) throw error
    if (error?.code === 'P2002') {
      fail(409, 'PROBLEM_EXISTS', '当前题库已存在相同平台题号')
    }
    throw error
  }
  logger.audit('problem_updated', {
    userId: user.userId,
    action: 'update_problem',
    target: existing.id,
    metadata: { organizationId: existing.organizationId, status: problem.status },
  })
  return { ...problem, permissions: problemPermissions(user, problem) }
}

export async function archiveProblem(user: JwtPayload, problemId: string) {
  const existing = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!existing || !canModifyProblem(user, existing)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  if (existing.status === 'archived') return { changed: false, message: '题目已归档' }
  await prisma.problem.update({ where: { id: existing.id }, data: { status: 'archived' } })
  logger.audit('problem_archived', {
    userId: user.userId,
    action: 'archive_problem',
    target: existing.id,
    metadata: { organizationId: existing.organizationId, libraryScope: existing.libraryScope },
  })
  return { changed: true, message: '题目已归档' }
}
