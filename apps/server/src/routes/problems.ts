import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { prisma } from '../prisma'
import { authenticate, authorize } from '../middleware/auth'
import logger from '../lib/logger'

export const problemsRouter = Router()

// 配置题目文件上传
const problemStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/problems')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
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

/**
 * 生成全局唯一题号
 */
async function generateProblemCode(): Promise<string> {
  const latestProblem = await prisma.problem.findFirst({
    orderBy: { problemCode: 'desc' },
    select: { problemCode: true }
  })

  let nextNum = 1
  if (latestProblem?.problemCode) {
    const numPart = parseInt(latestProblem.problemCode.slice(1), 10)
    if (!isNaN(numPart)) {
      nextNum = numPart + 1
    }
  }

  return `P${String(nextNum).padStart(6, '0')}`
}

/**
 * 获取当前用户的 ownerId 和 ownerType
 */
async function getOwnerInfo(userId: string, role: string): Promise<{ ownerId: string; ownerType: string } | null> {
  if (role === 'student') {
    const student = await prisma.student.findUnique({
      where: { userId },
      select: { id: true }
    })
    if (student) return { ownerId: student.id, ownerType: 'student' }
  } else if (role === 'teacher' || role === 'school_principal') {
    const teacher = await prisma.teacher.findUnique({
      where: { userId },
      select: { id: true }
    })
    if (teacher) return { ownerId: teacher.id, ownerType: 'teacher' }
  } else if (role === 'super_admin' || role === 'platform_admin') {
    const admin = await prisma.admin.findUnique({
      where: { userId },
      select: { id: true }
    })
    if (admin) return { ownerId: admin.id, ownerType: 'admin' }
  }
  return null
}

/**
 * 检查是否有权限编辑/删除题目
 */
function canModifyProblem(user: any, problem: any): boolean {
  // 管理员可以修改所有题目
  if (user.role === 'super_admin' || user.role === 'platform_admin') {
    return true
  }

  // 获取当前用户的 ownerId 和 ownerType
  let ownerId: string | undefined
  let ownerType: string | undefined

  if (user.teacherId) {
    ownerId = user.teacherId
    ownerType = 'teacher'
  } else if (user.studentId) {
    ownerId = user.studentId
    ownerType = 'student'
  } else if (user.adminId) {
    ownerId = user.adminId
    ownerType = 'admin'
  }

  // 所有者可以修改自己的题目
  return problem.ownerId === ownerId && problem.ownerType === ownerType
}

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
        { problemCode: { contains: keyword } },
        { title: { contains: keyword } }
      ]
    }

    let problems = await prisma.problem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(pageSize),
      take: Number(pageSize)
    })

    // 平台筛选（应用层过滤，因为 ojBindings 是 JSON 字符串）
    if (platform && typeof platform === 'string') {
      problems = problems.filter(p => {
        if (!p.ojBindings) return false
        try {
          const bindings = JSON.parse(p.ojBindings)
          return Array.isArray(bindings) && bindings.some((b: any) => b.platform === platform)
        } catch {
          return false
        }
      })
    }

    // 获取总数（如果有平台筛选，需要重新计算）
    let total = await prisma.problem.count({ where })
    if (platform) {
      // 平台筛选后，需要重新计算 total
      const allProblems = await prisma.problem.findMany({ where })
      total = allProblems.filter(p => {
        if (!p.ojBindings) return false
        try {
          const bindings = JSON.parse(p.ojBindings)
          return Array.isArray(bindings) && bindings.some((b: any) => b.platform === platform)
        } catch {
          return false
        }
      }).length
    }

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

    const problemsWithOwner = problems.map(p => ({
      ...p,
      ownerName: ownerMap.get(p.ownerId) || '未知'
    }))

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
      ojBindings
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

    // 确定题号：公共题目使用原平台题号，私有题目使用系统生成题号
    let problemCode: string
    if (problemVisibility === 'public' && ojBindings && Array.isArray(ojBindings) && ojBindings.length > 0) {
      // 公共题目使用第一个 OJ 绑定的题号
      problemCode = ojBindings[0].problemId
    } else {
      problemCode = await generateProblemCode()
    }

    const createData: any = {
      problemCode,
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

    if (description) createData.description = description
    if (solutionMarkdown) createData.solutionMarkdown = solutionMarkdown
    if (ojBindings) createData.ojBindings = JSON.stringify(ojBindings)

    const problem = await prisma.problem.create({ data: createData })

    logger.audit('problem_created', {
      userId,
      action: 'create_problem',
      target: problemCode,
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
    const role = (req as any).user.role

    const problem = await prisma.problem.findUnique({ where: { id } })

    if (!problem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
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

    res.json({ success: true, data: { ...problem, ownerName } })
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
      ojBindings
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
    }

    // 只有管理员可以修改可见性
    if ((user.role === 'super_admin' || user.role === 'platform_admin') && visibility) {
      updateData.visibility = visibility
    }

    const problem = await prisma.problem.update({
      where: { id },
      data: updateData
    })

    logger.audit('problem_updated', {
      userId: user.userId,
      action: 'update_problem',
      target: existingProblem.problemCode,
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

    // 删除关联的 PDF 文件
    if (existingProblem.statementPdfUrl) {
      const filePath = path.join(__dirname, '../../', existingProblem.statementPdfUrl)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
    if (existingProblem.solutionPdfUrl) {
      const filePath = path.join(__dirname, '../../', existingProblem.solutionPdfUrl)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }

    await prisma.problem.delete({ where: { id } })

    logger.audit('problem_deleted', {
      userId: user.userId,
      action: 'delete_problem',
      target: existingProblem.problemCode,
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

    if (existingProblem.statementPdfUrl) {
      const oldFilePath = path.join(__dirname, '../../', existingProblem.statementPdfUrl)
      if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath)
    }

    const pdfUrl = `/uploads/problems/${req.file.filename}`
    await prisma.problem.update({
      where: { id },
      data: { statementPdfUrl: pdfUrl, statementType: 'pdf' }
    })

    res.json({ success: true, data: { pdfUrl } })
  } catch (error) {
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

    if (existingProblem.solutionPdfUrl) {
      const oldFilePath = path.join(__dirname, '../../', existingProblem.solutionPdfUrl)
      if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath)
    }

    const pdfUrl = `/uploads/problems/${req.file.filename}`
    await prisma.problem.update({
      where: { id },
      data: { solutionPdfUrl: pdfUrl, solutionType: 'pdf' }
    })

    res.json({ success: true, data: { pdfUrl } })
  } catch (error) {
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

    const fileUrl = `/uploads/problems/${req.file.filename}`
    const attachment = await prisma.problemAttachment.create({
      data: {
        problemId: id,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        fileUrl,
        description: description || null
      }
    })

    res.json({ success: true, data: attachment })
  } catch (error) {
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

    // 删除文件
    const filePath = path.join(__dirname, '../../', attachment.fileUrl)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    await prisma.problemAttachment.delete({ where: { id: attachmentId } })

    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    logger.error('delete_attachment_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})