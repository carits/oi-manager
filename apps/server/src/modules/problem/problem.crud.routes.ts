/**
 * Problem CRUD Routes
 * 题目 CRUD 路由：列表、创建、详情、更新、删除
 */

import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parsePagination, paginatedResponse } from '../../lib/pagination'
import { generateCaritsProblemId, getOwnerInfo, canModifyProblem } from './problem.helpers'
import path from 'path'
import fs from 'fs'
import logger from '../../lib/logger'
import { fileService } from '../../lib/storage'

export const problemCrudRouter = Router()

// ==================== 获取题目列表 ====================
problemCrudRouter.get('/', authenticate, asyncHandler(async (req, res) => {
    const userId = (req as any).user.userId
    const role = (req as any).user.role

    // 校园模式学生使用学校题单；个人模式学生可管理自己的题库。
    if (role === 'student' && (req as any).user.studentMode !== 'personal') {
      return res.status(403).json({ success: false, message: '校园模式下学生不能访问题库' })
    }

    const { visibility, status, keyword, platform } = req.query
    const { page, pageSize, skip } = parsePagination(req.query)

    const where: any = {}

    // 根据角色和visibility参数构建查询条件
    if (role === 'super_admin' || role === 'platform_admin') {
      // 管理员可以看到所有题目
      if (visibility === 'private') {
        where.visibility = 'private'
      } else if (visibility === 'public') {
        where.visibility = 'public'
      }
      // visibility=all或不传则显示全部
    } else {
      // 教师和学生：私有显示自己的，公共显示所有公共的
      const ownerInfo = await getOwnerInfo(userId, role)
      if (!ownerInfo) {
        return res.status(403).json({ success: false, message: '用户信息不存在' })
      }

      if (visibility === 'public') {
        where.visibility = 'public'
        where.status = 'published'
      } else {
        // 默认显示私有（自己的）
        where.visibility = 'private'
        where.ownerId = ownerInfo.ownerId
        where.ownerType = ownerInfo.ownerType
      }
    }

    if (status) {
      where.status = status
    }

    // 关键词搜索（匹配题号或标题）
    if (keyword && typeof keyword === 'string') {
      where.OR = [
        { problemId: { contains: keyword } },
        { title: { contains: keyword } }
      ]
    }

    // 平台筛选（直接用 platform 字段，支持索引）
    if (platform && typeof platform === 'string') {
      where.platform = platform
    }

    let problems = await prisma.problem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    })

    // 获取总数
    let total = await prisma.problem.count({ where })

    // 获取所有者名称
    const ownerIds = [...new Set(problems.map(p => p.ownerId))]
    const ownerTypes = [...new Set(problems.map(p => p.ownerType))]

    const teachers = ownerTypes.includes('teacher')
      ? await prisma.teacher.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
      : []
    const students = ownerTypes.includes('student')
      ? await prisma.student.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
      : []
    const admins = ownerTypes.includes('admin')
      ? await prisma.admin.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
      : []

    const ownerMap = new Map<string, string>()
    teachers.forEach(t => ownerMap.set(t.id, t.name))
    students.forEach(s => ownerMap.set(s.id, s.name))
    admins.forEach(a => ownerMap.set(a.id, a.name))

    const problemsWithOwner = problems.map(p => {
      // 从 ojBindings 中提取平台列表（兼容旧数据）
      let platforms: string[] = []
      if (p.ojBindings) {
        try {
          const bindings = JSON.parse(p.ojBindings)
          if (Array.isArray(bindings)) {
            platforms = bindings.map((b: any) => b.platform).filter(Boolean)
          }
        } catch {}
      }
      // 如果 ojBindings 为空但 platform 有值，用 platform 字段
      if (platforms.length === 0 && p.platform) {
        platforms = [p.platform]
      }
      return {
        ...p,
        ownerName: ownerMap.get(p.ownerId) || '未知',
        platforms
      }
    })

    res.json({
      success: true,
      data: paginatedResponse(problemsWithOwner, total, page, pageSize)
    })
}))

