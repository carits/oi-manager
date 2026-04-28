/**
 * Problem Files Routes
 * 题目文件管理路由：PDF 上传、附件、题面/题解版本管理
 */

import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { fileService } from '../../lib/storage'
import { STORAGE_ROOT } from '../../config/storage'
import { canModifyProblem } from './problem.helpers'
import logger from '../../lib/logger'

export const problemFilesRouter = Router()

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

// ==================== 上传题面 PDF ====================
problemFilesRouter.post('/:id/statement-pdf', authenticate, problemUpload.single('file'), asyncHandler(async (req, res) => {
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
}))

// ==================== 上传题解 PDF ====================
problemFilesRouter.post('/:id/solution-pdf', authenticate, problemUpload.single('file'), asyncHandler(async (req, res) => {
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
}))

// ==================== 获取题目附件列表 ====================
problemFilesRouter.get('/:id/attachments', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params

    const attachments = await prisma.problemAttachment.findMany({
      where: { problemId: id },
      orderBy: { uploadedAt: 'desc' }
    })

    res.json({ success: true, data: attachments })
}))

// ==================== 上传附件 ====================
problemFilesRouter.post('/:id/attachments', authenticate, attachmentUpload.single('file'), asyncHandler(async (req, res) => {
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
}))

// ==================== 删除附件 ====================
problemFilesRouter.delete('/:id/attachments/:attachmentId', authenticate, asyncHandler(async (req, res) => {
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
}))

// ==================== 上传题面/题解 PDF（新统一接口） ====================
problemFilesRouter.post('/:id/statements/pdf', authenticate, problemUpload.single('file'), asyncHandler(async (req, res) => {
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
}))

// ==================== 更新题面/题解可见性 ====================
problemFilesRouter.put('/:id/statements/:statementId/visibility', authenticate, asyncHandler(async (req, res) => {
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
}))

// ==================== 删除题面/题解版本 ====================
problemFilesRouter.delete('/:id/statements/:statementId', authenticate, asyncHandler(async (req, res) => {
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
}))