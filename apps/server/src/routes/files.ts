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

export const filesRouter = Router()

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

    // 验证必填参数
    if (!category || !ownerType || !ownerId) {
      fs.unlinkSync(req.file.path) // 清理临时文件
      return res.status(400).json({
        success: false,
        message: '缺少必要参数: category, ownerType, ownerId'
      })
    }

    // 上传文件
    const result = await fileService.uploadFromMulter(req.file, {
      category: category as FileCategory,
      ownerType: ownerType as OwnerType,
      ownerId,
      isPublic: isPublic === 'true' || isPublic === true
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

    logger.error('file_upload_error', error)
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : '服务器错误' })
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
    const userId = (req as any).user.userId
    const userRole = (req as any).user.role

    // 检查访问权限
    const hasAccess = await fileService.checkAccess(userId, userRole, id)
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: '无权访问该文件' })
    }

    // 下载文件
    const { buffer, originalName, mimeType } = await fileService.download(id)

    // 设置响应头
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`)
    res.setHeader('Content-Length', buffer.length)

    res.send(buffer)

    logger.audit('file_downloaded', {
      userId,
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
      return res.status(403).json({ success: false, message: '该文件不公开' })
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

    const file = await fileService.getFile(id)

    if (!file) {
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
    const userId = (req as any).user.userId
    const userRole = (req as any).user.role

    // 获取文件信息
    const file = await fileService.getFile(id)

    if (!file) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    // 检查删除权限（管理员或文件所有者）
    // 这里简化处理，实际需要根据业务逻辑检查
    if (userRole !== 'super_admin' && userRole !== 'platform_admin') {
      // 检查是否是文件所有者
      // TODO: 根据业务逻辑实现更精确的权限检查
    }

    // 软删除
    await fileService.softDelete(id)

    logger.audit('file_deleted', {
      userId,
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