// ==================== 创建题目 ====================
problemCrudRouter.post('/', authenticate, asyncHandler(async (req, res) => {
    const userId = (req as any).user.userId
    const role = (req as any).user.role
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
      visibility,
      ojBindings,
      statements = [],
      solutions = []
    } = req.body

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: '标题不能为空' })
    }

    const ownerInfo = await getOwnerInfo(userId, role)
    if (!ownerInfo) {
      return res.status(403).json({ success: false, message: '用户信息不存在' })
    }

    // 确定可见性：只有管理员可以创建公共题目
    let problemVisibility = 'private'
    if ((role === 'super_admin' || role === 'platform_admin') && visibility === 'public') {
      problemVisibility = 'public'
    }

    // 确定平台和题号
    let platform: string
    let problemId: string
    if (ojBindings && Array.isArray(ojBindings) && ojBindings.length > 0) {
      const firstBinding = ojBindings[0]
      platform = firstBinding.platform || 'carits'
      problemId = String(firstBinding.problemId)
      // Carits 平台题号必须是纯数字
      if (platform === 'carits' && !/^\d+$/.test(problemId)) {
        return res.status(400).json({ success: false, message: 'Carits 题号必须是纯数字' })
      }
      // 检查是否已存在
      const existing = await prisma.problem.findUnique({ where: { platform_problemId: { platform, problemId } } })
      if (existing) {
        return res.status(409).json({ success: false, message: `题目 ${platform}-${problemId} 已存在` })
      }
    } else {
      platform = 'carits'
      problemId = await generateCaritsProblemId()
    }

    const { v4: uuidv4 } = await import('uuid')
    const createData: any = {
      platform,
      problemId,
      title: title.trim(),
      statementType,
      solutionType,
      solutionVisible,
      difficulty,
      timeLimit,
      memoryLimit,
      ownerId: ownerInfo.ownerId,
      ownerType: ownerInfo.ownerType,
      visibility: problemVisibility,
      status
    }

    // 兼容旧字段：始终保存 description 和 solutionMarkdown（如果有内容）
    if (description) createData.description = description
    if (solutionMarkdown) createData.solutionMarkdown = solutionMarkdown
    if (ojBindings) createData.ojBindings = JSON.stringify(ojBindings)

    const problem = await prisma.problem.create({ data: createData })

    // 创建多版本题面/题解
    const allStatements = [
      ...statements.map((s: any) => ({ ...s, type: 'statement' as const })),
      ...solutions.map((s: any) => ({ ...s, type: 'solution' as const }))
    ]

    for (const stmt of allStatements) {
      if (stmt.content || stmt.fileUrl) {
        await prisma.problemStatement.create({
          data: {
            id: crypto.randomUUID(),
            problemId: problem.id,
            type: stmt.type,
            format: stmt.format,
            language: stmt.language || null,
            content: stmt.content || null,
            fileUrl: stmt.fileUrl || null,
            isVisible: stmt.isVisible ?? true
          }
        })
      }
    }

    // 如果有旧的 description 但没有新的 statements，自动创建一条
    if (description && !statements.some((s: any) => s.format === 'markdown' && s.language === 'zh')) {
      await prisma.problemStatement.create({
        data: {
          id: crypto.randomUUID(),
          problemId: problem.id,
          type: 'statement',
          format: 'markdown',
          language: 'zh',
          content: description,
          isVisible: true
        }
      })
    }

    // 如果有旧的 solutionMarkdown 但没有新的 solutions，自动创建一条
    if (solutionMarkdown && !solutions.some((s: any) => s.format === 'markdown' && s.language === 'zh')) {
      await prisma.problemStatement.create({
        data: {
          id: crypto.randomUUID(),
          problemId: problem.id,
          type: 'solution',
          format: 'markdown',
          language: 'zh',
          content: solutionMarkdown,
          isVisible: solutionVisible
        }
      })
    }

    logger.audit('problem_created', {
      userId,
      action: 'create_problem',
      target: `${platform}-${problemId}`,
      metadata: { title, visibility: problemVisibility }
    })

    res.json({ success: true, data: { ...problem, ownerName: role === 'student' ? (await prisma.student.findUnique({ where: { id: ownerInfo.ownerId } }))?.name : (await prisma.teacher.findUnique({ where: { id: ownerInfo.ownerId } }))?.name || '管理员' } })
}))

