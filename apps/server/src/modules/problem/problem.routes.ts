/**
 * Problem Module - Routes Layer
 * 题目模块路由层
 */

import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '../../prisma'
import { authenticate, authorize } from '../../middleware/auth'
import logger from '../../lib/logger'
import { fileService } from '../../lib/storage'
import { STORAGE_ROOT } from '../../config/storage'
import { generateCaritsProblemId, getOwnerInfo, canModifyProblem } from './problem.helpers'

export const problemsRouter = Router()

// 临时上传目录
const tempUploadDir = path.join(STORAGE_ROOT, 'temp/uploads')
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true })
}

// 配置题目文件上传（临时目录）
const problemStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempUploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
})

const problemUpload = multer({
  storage: problemStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf/
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
    const mimetype = file.mimetype === 'application/pdf'
    if (extname && mimetype) {
      cb(null, true)
    } else {
      cb(new Error('只支持 PDF 文件'))
    }
  }
})

// 配置附件上传（支持多种文件类型）
const attachmentUpload = multer({
  storage: problemStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    // 允许常见文件类型
    const allowedExtensions = /\.(pdf|zip|rar|7z|txt|cpp|c|py|java|pas|in|out|md)$/
    const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase())
    if (extname) {
      cb(null, true)
    } else {
      cb(new Error('不支持的文件类型'))
    }
  }
})

