/**
 * 文件管理 API 路由
 * 提供文件上传、下载、删除等功能
 */

import { Router, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { authenticate } from '../middleware/auth'
import { prisma } from '../prisma'
import { fileService } from '../lib/storage'
import { STORAGE_ROOT, SIZE_LIMITS } from '../config/storage'
import type { OwnerType, FileCategory } from '../config/storage'
import logger from '../lib/logger'
import type { JwtPayload } from '@oi-manager/shared'
import { canModifyProblem, canViewProblem } from '../modules/problem/problem.access'

export const filesRouter = Router()

const ALLOWED_UPLOAD_CATEGORIES = new Set(['pdf', 'attachment', 'avatar', 'image', 'testdata'])
const ALLOWED_OWNER_TYPES = new Set(['problem', 'contest', 'user', 'team'])

// ==================== Multer 配置 ====================

// 临时上传目录
const tempUploadDir = path.join(STORAGE_ROOT, 'temp/uploads')
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true })
}

const tempStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempUploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
})

const upload = multer({
  storage: tempStorage,
  limits: { fileSize: 50 * 1024 * 1024 } // 默认最大 50MB
})

// ==================== 上传接口 ====================

/**
 * POST /api/files/upload
 * 通用文件上传接口
 *
 * 请求体：
 * - file: 文件
 * - category: 文件类别 (pdf | attachment | avatar | image | testdata)
 * - ownerType: 业务归属类型 (problem | contest | user | team)
 * - ownerId: 业务对象 ID
 * - isPublic: 是否公开 (可选，默认 false)
 */
filesRouter.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传文件' })
    }

    const { category, ownerType, ownerId, isPublic } = req.body
    const user = (req as any).user as JwtPayload

    // 验证必填参数
    if (!category || !ownerType || !ownerId) {
      fs.unlinkSync(req.file.path) // 清理临时文件
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: category, ownerType, ownerId'
      })
    }

    // Runtime validation is required here: these values arrive from multipart
    // form data and TypeScript casts do not protect the database. In
    // particular, an admin must not be able to create arbitrary owner types
    // that bypass the storage access switch.
    if (!ALLOWED_UPLOAD_CATEGORIES.has(String(category)) || !ALLOWED_OWNER_TYPES.has(String(ownerType))) {
      fs.unlinkSync(req.file.path)
      return res.status(400).json({ success: false, message: '文件类别或业务归属类型无效' })
    }

    // 验证上传权限：用户必须有权限操作指定的 ownerType/ownerId
    const hasUploadPermission = await checkUploadPermission(user, ownerType as OwnerType, ownerId)
    if (!hasUploadPermission) {
      fs.unlinkSync(req.file.path) // 清理临时文件
      return res.status(403).json({
        success: false,
        message: '无权上传文件到该业务对象'
      })
    }

    // 上传文件
    const result = await fileService.uploadFromMulter(req.file, {
      category: category as FileCategory,
      ownerType: ownerType as OwnerType,
      ownerId,
      isPublic: ownerType === 'problem' ? false : isPublic === 'true' || isPublic === true
    })

    logger.audit('file_uploaded', {
      userId: (req as any).user.userId,
      action: 'upload_file',
      target: result.id,
      metadata: {
        category,
        ownerType,
        ownerId,
        fileName: result.originalName,
        fileSize: result.fileSize
      }
    })

    res.json({ success: true, data: result })
  } catch (error) {
    // 清理临时文件
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }

    const message = error instanceof Error ? error.message : '服务器错误'
    const isValidationError = /^(File extension not allowed|File type not allowed|File size exceeds limit|File content does not match extension|File MIME does not match extension):/.test(message)
    if (isValidationError) {
      logger.warn('file_upload_rejected', { action: 'file_upload', metadata: { message } })
    } else {
      logger.error('file_upload_error', error)
    }
    res.status(isValidationError ? 400 : 500).json({ success: false, message })
  }
})

// ==================== 下载接口 ====================