// ==================== 获取题目详情 ====================
problemCrudRouter.get('/:id', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params
    const user = (req as any).user
    const role = user.role
    const userId = user.userId

    // 校园模式学生使用学校题单；个人模式学生可管理自己的题库。
    if (role === 'student' && user.studentMode !== 'personal') {
      return res.status(403).json({ success: false, message: '校园模式下学生不能访问题库' })
    }

    const problem = await prisma.problem.findUnique({
      where: { id },
      include: {
        ProblemStatement: {
          orderBy: [{ type: 'asc' }, { format: 'asc' }, { language: 'asc' }]
        }
      }
    })

    if (!problem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    // 可见性检查：私有题目只有管理员和题目所有者可以查看
    if (problem.visibility === 'private' && role !== 'super_admin' && role !== 'platform_admin') {
      const ownerInfo = await getOwnerInfo(userId, role)
      if (!ownerInfo || ownerInfo.ownerId !== problem.ownerId || ownerInfo.ownerType !== problem.ownerType) {
        return res.status(403).json({ success: false, message: '无权查看该题目' })
      }
    }

    // 获取所有者名称
    let ownerName = '未知'
    if (problem.ownerType === 'teacher') {
      const teacher = await prisma.teacher.findUnique({ where: { id: problem.ownerId }, select: { name: true } })
      ownerName = teacher?.name || '未知'
    } else if (problem.ownerType === 'student') {
      const student = await prisma.student.findUnique({ where: { id: problem.ownerId }, select: { name: true } })
      ownerName = student?.name || '未知'
    } else if (problem.ownerType === 'admin') {
      const admin = await prisma.admin.findUnique({ where: { id: problem.ownerId }, select: { name: true } })
      ownerName = admin?.name || '管理员'
    }

    // 将 ProblemStatement 分组为 statements 和 solutions
    const statements = problem.ProblemStatement
      .filter(s => s.type === 'statement')
      .map(s => ({
        id: s.id,
        format: s.format,
        language: s.language,
        content: s.content,
        fileUrl: s.fileUrl,
        isVisible: s.isVisible
      }))

    const solutions = problem.ProblemStatement
      .filter(s => s.type === 'solution')
      .map(s => ({
        id: s.id,
        format: s.format,
        language: s.language,
        content: s.content,
        fileUrl: s.fileUrl,
        isVisible: s.isVisible
      }))

    // 移除原始 ProblemStatement 字段
    const { ProblemStatement: _, ...problemData } = problem

    res.json({
      success: true,
      data: {
        ...problemData,
        ownerName,
        statements,
        solutions
      }
    })
}))

