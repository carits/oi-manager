/** 通用文件 HTTP API。权限、元数据和存储生命周期由 application/infrastructure service 负责。 */
import { Router } from 'express'
import type { JwtPayload } from '@oi-manager/shared'
import { authenticate } from '../middleware/auth'
import logger from '../lib/logger'
import {
  deleteAuthorizedFile,
  downloadAuthorizedFile,
  downloadPublicFile,
  FileRouteError,
  getAuthorizedFile,
  listOwnerFiles,
  uploadOwnedFile,
} from '../modules/file/application/file-route.service'
import { cleanupGenericTemporaryFile, genericFileUpload } from '../modules/file/infrastructure/file-upload'

export const filesRouter = Router()

function userOf(req: any) { return req.user as JwtPayload }

function sendFileError(res: any, error: unknown, action: string) {
  if (error instanceof FileRouteError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
  }
  const message = error instanceof Error ? error.message : '服务器错误'
  if (message === 'File not found') return res.status(404).json({ success: false, message: '文件不存在' })
  if (message === 'File is not available') return res.status(410).json({ success: false, message: '文件已不可用' })
  const validation = /^(File extension not allowed|File type not allowed|File size exceeds limit|File content does not match extension|File MIME does not match extension):/.test(message)
  logger[validation ? 'warn' : 'error'](action, validation ? { action, metadata: { message } } : error)
  return res.status(validation ? 400 : 500).json({ success: false, message })
}

filesRouter.post('/upload', authenticate, genericFileUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: '请上传文件' })
  try {
    const { result, category, ownerType, ownerId } = await uploadOwnedFile(userOf(req), req.file, req.body)
    logger.audit('file_uploaded', {
      userId: userOf(req).userId,
      action: 'upload_file',
      target: result.id,
      metadata: { category, ownerType, ownerId, fileName: result.originalName, fileSize: result.fileSize },
    })
    return res.json({ success: true, data: result })
  } catch (error) {
    cleanupGenericTemporaryFile(req.file)
    return sendFileError(res, error, 'file_upload_error')
  }
})

filesRouter.get('/by-owner/:ownerType/:ownerId', authenticate, async (req, res) => {
  try {
    const data = await listOwnerFiles(userOf(req), req.params.ownerType, req.params.ownerId, req.query.category)
    return res.json({ success: true, data })
  } catch (error) {
    return sendFileError(res, error, 'get_files_by_owner_error')
  }
})

filesRouter.get('/:id/download', authenticate, async (req, res) => {
  try {
    const file = await downloadAuthorizedFile(userOf(req), req.params.id)
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`)
    res.setHeader('Content-Length', file.buffer.length)
    res.send(file.buffer)
    logger.audit('file_downloaded', { userId: userOf(req).userId, action: 'download_file', target: req.params.id })
  } catch (error) {
    return sendFileError(res, error, 'file_download_error')
  }
})

filesRouter.get('/:id/public', async (req, res) => {
  try {
    const file = await downloadPublicFile(req.params.id)
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Content-Length', file.buffer.length)
    res.setHeader('Cache-Control', 'public, max-age=31536000')
    return res.send(file.buffer)
  } catch (error) {
    return sendFileError(res, error, 'public_file_error')
  }
})

filesRouter.get('/:id', authenticate, async (req, res) => {
  try {
    return res.json({ success: true, data: await getAuthorizedFile(userOf(req), req.params.id) })
  } catch (error) {
    return sendFileError(res, error, 'get_file_info_error')
  }
})

filesRouter.delete('/:id', authenticate, async (req, res) => {
  try {
    const file = await deleteAuthorizedFile(userOf(req), req.params.id)
    logger.audit('file_deleted', {
      userId: userOf(req).userId,
      action: 'delete_file',
      target: req.params.id,
      metadata: { originalName: file.originalName, category: file.category },
    })
    return res.json({ success: true, message: '删除成功' })
  } catch (error) {
    return sendFileError(res, error, 'file_delete_error')
  }
})