// ==================== 获取题目列表 ====================
problemsRouter.get('/', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.userId
    const role = (req as any).user.role
    const { visibility, status, page = 1, pageSize = 20, keyword, platform } = req.query

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
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize)
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
      data: {
        list: problemsWithOwner,
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(total / Number(pageSize))
      }
    })
  } catch (error) {
    logger.error('get_problems_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 创建题目 ====================
problemsRouter.post('/', authenticate, async (req, res) => {
  try {
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
  } catch (error) {
    logger.error('create_problem_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 获取题目详情 ====================
problemsRouter.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user
    const role = user.role
    const userId = user.userId

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
  } catch (error) {
    logger.error('get_problem_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 更新题目 ====================
problemsRouter.put('/:id', authenticate, async (req, res) => {
  try {
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
  } catch (error) {
    logger.error('update_problem_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 删除题目 ====================
problemsRouter.delete('/:id', authenticate, async (req, res) => {
  try {
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
  } catch (error) {
    logger.error('delete_problem_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 上传题面 PDF ====================
problemsRouter.post('/:id/statement-pdf', authenticate, problemUpload.single('file'), async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传 PDF 文件' })
    }

    const existingProblem = await prisma.problem.findUnique({ where: { id } })

    if (!existingProblem) {
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    if (!canModifyProblem(user, existingProblem)) {
      fs.unlinkSync(req.file.path)
      return res.status(403).json({ success: false, message: '没有权限' })
    }

    // 使用 FileService 上传文件（题面 PDF 公开访问）
    const result = await fileService.uploadFromMulter(req.file, {
      category: 'pdf',
      ownerType: 'problem',
      ownerId: id,
      isPublic: true
    })

    const pdfUrl = `/api/files/${result.id}/public`
    await prisma.problem.update({
      where: { id },
      data: { statementPdfUrl: pdfUrl, statementType: 'pdf' }
    })

    logger.audit('statement_pdf_uploaded', {
      userId: user.userId,
      action: 'upload_statement_pdf',
      target: id,
      metadata: { fileId: result.id, originalName: result.originalName }
    })

    res.json({ success: true, data: { pdfUrl, fileId: result.id } })
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    logger.error('upload_statement_pdf_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 上传题解 PDF ====================
problemsRouter.post('/:id/solution-pdf', authenticate, problemUpload.single('file'), async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传 PDF 文件' })
    }

    const existingProblem = await prisma.problem.findUnique({ where: { id } })

    if (!existingProblem) {
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    if (!canModifyProblem(user, existingProblem)) {
      fs.unlinkSync(req.file.path)
      return res.status(403).json({ success: false, message: '没有权限' })
    }

    // 使用 FileService 上传文件
    const result = await fileService.uploadFromMulter(req.file, {
      category: 'pdf',
      ownerType: 'problem',
      ownerId: id,
      isPublic: false
    })

    const pdfUrl = `/api/files/${result.id}/download`
    await prisma.problem.update({
      where: { id },
      data: { solutionPdfUrl: pdfUrl, solutionType: 'pdf' }
    })

    logger.audit('solution_pdf_uploaded', {
      userId: user.userId,
      action: 'upload_solution_pdf',
      target: id,
      metadata: { fileId: result.id, originalName: result.originalName }
    })

    res.json({ success: true, data: { pdfUrl, fileId: result.id } })
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    logger.error('upload_solution_pdf_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 获取思路记录 ====================
problemsRouter.get('/:id/note', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const userId = (req as any).user.userId
    const role = (req as any).user.role

    const ownerInfo = await getOwnerInfo(userId, role)
    if (!ownerInfo) {
      return res.status(403).json({ success: false, message: '用户信息不存在' })
    }

    const userType = role === 'student' ? 'student' : 'teacher'

    let note = await prisma.problemNote.findUnique({
      where: {
        problemId_userId_userType: {
          problemId: id,
          userId: ownerInfo.ownerId,
          userType
        }
      }
    })

    if (!note) {
      note = {
        id: '',
        problemId: id,
        userId: ownerInfo.ownerId,
        userType,
        content: '',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    }

    res.json({ success: true, data: note })
  } catch (error) {
    logger.error('get_problem_note_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 保存思路记录 ====================
problemsRouter.put('/:id/note', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const userId = (req as any).user.userId
    const role = (req as any).user.role
    const { content } = req.body

    const ownerInfo = await getOwnerInfo(userId, role)
    if (!ownerInfo) {
      return res.status(403).json({ success: false, message: '用户信息不存在' })
    }

    const userType = role === 'student' ? 'student' : 'teacher'

    const note = await prisma.problemNote.upsert({
      where: {
        problemId_userId_userType: {
          problemId: id,
          userId: ownerInfo.ownerId,
          userType
        }
      },
      update: { content: content || '' },
      create: {
        problemId: id,
        userId: ownerInfo.ownerId,
        userType,
        content: content || ''
      }
    })

    res.json({ success: true, data: note })
  } catch (error) {
    logger.error('save_problem_note_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 获取题目附件列表 ====================
problemsRouter.get('/:id/attachments', authenticate, async (req, res) => {
  try {
    const { id } = req.params

    const attachments = await prisma.problemAttachment.findMany({
      where: { problemId: id },
      orderBy: { uploadedAt: 'desc' }
    })

    res.json({ success: true, data: attachments })
  } catch (error) {
    logger.error('get_attachments_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 上传附件 ====================
problemsRouter.post('/:id/attachments', authenticate, attachmentUpload.single('file'), async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user
    const { description } = req.body

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传文件' })
    }

    const existingProblem = await prisma.problem.findUnique({ where: { id } })
    if (!existingProblem) {
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    if (!canModifyProblem(user, existingProblem)) {
      fs.unlinkSync(req.file.path)
      return res.status(403).json({ success: false, message: '没有权限' })
    }

    // 使用 FileService 上传文件
    const result = await fileService.uploadFromMulter(req.file, {
      category: 'attachment',
      ownerType: 'problem',
      ownerId: id,
      isPublic: false
    })

    const fileUrl = `/api/files/${result.id}/download`
    const attachment = await prisma.problemAttachment.create({
      data: {
        problemId: id,
        fileName: result.originalName,
        fileSize: result.fileSize,
        fileUrl,
        description: description || null
      }
    })

    logger.audit('attachment_uploaded', {
      userId: user.userId,
      action: 'upload_attachment',
      target: id,
      metadata: { fileId: result.id, attachmentId: attachment.id, originalName: result.originalName }
    })

    res.json({ success: true, data: { ...attachment, fileId: result.id } })
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    logger.error('upload_attachment_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 删除附件 ====================
problemsRouter.delete('/:id/attachments/:attachmentId', authenticate, async (req, res) => {
  try {
    const { id, attachmentId } = req.params
    const user = (req as any).user

    const existingProblem = await prisma.problem.findUnique({ where: { id } })
    if (!existingProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    if (!canModifyProblem(user, existingProblem)) {
      return res.status(403).json({ success: false, message: '没有权限' })
    }

    const attachment = await prisma.problemAttachment.findUnique({
      where: { id: attachmentId }
    })

    if (!attachment || attachment.problemId !== id) {
      return res.status(404).json({ success: false, message: '附件不存在' })
    }

    // 使用 fileService.softDelete 删除文件（软删除，移动到回收站）
    // fileUrl 格式: /api/files/{fileId}/download
    const fileIdMatch = attachment.fileUrl.match(/\/api\/files\/([^/]+)\/download/)
    if (fileIdMatch) {
      const fileId = fileIdMatch[1]
      await fileService.softDelete(fileId)
    }

    await prisma.problemAttachment.delete({ where: { id: attachmentId } })

    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    logger.error('delete_attachment_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 上传题面/题解 PDF（新统一接口） ====================
problemsRouter.post('/:id/statements/pdf', authenticate, problemUpload.single('file'), async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user
    const { type = 'statement' } = req.body // type: 'statement' | 'solution'

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传 PDF 文件' })
    }

    const existingProblem = await prisma.problem.findUnique({ where: { id } })

    if (!existingProblem) {
      fs.unlinkSync(req.file.path)
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    if (!canModifyProblem(user, existingProblem)) {
      fs.unlinkSync(req.file.path)
      return res.status(403).json({ success: false, message: '没有权限' })
    }

    // 检查是否已存在该类型的 PDF
    const existingPdf = await prisma.problemStatement.findFirst({
      where: { problemId: id, type, format: 'pdf' }
    })

    // 使用 FileService 上传文件（题面/题解 PDF 公开访问）
    const result = await fileService.uploadFromMulter(req.file, {
      category: 'pdf',
      ownerType: 'problem',
      ownerId: id,
      isPublic: true
    })

    const fileUrl = `/api/files/${result.id}/public`

    let statement: any
    if (existingPdf) {
      // 更新现有 PDF
      statement = await prisma.problemStatement.update({
        where: { id: existingPdf.id },
        data: { fileUrl }
      })
    } else {
      // 创建新的 PDF 记录
      statement = await prisma.problemStatement.create({
        data: {
          problemId: id,
          type,
          format: 'pdf',
          language: null,
          fileUrl,
          isVisible: true
        }
      })
    }

    // 同时更新旧字段以保持兼容
    if (type === 'statement') {
      await prisma.problem.update({
        where: { id },
        data: { statementPdfUrl: fileUrl, statementType: 'pdf' }
      })
    } else {
      await prisma.problem.update({
        where: { id },
        data: { solutionPdfUrl: fileUrl, solutionType: 'pdf' }
      })
    }

    logger.audit('statement_pdf_uploaded', {
      userId: user.userId,
      action: 'upload_statement_pdf',
      target: id,
      metadata: { type, fileId: result.id, originalName: result.originalName }
    })

    res.json({ success: true, data: { id: statement.id, fileUrl, fileId: result.id } })
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    logger.error('upload_statement_pdf_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 更新题面/题解可见性 ====================
problemsRouter.put('/:id/statements/:statementId/visibility', authenticate, async (req, res) => {
  try {
    const { id, statementId } = req.params
    const user = (req as any).user
    const { isVisible } = req.body

    const existingProblem = await prisma.problem.findUnique({ where: { id } })

    if (!existingProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    if (!canModifyProblem(user, existingProblem)) {
      return res.status(403).json({ success: false, message: '没有权限' })
    }

    const statement = await prisma.problemStatement.findFirst({
      where: { id: statementId, problemId: id }
    })

    if (!statement) {
      return res.status(404).json({ success: false, message: '记录不存在' })
    }

    const updated = await prisma.problemStatement.update({
      where: { id: statementId },
      data: { isVisible }
    })

    logger.audit('statement_visibility_updated', {
      userId: user.userId,
      action: 'update_statement_visibility',
      target: id,
      metadata: { statementId, isVisible }
    })

    res.json({ success: true, data: updated })
  } catch (error) {
    logger.error('update_statement_visibility_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 删除题面/题解版本 ====================
problemsRouter.delete('/:id/statements/:statementId', authenticate, async (req, res) => {
  try {
    const { id, statementId } = req.params
    const user = (req as any).user

    const existingProblem = await prisma.problem.findUnique({ where: { id } })

    if (!existingProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    if (!canModifyProblem(user, existingProblem)) {
      return res.status(403).json({ success: false, message: '没有权限' })
    }

    const statement = await prisma.problemStatement.findFirst({
      where: { id: statementId, problemId: id }
    })

    if (!statement) {
      return res.status(404).json({ success: false, message: '记录不存在' })
    }

    await prisma.problemStatement.delete({
      where: { id: statementId }
    })

    logger.audit('statement_deleted', {
      userId: user.userId,
      action: 'delete_statement',
      target: id,
      metadata: { statementId, type: statement.type, format: statement.format }
    })

    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    logger.error('delete_statement_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ========== AI 翻译/格式化接口 ==========

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''

/**
 * POST /:id/ai/translate — 翻译题面
 */
problemsRouter.post('/:id/ai/translate', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { targetLang = 'en', statementId } = req.body
    const user = (req as any).user

    if (!DEEPSEEK_API_KEY) {
      res.status(400).json({ success: false, message: '未配置 DEEPSEEK_API_KEY' })
      return
    }

    // 检查限流：每题每种目标语言全局只能翻译一次，管理员无限制
    const isAdmin = ['super_admin', 'platform_admin'].includes(user.role)
    if (!isAdmin) {
      const existingTranslation = await prisma.problemStatement.findFirst({
        where: { problemId: id, type: 'statement', format: 'markdown', language: targetLang },
      })
      if (existingTranslation) {
        res.status(400).json({ success: false, message: `已存在${targetLang === 'zh' ? '中文' : '英文'}翻译版本，不能重复翻译` })
        return
      }
    }

    // 获取题面内容（同时记录原始题面的可见性）
    let content = ''
    let sourceLang = 'zh'
    let sourceIsVisible = true

    if (statementId) {
      const statement = await prisma.problemStatement.findFirst({
        where: { id: statementId, problemId: id },
      })
      if (!statement) {
        res.status(404).json({ success: false, message: '题面记录不存在' })
        return
      }
      content = statement.content || ''
      sourceLang = statement.language || 'zh'
      sourceIsVisible = statement.isVisible
    } else {
      const problem = await prisma.problem.findUnique({ where: { id } })
      if (!problem) {
        res.status(404).json({ success: false, message: '题目不存在' })
        return
      }
      // 找到第一个 markdown 题面
      const statement = await prisma.problemStatement.findFirst({
        where: { problemId: id, type: 'statement', format: 'markdown' },
      })
      if (!statement || !statement.content) {
        res.status(400).json({ success: false, message: '没有可翻译的 Markdown 题面' })
        return
      }
      content = statement.content
      sourceLang = statement.language || 'zh'
      sourceIsVisible = statement.isVisible
    }

    if (!content || content.trim().length === 0) {
      res.status(400).json({ success: false, message: '题面内容为空' })
      return
    }

    // 调用翻译模块
    const { translateDocument } = await import('../../lib/ai-translate')
    const result = await translateDocument({
      text: content,
      sourceLang: sourceLang as any,
      targetLang: targetLang as any,
      temperature: 0.1,
    })

    // 创建新的题面记录（继承原始题面的可见性）
    const newStatement = await prisma.problemStatement.create({
      data: {
        problemId: id,
        type: 'statement',
        format: 'markdown',
        language: targetLang,
        content: result.translated,
        isVisible: sourceIsVisible,
      },
    })

    // 记录使用日志
    await prisma.aiUsageLog.create({
      data: {
        userId: user.userId,
        problemId: id,
        action: 'translate',
        sourceLang,
        targetLang,
        model: result.metadata.model,
        tokensUsed: result.metadata.chunksProcessed || 0,
        status: 'success',
      },
    })

    res.json({
      success: true,
      data: {
        statementId: newStatement.id,
        content: result.translated,
        sourceLang,
        targetLang,
        diagnostics: result.diagnostics,
      },
    })
  } catch (error) {
    logger.error('ai_translate_error', error)
    res.status(500).json({ success: false, message: '翻译失败: ' + (error as Error).message })
  }
})

/**
 * POST /:id/ai/format — 格式化题面
 */
problemsRouter.post('/:id/ai/format', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { statementId } = req.body
    const user = (req as any).user

    if (!DEEPSEEK_API_KEY) {
      res.status(400).json({ success: false, message: '未配置 DEEPSEEK_API_KEY' })
      return
    }

    // 检查限流：每题每条题面全局只能格式化一次，管理员无限制
    const isAdmin = ['super_admin', 'platform_admin'].includes(user.role)
    if (!isAdmin) {
      // 格式化使用 AiUsageLog 记录，检查该题面是否已被格式化过
      const formattedLog = await prisma.aiUsageLog.findFirst({
        where: {
          problemId: id,
          action: 'format',
          status: 'success',
          statementId: statementId || undefined,
        },
      })
      if (formattedLog) {
        res.status(400).json({ success: false, message: '该题面已格式化过，不能重复格式化' })
        return
      }
    }

    // 获取题面内容
    let content = ''

    if (statementId) {
      const statement = await prisma.problemStatement.findFirst({
        where: { id: statementId, problemId: id, format: 'markdown' },
      })
      if (!statement) {
        res.status(404).json({ success: false, message: '题面记录不存在' })
        return
      }
      content = statement.content || ''
    } else {
      const statement = await prisma.problemStatement.findFirst({
        where: { problemId: id, type: 'statement', format: 'markdown' },
      })
      if (!statement || !statement.content) {
        res.status(400).json({ success: false, message: '没有可格式化的 Markdown 题面' })
        return
      }
      content = statement.content
    }

    if (!content || content.trim().length === 0) {
      res.status(400).json({ success: false, message: '题面内容为空' })
      return
    }

    // 调用格式化
    const { formatDocument } = await import('../../lib/ai-translate')
    const result = await formatDocument(content)

    // 更新题面内容
    if (statementId) {
      await prisma.problemStatement.update({
        where: { id: statementId },
        data: { content: result.translated },
      })
    } else {
      const statement = await prisma.problemStatement.findFirst({
        where: { problemId: id, type: 'statement', format: 'markdown' },
      })
      if (statement) {
        await prisma.problemStatement.update({
          where: { id: statement.id },
          data: { content: result.translated },
        })
      }
    }

    // 记录使用日志
    await prisma.aiUsageLog.create({
      data: {
        userId: user.userId,
        problemId: id,
        action: 'format',
        model: result.metadata.model,
        status: 'success',
        statementId: statementId || undefined,
      },
    })

    res.json({
      success: true,
      data: {
        content: result.translated,
        diagnostics: result.diagnostics,
      },
    })
  } catch (error) {
    logger.error('ai_format_error', error)
    res.status(500).json({ success: false, message: '格式化失败: ' + (error as Error).message })
  }
})

/**
 * GET /:id/ai/usage — 获取当前用户对此题目的 AI 使用情况
 */
problemsRouter.get('/:id/ai/usage', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const user = (req as any).user
    const isAdmin = ['super_admin', 'platform_admin'].includes(user.role)

    // 翻译：检查是否已有其他语言的 statement
    const statements = await prisma.problemStatement.findMany({
      where: { problemId: id, type: 'statement', format: 'markdown' },
      select: { language: true },
    })
    const hasZh = statements.some(s => s.language === 'zh')
    const hasEn = statements.some(s => s.language === 'en')

    // 格式化：检查全局是否有成功的格式化记录
    const formatLogs = await prisma.aiUsageLog.findMany({
      where: { problemId: id, action: 'format', status: 'success' },
      select: { statementId: true },
    })
    const formattedStatementIds = new Set(formatLogs.map(l => l.statementId).filter(Boolean) as string[])

    res.json({
      success: true,
      data: {
        isAdmin,
        translations: { zh: hasZh, en: hasEn },
        formattedStatementIds: Array.from(formattedStatementIds),
      },
    })
  } catch (error) {
    logger.error('ai_usage_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

/**
 * GET /api/problems/:id/submissions
 * 获取题目的提交记录
 */
problemsRouter.get('/:id/submissions', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const { page = '1', pageSize = '20' } = req.query as Record<string, string>

    // 查找题目
    const problem = await prisma.problem.findUnique({
      where: { id },
      select: { platform: true, problemId: true },
    })

    if (!problem) {
      return res.status(404).json({
        success: false,
        message: '题目不存在',
      })
    }

    const pageNum = parseInt(page) || 1
    const pageSizeNum = Math.min(parseInt(pageSize) || 20, 100)
    const skip = (pageNum - 1) * pageSizeNum

    // 查询该题目的提交记录（只返回当前用户的）
    const where = {
      oj: problem.platform,
      problemId: problem.problemId,
      userId: (req as any).user?.userId,
    }

    // 调试日志
    logger.info('problem_submissions_query', {
      action: 'problems',
      metadata: {
        problemInternalId: id,
        platform: problem.platform,
        problemId: problem.problemId,
        currentUser: (req as any).user?.username,
        where
      }
    })

    const total = await prisma.submission.count({ where })

    const submissions = await prisma.submission.findMany({
      where,
      include: {
        User: {
          select: { username: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSizeNum,
    })

    const formattedSubmissions = submissions.map(s => ({
      id: s.id,
      username: s.User.username,
      oj: s.oj,
      problemId: s.problemId,
      result: s.result,
      timeUsed: s.timeUsed,
      memoryUsed: s.memoryUsed,
      codeLength: s.codeLength,
      language: s.language,
      submittedAt: s.createdAt.toISOString(),
    }))

    // 调试日志：返回结果
    logger.info('problem_submissions_result', {
      action: 'problems',
      metadata: {
        total,
        returnedCount: formattedSubmissions.length,
        usernames: formattedSubmissions.map(s => s.username)
      }
    })

    res.json({
      success: true,
      data: {
        submissions: formattedSubmissions,
        page: pageNum,
        totalPages: Math.ceil(total / pageSizeNum),
        total,
      },
    })
  } catch (e: any) {
    logger.error('problem_submissions_error', {
      action: 'problems',
      metadata: { error: e.message },
    })
    res.status(500).json({
      success: false,
      message: '查询失败',
    })
  }
})

// ==================== 评测配置 ====================

/**
 * GET /api/problems/:id/judge-config
 * 获取题目的评测配置
 */
problemsRouter.get('/:id/judge-config', authenticate, async (req, res) => {
  try {
    const { id } = req.params

    const problem = await prisma.problem.findUnique({
      where: { id },
      select: {
        id: true,
        platform: true,
        problemType: true,
        judgeConfig: true,
        timeLimit: true,
        memoryLimit: true
      }
    })

    if (!problem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    // 解析 YAML 配置
    let config = null
    if (problem.judgeConfig) {
      try {
        const yaml = await import('js-yaml')
        config = yaml.load(problem.judgeConfig)
        console.log('[JudgeConfig] Loaded config, subtasks count:', (config as any)?.subtasks?.length ?? 0)
      } catch (e) {
        logger.warn('parse_judge_config_error', { error: e })
      }
    }

    res.json({
      success: true,
      data: {
        problemType: problem.problemType,
        timeLimit: problem.timeLimit,
        memoryLimit: problem.memoryLimit,
        config
      }
    })
  } catch (error) {
    logger.error('get_judge_config_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

/**
 * PUT /api/problems/:id/judge-config
 * 保存题目的评测配置
 */
problemsRouter.put('/:id/judge-config', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user
    const { problemType, timeLimit, memoryLimit, config } = req.body

    const existingProblem = await prisma.problem.findUnique({ where: { id } })

    if (!existingProblem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    if (!canModifyProblem(user, existingProblem)) {
      return res.status(403).json({ success: false, message: '没有权限编辑此题目' })
    }

    // 将配置序列化为 YAML
    let judgeConfigYaml = null
    if (config) {
      const yaml = await import('js-yaml')
      judgeConfigYaml = yaml.dump(config, { lineWidth: -1 })
      console.log('[JudgeConfig] Saving config, subtasks count:', config.subtasks?.length ?? 0, 'YAML preview:', judgeConfigYaml.substring(0, 200))
    }

    const updateData: any = {}
    if (problemType) updateData.problemType = problemType
    if (timeLimit !== undefined) updateData.timeLimit = timeLimit
    if (memoryLimit !== undefined) updateData.memoryLimit = memoryLimit
    updateData.judgeConfig = judgeConfigYaml

    const problem = await prisma.problem.update({
      where: { id },
      data: updateData
    })

    logger.audit('judge_config_updated', {
      userId: user.userId,
      action: 'update_judge_config',
      target: id,
      metadata: { problemType, timeLimit, memoryLimit }
    })

    res.json({ success: true, data: problem })
  } catch (error) {
    logger.error('update_judge_config_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
