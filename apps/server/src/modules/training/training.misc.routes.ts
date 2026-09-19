/**
 * Training overview, solution, attachment and managed-file HTTP adapter.
 */

import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { parseTrainingId } from './training.helpers'
import {
  downloadTrainingProblemFile,
  getTrainingAttachments,
  getTrainingOverview,
  getTrainingProblemAttachments,
  getTrainingProblemSolution,
  getTrainingSolutions,
  TrainingMiscError,
} from './application/training-misc.service'

export const trainingMiscRouter = Router()

function sendTrainingMiscError(error: unknown, res: any) {
  if (!(error instanceof TrainingMiscError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
  })
}

trainingMiscRouter.get('/trainings/:id/overview', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await getTrainingOverview(parseTrainingId(req.params.id), req.user!.userId)
    return res.json({ success: true, data })
  } catch (error) {
    return sendTrainingMiscError(error, res)
  }
}, '获取训练概览失败'))

trainingMiscRouter.get('/trainings/:id/solutions', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await getTrainingSolutions(parseTrainingId(req.params.id), req.user!.userId)
    return res.json({ success: true, data })
  } catch (error) {
    return sendTrainingMiscError(error, res)
  }
}, '查询题解失败'))

trainingMiscRouter.get('/trainings/:id/attachments', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await getTrainingAttachments(parseTrainingId(req.params.id), req.user!.userId)
    return res.json({ success: true, data })
  } catch (error) {
    return sendTrainingMiscError(error, res)
  }
}, '查询附件失败'))

trainingMiscRouter.get('/trainings/:id/problems/:problemId/solution', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await getTrainingProblemSolution(
      parseTrainingId(req.params.id),
      req.params.problemId,
      req.user!.userId,
    )
    return res.json({ success: true, data: result.data, ...(result.message ? { message: result.message } : {}) })
  } catch (error) {
    return sendTrainingMiscError(error, res)
  }
}, '查询失败'))

trainingMiscRouter.get('/trainings/:id/problems/:problemId/attachments', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await getTrainingProblemAttachments(
      parseTrainingId(req.params.id),
      req.params.problemId,
      req.user!.userId,
    )
    return res.json({ success: true, data })
  } catch (error) {
    return sendTrainingMiscError(error, res)
  }
}, '查询失败'))

trainingMiscRouter.get('/trainings/:id/problems/:problemId/files/:fileId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const file = await downloadTrainingProblemFile({
      trainingId: parseTrainingId(req.params.id),
      trainingProblemId: req.params.problemId,
      fileId: req.params.fileId,
      userId: req.user!.userId,
    })
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Content-Disposition', `${file.disposition}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`)
    res.setHeader('Content-Length', file.buffer.length)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.send(file.buffer)
  } catch (error) {
    return sendTrainingMiscError(error, res)
  }
}, '下载训练题目资源失败'))