// ==================== 更新题目 ====================
problemCrudRouter.put('/:id', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params
    const user = (req as any).user
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
      visibility,
      ojBindings,
      statements,
      solutions
    } = req.body

    const existingProblem = await prisma.problem.findUnique({ where: { id } })

    if (!existingProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    if (!canModifyProblem(user, existingProblem)) {
      return res.status(403).json({ success: false, message: '没有权限编辑此题目' })
    }

    const { v4: uuidv4 } = await import('uuid')
    const updateData: any = {
      title: title?.trim(),
      statementType,
      solutionType,
      solutionVisible,
      difficulty,
      timeLimit,
      memoryLimit,
      status
    }

    if (statementType === 'markdown') {
      updateData.description = description
    }
    if (solutionType === 'markdown') {
      updateData.solutionMarkdown = solutionMarkdown
    }
    if (ojBindings !== undefined) {
      updateData.ojBindings = ojBindings ? JSON.stringify(ojBindings) : null
      // 如果 ojBindings 有内容，同时更新 platform 和 problemId
      if (ojBindings && Array.isArray(ojBindings) && ojBindings.length > 0) {
        updateData.platform = ojBindings[0].platform || existingProblem.platform
        updateData.problemId = String(ojBindings[0].problemId) || existingProblem.problemId
      }
    }

    // 只有管理员可以修改可见性
    if ((user.role === 'super_admin' || user.role === 'platform_admin') && visibility) {
      updateData.visibility = visibility
    }

    const problem = await prisma.problem.update({
      where: { id },
      data: updateData
    })

    // 处理多版本题面/题解更新
    if (statements !== undefined || solutions !== undefined) {
      // 获取现有的 statements
      const existingStatements = await prisma.problemStatement.findMany({
        where: { problemId: id }
      })

      // 构建 ID 集合
      const newStatementIds = new Set<string>()
      const allStatements = [
        ...(statements || []).map((s: any) => ({ ...s, type: 'statement' as const })),
        ...(solutions || []).map((s: any) => ({ ...s, type: 'solution' as const }))
      ]

      // 更新或创建
      for (const stmt of allStatements) {
        // 检查是否是有效的 UUID（legacy- 开头的是前端生成的假 ID）
        const isValidId = stmt.id && !stmt.id.startsWith('legacy-')

        if (isValidId) {
          // 检查该 ID 是否存在于数据库中
          const existsInDb = existingStatements.some(e => e.id === stmt.id)
          if (existsInDb) {
            // 更新现有记录（通过 ID）
            newStatementIds.add(stmt.id)
            await prisma.problemStatement.update({
              where: { id: stmt.id },
              data: {
                content: stmt.content,
                fileUrl: stmt.fileUrl,
                isVisible: stmt.isVisible
              }
            })
            continue
          }
          // ID 无效（不存在于数据库），继续执行创建逻辑
        }

        if (stmt.content || stmt.fileUrl) {
          // 查找是否存在相同唯一键的记录
          const existingStmt = existingStatements.find(
            e => e.type === stmt.type && e.format === stmt.format && e.language === (stmt.language || null)
          )

          if (existingStmt) {
            // 更新现有记录
            newStatementIds.add(existingStmt.id)
            await prisma.problemStatement.update({
              where: { id: existingStmt.id },
              data: {
                content: stmt.content,
                fileUrl: stmt.fileUrl,
                isVisible: stmt.isVisible
              }
            })
          } else {
            // 创建新记录
            const newStmt = await prisma.problemStatement.create({
              data: {
                id: uuidv4(),
                problemId: id,
                type: stmt.type,
                format: stmt.format,
                language: stmt.language || null,
                content: stmt.content || null,
                fileUrl: stmt.fileUrl || null,
                isVisible: stmt.isVisible ?? true,
                updatedAt: new Date()
              }
            })
            newStatementIds.add(newStmt.id)
          }
        }
      }

      // 删除不再需要的记录
      for (const existing of existingStatements) {
        if (!newStatementIds.has(existing.id)) {
          await prisma.problemStatement.delete({
            where: { id: existing.id }
          })
        }
      }
    }

    logger.audit('problem_updated', {
      userId: user.userId,
      action: 'update_problem',
      target: `${existingProblem.platform}-${existingProblem.problemId}`,
      metadata: { title }
    })

    res.json({ success: true, data: problem })
}))

// ==================== 删除题目 ====================
problemCrudRouter.delete('/:id', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params
    const user = (req as any).user

    const existingProblem = await prisma.problem.findUnique({ where: { id } })

    if (!existingProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    if (!canModifyProblem(user, existingProblem)) {
      return res.status(403).json({ success: false, message: '没有权限删除此题目' })
    }

    // 删除关联的 PDF 文件（旧格式）
    if (existingProblem.statementPdfUrl && existingProblem.statementPdfUrl.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '../../', existingProblem.statementPdfUrl)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
    if (existingProblem.solutionPdfUrl && existingProblem.solutionPdfUrl.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '../../', existingProblem.solutionPdfUrl)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }

    // 删除关联的 File 记录（新格式）
    const relatedFiles = await prisma.file.findMany({
      where: { ownerType: 'problem', ownerId: id }
    })
    for (const file of relatedFiles) {
      await fileService.hardDelete(file.id)
    }

    // 删除关联的附件记录
    const attachments = await prisma.problemAttachment.findMany({
      where: { problemId: id }
    })
    for (const att of attachments) {
      // 如果是新格式的 File API URL
      if (att.fileUrl.startsWith('/api/files/')) {
        const fileId = att.fileUrl.split('/')[3]
        await fileService.hardDelete(fileId).catch(() => {}) // 忽略错误
      }
      // 旧格式的物理文件
      if (att.fileUrl.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '../../', att.fileUrl)
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      }
    }

    // 真删除题目
    await prisma.problem.delete({ where: { id } })

    logger.audit('problem_deleted', {
      userId: user.userId,
      action: 'delete_problem',
      target: `${existingProblem.platform}-${existingProblem.problemId}`,
      metadata: { title: existingProblem.title }
    })

    res.json({ success: true, message: '删除成功' })
}))
