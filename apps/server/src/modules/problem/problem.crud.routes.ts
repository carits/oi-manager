import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate, getWorkspaceMode, isPersonalWorkspace } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parsePagination, paginatedResponse } from '../../lib/pagination'
import { generateCaritsProblemId } from './problem.helpers'
import logger from '../../lib/logger'
import {
  canCopyProblemToSchool,
  canModifyProblem,
  canViewProblem,
  isPlatformManager,
  isSchoolStaff,
  problemLibraryKey,
  problemPermissions,
} from './problem.access'
import { copyPlatformProblemToSchool } from './problem.copy'

export const problemCrudRouter = Router()

function parsePlatforms(problem: { platform: string; ojBindings: string | null }) {
  if (problem.ojBindings) {
    try {
      const bindings = JSON.parse(problem.ojBindings)
      if (Array.isArray(bindings)) {
        const values = bindings.map(binding => binding?.platform).filter(Boolean)
        if (values.length > 0) return values
      }
    } catch {}
  }
  return problem.platform ? [problem.platform] : []
}

function ownerDisplay(owner: { username: string; Teacher: { name: string } | null; Admin: { name: string } | null }, usernameOnly = false) {
  return usernameOnly ? owner.username : owner.Teacher?.name || owner.Admin?.name || owner.username
}

function resolveRequestedLibrary(req: any): 'platform' | 'school' {
  if (req.query.library === 'platform' || req.query.visibility === 'public') return 'platform'
  if (req.query.library === 'school' || req.query.visibility === 'private') return 'school'
  return isPersonalWorkspace(req.user) || isPlatformManager(req.user.role) ? 'platform' : 'school'
}

