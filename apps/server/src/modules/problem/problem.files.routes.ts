/**
 * Problem Files Routes
 * 题目文件管理路由：PDF 上传、附件、题面/题解版本管理
 */

import { Router } from 'express'
import type { Response } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import {
  deleteProblemAttachment,
  deleteProblemStatement,
  listProblemAttachments,
  ProblemFileApplicationError,
  updateProblemStatementVisibility,
  uploadLegacyProblemPdf,
  uploadProblemAttachment,
  uploadProblemStatementPdf,
} from './application/problem-file.service'
import { problemAttachmentUpload, problemPdfUpload } from './application/problem-file-upload'

export const problemFilesRouter = Router()

function problemFileEndpoint(handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (error instanceof ProblemFileApplicationError) {
        return res.status(error.statusCode).json({ success: false, message: error.message })
      }
      throw error
    }
  })
}

// ==================== 上传题面 PDF ====================
problemFilesRouter.post('/:id/statement-pdf', authenticate, problemPdfUpload.single('file'), problemFileEndpoint(async (req, res) => {
  res.json({ success: true, data: await uploadLegacyProblemPdf(req.user!, req.params.id, req.file, 'statement') })
}))

// ==================== 上传题解 PDF ====================
problemFilesRouter.post('/:id/solution-pdf', authenticate, problemPdfUpload.single('file'), problemFileEndpoint(async (req, res) => {
  res.json({ success: true, data: await uploadLegacyProblemPdf(req.user!, req.params.id, req.file, 'solution') })
}))

// ==================== 获取题目附件列表 ====================
problemFilesRouter.get('/:id/attachments', authenticate, problemFileEndpoint(async (req, res) => {
  res.json({ success: true, data: await listProblemAttachments(req.user!, req.params.id) })
}))

// ==================== 上传附件 ====================
problemFilesRouter.post('/:id/attachments', authenticate, problemAttachmentUpload.single('file'), problemFileEndpoint(async (req, res) => {
  res.json({
    success: true,
    data: await uploadProblemAttachment(req.user!, req.params.id, req.file, req.body.description),
  })
}))

// ==================== 删除附件 ====================
problemFilesRouter.delete('/:id/attachments/:attachmentId', authenticate, problemFileEndpoint(async (req, res) => {
  await deleteProblemAttachment(req.user!, req.params.id, req.params.attachmentId)
  res.json({ success: true, message: '删除成功' })
}))

// ==================== 上传题面/题解 PDF（新统一接口） ====================
problemFilesRouter.post('/:id/statements/pdf', authenticate, problemPdfUpload.single('file'), problemFileEndpoint(async (req, res) => {
  res.json({
    success: true,
    data: await uploadProblemStatementPdf(req.user!, req.params.id, req.file, req.body.type ?? 'statement'),
  })
}))

// ==================== 更新题面/题解可见性 ====================
problemFilesRouter.put('/:id/statements/:statementId/visibility', authenticate, problemFileEndpoint(async (req, res) => {
  res.json({
    success: true,
    data: await updateProblemStatementVisibility(
      req.user!, req.params.id, req.params.statementId, req.body.isVisible,
    ),
  })
}))

// ==================== 删除题面/题解版本 ====================
problemFilesRouter.delete('/:id/statements/:statementId', authenticate, problemFileEndpoint(async (req, res) => {
  await deleteProblemStatement(req.user!, req.params.id, req.params.statementId)
  res.json({ success: true, message: '删除成功' })
}))