/**
 * GET /api/files/:id/download
 * 下载文件（私有文件需要权限验证）
 */
filesRouter.get('/:id/download', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user as JwtPayload

    // 检查访问权限
    const hasAccess = await fileService.checkAccess(user, id)
    if (!hasAccess) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    // 下载文件
    const { buffer, originalName, mimeType } = await fileService.download(id)

    // 设置响应头
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`)
    res.setHeader('Content-Length', buffer.length)

    res.send(buffer)

    logger.audit('file_downloaded', {
      userId: user.userId,
      action: 'download_file',
      target: id
    })
  } catch (error) {
    logger.error('file_download_error', error)
    if (error instanceof Error && error.message === 'File not found') {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }
    if (error instanceof Error && error.message === 'File is not available') {
      return res.status(410).json({ success: false, message: '文件已不可用' })
    }
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 公开访问接口 ====================

/**
 * GET /api/files/:id/public
 * 公开文件访问（无需认证）
 */
filesRouter.get('/:id/public', async (req, res) => {
  try {
    const { id } = req.params

    // 获取文件信息
    const file = await fileService.getFile(id)

    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    if (!file.isPublic) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    if (file.status !== 'active') {
      return res.status(410).json({ success: false, message: '文件已不可用' })
    }

    // 下载文件
    const { buffer, mimeType } = await fileService.download(id)

    // 设置响应头
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Length', buffer.length)
    // 对于公开文件，允许缓存
    res.setHeader('Cache-Control', 'public, max-age=31536000')

    res.send(buffer)
  } catch (error) {
    logger.error('public_file_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 文件信息接口 ====================

/**
 * GET /api/files/:id
 * 获取文件信息
 */
filesRouter.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user as JwtPayload

    const file = await fileService.getFile(id)

    if (!file || !await fileService.checkAccess(user, id)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    // 返回文件信息
    res.json({
      success: true,
      data: {
        id: file.id,
        originalName: file.originalName,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        category: file.category,
        isPublic: file.isPublic,
        createdAt: file.createdAt,
        url: fileService.getFileUrl(file)
      }
    })
  } catch (error) {
    logger.error('get_file_info_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 删除接口 ====================

/**
 * DELETE /api/files/:id
 * 删除文件（软删除，移动到回收站）
 */
filesRouter.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const user = (req as any).user as JwtPayload

    // 获取文件信息
    const file = await fileService.getFile(id)

    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    // 检查删除权限
    const hasDeletePermission = await checkDeletePermission(user, file)
    if (!hasDeletePermission) {
      return res.status(403).json({ success: false, message: '无权删除该文件' })
    }

    // 软删除
    await fileService.softDelete(id)

    logger.audit('file_deleted', {
      userId: user.userId,
      action: 'delete_file',
      target: id,
      metadata: {
        originalName: file.originalName,
        category: file.category
      }
    })

    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    logger.error('file_delete_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 业务相关接口 ====================

/**
 * GET /api/files/by-owner
 * 根据业务对象获取文件列表
 */
filesRouter.get('/by-owner/:ownerType/:ownerId', authenticate, async (req, res) => {
  try {
    const { ownerType, ownerId } = req.params
    const { category } = req.query
    const user = (req as any).user as JwtPayload

    if (!ALLOWED_OWNER_TYPES.has(ownerType)
      || (category !== undefined && !ALLOWED_UPLOAD_CATEGORIES.has(String(category)))) {
      return res.status(400).json({ success: false, message: '文件类别或业务归属类型无效' })
    }

    // 检查查看权限
    const hasViewPermission = await checkViewPermission(user, ownerType as OwnerType, ownerId)
    if (!hasViewPermission) {
      return res.status(403).json({ success: false, message: '无权查看该业务对象的文件' })
    }

    const files = await fileService.getFilesByOwner(
      ownerType as OwnerType,
      ownerId,
      category as FileCategory | undefined
    )

    // 添加访问 URL
    const filesWithUrl = files.map(file => ({
      ...file,
      url: fileService.getFileUrl(file)
    }))

    res.json({ success: true, data: filesWithUrl })
  } catch (error) {
    logger.error('get_files_by_owner_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// ==================== 权限检查辅助函数 ====================

/**
 * 检查上传权限
 * 用户必须有权限操作指定的 ownerType/ownerId
 */
async function checkUploadPermission(
  user: JwtPayload,
  ownerType: OwnerType,
  ownerId: string
): Promise<boolean> {
  switch (ownerType) {
    case 'problem': {
      // 检查是否是题目所有者
      const problem = await prisma.problem.findUnique({ where: { id: ownerId } })
      return !!problem && canModifyProblem(user, problem)
    }
    case 'contest': {
      // 检查是否是团队管理员
      const contest = await prisma.contest.findUnique({
        where: { id: ownerId },
        select: { teamId: true }
      })
      if (!contest || !contest.teamId) return false
      // 检查团队管理员权限
      return checkTeamPermission(user, contest.teamId, true)
    }
    case 'team': {
      // 检查是否是团队管理员
      return checkTeamPermission(user, ownerId, true)
    }
    case 'user': {
      // 用户只能上传到自己的资源
      return ownerId === user.userId
    }
    default:
      return false
  }
}

/**
 * 检查删除权限
 * 管理员、文件上传者、业务对象所有者可以删除
 */
async function checkDeletePermission(
  user: JwtPayload,
  file: { id: string; ownerType: string; ownerId: string; category: string }
): Promise<boolean> {
  switch (file.ownerType) {
    case 'problem': {
      // 检查是否是题目所有者
      const problem = await prisma.problem.findUnique({ where: { id: file.ownerId } })
      return !!problem && canModifyProblem(user, problem)
    }
    case 'contest': {
      // 检查是否是团队管理员
      const contest = await prisma.contest.findUnique({
        where: { id: file.ownerId },
        select: { teamId: true }
      })
      if (!contest || !contest.teamId) return false
      return checkTeamPermission(user, contest.teamId, true)
    }
    case 'team': {
      // 检查是否是团队管理员
      return checkTeamPermission(user, file.ownerId, true)
    }
    case 'user': {
      // 用户只能删除自己的文件
      return file.ownerId === user.userId
    }
    default:
      return false
  }
}

/**
 * 检查查看权限
 * 用户必须有权限查看指定 ownerType/ownerId 的文件
 */
async function checkViewPermission(
  user: JwtPayload,
  ownerType: OwnerType,
  ownerId: string
): Promise<boolean> {
  switch (ownerType) {
    case 'problem': {
      // 公开题目所有人可见，私有题目只有所有者可见
      const problem = await prisma.problem.findUnique({ where: { id: ownerId } })
      return !!problem && canViewProblem(user, problem)
    }
    case 'contest': {
      // 检查是否是团队成员
      const contest = await prisma.contest.findUnique({
        where: { id: ownerId },
        select: { teamId: true }
      })
      if (!contest || !contest.teamId) return false
      // 检查是否是团队成员
      return checkTeamPermission(user, contest.teamId, false)
    }
    case 'team': {
      // 检查是否是团队成员
      return checkTeamPermission(user, ownerId, false)
    }
    case 'user': {
      // 用户只能查看自己的文件
      return ownerId === user.userId
    }
    default:
      return false
  }
}

async function checkTeamPermission(user: JwtPayload, teamId: string, requireManager: boolean): Promise<boolean> {
  const expectedScope = user.organizationId ? 'campus' : 'personal'
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { scope: true, organizationId: true },
  })
  if (!team || team.scope !== expectedScope) return false
  if (expectedScope === 'campus' && team.organizationId !== user.organizationId) return false
  if (expectedScope === 'personal' && team.organizationId) return false

  const member = await prisma.teamMember.findFirst({
    where: {
      teamId,
      userId: user.userId,
      status: 'active',
      ...(requireManager ? { role: { in: ['owner', 'admin'] } } : {}),
    },
  })
  return !!member
}