problemCrudRouter.get('/', authenticate, asyncHandler(async (req, res) => {
  const user = req.user!
  const personalWorkspace = isPersonalWorkspace(user)
  const library = resolveRequestedLibrary(req)

  if (user.role === 'student' && !personalWorkspace) {
    return res.status(403).json({ success: false, code: 'TEACHER_ONLY', message: '校内题库仅对教师开放' })
  }
  if (library === 'school') {
    if (getWorkspaceMode(user) !== 'work') {
      return res.status(403).json({ success: false, code: 'WORKSPACE_MODE_REQUIRED', message: '请先切换到工作模式' })
    }
    if (!isSchoolStaff(user.role)) {
      return res.status(403).json({ success: false, code: 'TEACHER_ONLY', message: '校内题库仅对教师开放' })
    }
    if (!user.schoolId) {
      return res.status(403).json({ success: false, code: 'SCHOOL_MEMBERSHIP_REQUIRED', message: '当前账号未关联学校' })
    }
  }

  const { status, keyword, platform, ownerId } = req.query
  const { page, pageSize, skip } = parsePagination(req.query)
  const where: any = library === 'platform'
    ? {
        libraryScope: 'platform',
        ...(isPlatformManager(user.role) && !personalWorkspace ? {} : { status: 'published' }),
      }
    : {
        libraryScope: 'school',
        schoolId: user.schoolId,
        ...(user.role === 'school_principal' ? {} : { OR: [{ status: 'published' }, { ownerId: user.userId }] }),
        status: { not: 'archived' },
      }

  if (typeof status === 'string' && ['draft', 'published', 'archived'].includes(status)) where.status = status
  if (typeof ownerId === 'string' && library === 'school') where.ownerId = ownerId
  if (typeof keyword === 'string' && keyword.trim()) {
    where.AND = [
      ...(where.AND || []),
      { OR: [{ problemId: { contains: keyword.trim() } }, { title: { contains: keyword.trim(), mode: 'insensitive' } }] },
    ]
  }
  if (typeof platform === 'string' && platform) where.platform = platform

  const [problems, total] = await Promise.all([
    prisma.problem.findMany({
      where,
      include: { Owner: { select: { username: true, Teacher: { select: { name: true } }, Admin: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.problem.count({ where }),
  ])

  const data = problems.map(({ Owner, ...problem }) => ({
    ...problem,
    ownerName: ownerDisplay(Owner, personalWorkspace),
    platforms: parsePlatforms(problem),
    permissions: problemPermissions(user, problem),
  }))

  res.json({ success: true, data: paginatedResponse(data, total, page, pageSize) })
}))

problemCrudRouter.post('/', authenticate, asyncHandler(async (req, res) => {
  const user = req.user!
  if (getWorkspaceMode(user) !== 'work') {
    return res.status(403).json({ success: false, code: 'WORKSPACE_MODE_REQUIRED', message: '请先切换到工作模式' })
  }
  if (!isSchoolStaff(user.role) && !isPlatformManager(user.role)) {
    return res.status(403).json({ success: false, code: 'TEACHER_ONLY', message: '只有教师或平台管理员可以创建题目' })
  }
  if (isSchoolStaff(user.role) && !user.schoolId) {
    return res.status(403).json({ success: false, code: 'SCHOOL_MEMBERSHIP_REQUIRED', message: '当前账号未关联学校' })
  }

  const {
    title,
    description,
    statementType = 'none',
    solutionType = 'none',
    solutionMarkdown,
    solutionVisible = false,
    difficulty,
    timeLimit,
    memoryLimit,
    status = 'draft',
    ojBindings,
    statements = [],
    solutions = [],
  } = req.body
  if (!title || !String(title).trim()) {
    return res.status(400).json({ success: false, message: '标题不能为空' })
  }
  if (!['draft', 'published'].includes(status)) {
    return res.status(400).json({ success: false, message: '题目状态无效' })
  }

  const libraryScope = isSchoolStaff(user.role) ? 'school' : 'platform'
  const libraryKey = problemLibraryKey(libraryScope, user.schoolId)
  const schoolId = libraryScope === 'school' ? user.schoolId! : null
  let platform = 'carits'
  let problemId = await generateCaritsProblemId()
  if (Array.isArray(ojBindings) && ojBindings.length > 0) {
    platform = ojBindings[0]?.platform || 'carits'
    problemId = String(ojBindings[0]?.problemId || '')
    if (!problemId) return res.status(400).json({ success: false, message: '题号不能为空' })
    if (platform === 'carits' && !/^\d+$/.test(problemId)) {
      return res.status(400).json({ success: false, message: 'Carits 题号必须是纯数字' })
    }
  }

  const duplicate = await prisma.problem.findUnique({
    where: { libraryKey_platform_problemId: { libraryKey, platform, problemId } },
  })
  if (duplicate) {
    return res.status(409).json({ success: false, code: 'PROBLEM_EXISTS', message: `${platform}-${problemId} 已存在`, data: { id: duplicate.id } })
  }

  const problem = await prisma.problem.create({
    data: {
      id: crypto.randomUUID(),
      platform,
      problemId,
      title: String(title).trim(),
      description: description || null,
      statementType,
      solutionType,
      solutionMarkdown: solutionMarkdown || null,
      solutionVisible: !!solutionVisible,
      difficulty: difficulty || null,
      timeLimit: timeLimit === undefined || timeLimit === null || timeLimit === '' ? null : Number(timeLimit),
      memoryLimit: memoryLimit === undefined || memoryLimit === null || memoryLimit === '' ? null : Number(memoryLimit),
      ownerId: user.userId,
      ownerType: libraryScope === 'school' ? 'teacher' : 'admin',
      libraryScope,
      libraryKey,
      schoolId,
      visibility: libraryScope === 'school' ? 'private' : 'public',
      status,
      publishedAt: status === 'published' ? new Date() : null,
      ojBindings: Array.isArray(ojBindings) ? JSON.stringify(ojBindings) : null,
    },
  })

  const versions = [
    ...statements.map((item: any) => ({ ...item, type: 'statement' })),
    ...solutions.map((item: any) => ({ ...item, type: 'solution' })),
  ]
  for (const version of versions) {
    if (!version.content && !version.fileUrl) continue
    await prisma.problemStatement.create({
      data: {
        id: crypto.randomUUID(),
        problemId: problem.id,
        type: version.type,
        format: version.format,
        language: version.language || null,
        content: version.content || null,
        fileUrl: version.fileUrl || null,
        isVisible: version.isVisible ?? true,
      },
    })
  }
  if (description && !statements.some((item: any) => item.format === 'markdown' && item.language === 'zh')) {
    await prisma.problemStatement.create({
      data: { id: crypto.randomUUID(), problemId: problem.id, type: 'statement', format: 'markdown', language: 'zh', content: description, isVisible: true },
    })
  }
  if (solutionMarkdown && !solutions.some((item: any) => item.format === 'markdown' && item.language === 'zh')) {
    await prisma.problemStatement.create({
      data: { id: crypto.randomUUID(), problemId: problem.id, type: 'solution', format: 'markdown', language: 'zh', content: solutionMarkdown, isVisible: !!solutionVisible },
    })
  }

  logger.audit('problem_created', {
    userId: user.userId,
    action: 'create_problem',
    target: `${libraryKey}:${platform}-${problemId}`,
    metadata: { libraryScope, schoolId, status },
  })
  res.status(201).json({ success: true, data: { ...problem, permissions: problemPermissions(user, problem) } })
}))

problemCrudRouter.post('/:id/copy-to-school', authenticate, asyncHandler(async (req, res) => {
  const user = req.user!
  const source = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!source || !canCopyProblemToSchool(user, source)) {
    return res.status(404).json({ success: false, message: '题目不存在' })
  }
  if (!user.schoolId) {
    return res.status(403).json({ success: false, code: 'SCHOOL_MEMBERSHIP_REQUIRED', message: '当前账号未关联学校' })
  }

  const result = await copyPlatformProblemToSchool(source.id, user.userId, user.schoolId)
  if (!result) return res.status(404).json({ success: false, message: '题目不存在' })
  if (result.existing) {
    return res.status(409).json({
      success: false,
      code: 'SCHOOL_PROBLEM_EXISTS',
      message: '本校题库已存在该题目',
      data: { id: result.existing.id },
    })
  }

  logger.audit('problem_copied_to_school', {
    userId: user.userId,
    action: 'copy_problem_to_school',
    target: result.created!.id,
    metadata: { sourceProblemId: source.id, schoolId: user.schoolId, skippedFileCount: result.skippedFiles.length },
  })
  res.status(201).json({ success: true, data: { problem: result.created, skippedFiles: result.skippedFiles } })
}))

problemCrudRouter.get('/library/creators', authenticate, asyncHandler(async (req, res) => {
  const user = req.user!
  if (getWorkspaceMode(user) !== 'work') {
    return res.status(403).json({ success: false, code: 'WORKSPACE_MODE_REQUIRED', message: '请先切换到工作模式' })
  }
  if (!isSchoolStaff(user.role)) {
    return res.status(403).json({ success: false, code: 'TEACHER_ONLY', message: '校内题库仅对教师开放' })
  }
  if (!user.schoolId) {
    return res.status(403).json({ success: false, code: 'SCHOOL_MEMBERSHIP_REQUIRED', message: '当前账号未关联学校' })
  }

  const visibleProblemWhere: any = {
    libraryScope: 'school',
    schoolId: user.schoolId,
    status: { not: 'archived' },
    ...(user.role === 'school_principal' ? {} : { OR: [{ status: 'published' }, { ownerId: user.userId }] }),
  }
  const owners = await prisma.problem.groupBy({
    by: ['ownerId'],
    where: visibleProblemWhere,
    _count: { _all: true },
  })
  const users = await prisma.user.findMany({
    where: { id: { in: owners.map(owner => owner.ownerId) } },
    select: { id: true, username: true, Teacher: { select: { name: true } } },
  })
  const countByOwner = new Map(owners.map(owner => [owner.ownerId, owner._count._all]))
  res.json({
    success: true,
    data: users
      .map(owner => ({ id: owner.id, name: owner.Teacher?.name || owner.username, count: countByOwner.get(owner.id) || 0 }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
  })
}))

problemCrudRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const user = req.user!
  const problem = await prisma.problem.findUnique({
    where: { id: req.params.id },
    include: {
      Owner: { select: { username: true, Teacher: { select: { name: true } }, Admin: { select: { name: true } } } },
      ProblemStatement: { orderBy: [{ type: 'asc' }, { format: 'asc' }, { language: 'asc' }] },
    },
  })
  if (!problem || !canViewProblem(user, problem)) {
    return res.status(404).json({ success: false, message: '题目不存在' })
  }

  const canEdit = canModifyProblem(user, problem)
  const statements = problem.ProblemStatement.filter(item => item.type === 'statement' && item.isVisible)
  const solutions = problem.ProblemStatement.filter(item =>
    item.type === 'solution' && (canEdit || item.isVisible))
  const { ProblemStatement, Owner, ...data } = problem
  res.json({
    success: true,
    data: {
      ...data,
      judgeConfig: canEdit ? data.judgeConfig : null,
      solutionMarkdown: canEdit || data.solutionVisible ? data.solutionMarkdown : null,
      solutionPdfUrl: canEdit || data.solutionVisible ? data.solutionPdfUrl : null,
      ownerName: ownerDisplay(Owner, isPersonalWorkspace(user)),
      statements,
      solutions,
      platforms: parsePlatforms(data),
      permissions: problemPermissions(user, data),
    },
  })
}))

async function syncStatements(problemId: string, statements: any[] = [], solutions: any[] = []) {
  const existing = await prisma.problemStatement.findMany({ where: { problemId } })
  const retained = new Set<string>()
  const versions = [
    ...statements.map(item => ({ ...item, type: 'statement' })),
    ...solutions.map(item => ({ ...item, type: 'solution' })),
  ]
  for (const version of versions) {
    if (!version.content && !version.fileUrl) continue
    const current = version.id && !String(version.id).startsWith('legacy-')
      ? existing.find(item => item.id === version.id)
      : existing.find(item => item.type === version.type && item.format === version.format && item.language === (version.language || null))
    if (current) {
      retained.add(current.id)
      await prisma.problemStatement.update({
        where: { id: current.id },
        data: { content: version.content || null, fileUrl: version.fileUrl || null, isVisible: version.isVisible ?? true },
      })
    } else {
      const created = await prisma.problemStatement.create({
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
  for (const item of existing) {
    if (!retained.has(item.id)) await prisma.problemStatement.delete({ where: { id: item.id } })
  }
}

problemCrudRouter.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const user = req.user!
  const existing = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!existing || !canModifyProblem(user, existing)) {
    return res.status(404).json({ success: false, message: '题目不存在' })
  }

  const {
    title,
    description,
    statementType,
    solutionType,
    solutionMarkdown,
    solutionVisible,
    difficulty,
    timeLimit,
    memoryLimit,
    status,
    ojBindings,
    statements,
    solutions,
  } = req.body
  if (status !== undefined && !['draft', 'published', 'archived'].includes(status)) {
    return res.status(400).json({ success: false, message: '题目状态无效' })
  }

  const updateData: any = {
    title: title === undefined ? undefined : String(title).trim(),
    description,
    statementType,
    solutionType,
    solutionMarkdown,
    solutionVisible,
    difficulty,
    timeLimit: timeLimit === undefined ? undefined : timeLimit === null || timeLimit === '' ? null : Number(timeLimit),
    memoryLimit: memoryLimit === undefined ? undefined : memoryLimit === null || memoryLimit === '' ? null : Number(memoryLimit),
    status,
    publishedAt: status === undefined
      ? undefined
      : status === 'published'
        ? existing.publishedAt || new Date()
        : null,
    visibility: existing.libraryScope === 'school' ? 'private' : 'public',
  }
  if (ojBindings !== undefined) {
    updateData.ojBindings = Array.isArray(ojBindings) ? JSON.stringify(ojBindings) : null
    if (Array.isArray(ojBindings) && ojBindings.length > 0) {
      updateData.platform = ojBindings[0].platform || existing.platform
      updateData.problemId = String(ojBindings[0].problemId || existing.problemId)
    }
  }

  let problem
  try {
    problem = await prisma.problem.update({ where: { id: existing.id }, data: updateData })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, code: 'PROBLEM_EXISTS', message: '当前题库已存在相同平台题号' })
    }
    throw error
  }
  if (statements !== undefined || solutions !== undefined) {
    await syncStatements(existing.id, statements || [], solutions || [])
  }

  logger.audit('problem_updated', {
    userId: user.userId,
    action: 'update_problem',
    target: existing.id,
    metadata: { schoolId: existing.schoolId, status: problem.status },
  })
  res.json({ success: true, data: { ...problem, permissions: problemPermissions(user, problem) } })
}))

problemCrudRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const user = req.user!
  const existing = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!existing || !canModifyProblem(user, existing)) {
    return res.status(404).json({ success: false, message: '题目不存在' })
  }
  if (existing.status === 'archived') {
    return res.json({ success: true, message: '题目已归档' })
  }

  await prisma.problem.update({ where: { id: existing.id }, data: { status: 'archived' } })
  logger.audit('problem_archived', {
    userId: user.userId,
    action: 'archive_problem',
    target: existing.id,
    metadata: { schoolId: existing.schoolId, libraryScope: existing.libraryScope },
  })
  res.json({ success: true, message: '题目已归档' })
}))
