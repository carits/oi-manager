/**
 * Training CRUD HTTP adapter.
 */

import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { parseTrainingId } from './training.helpers'
import {
  createMakeupHomework,
  createTeamTraining,
  deleteTraining,
  finishTraining,
  getTrainingDetail,
  listTeamTrainings,
  startTraining,
  TrainingCrudError,
  updateTraining,
  updateTrainingEndTime,
} from './application/training-crud.service'

export const trainingCrudRouter = Router()

function sendTrainingError(error: unknown, res: any) {
  if (!(error instanceof TrainingCrudError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
  })
}

trainingCrudRouter.get('/teams/:teamId/trainings', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await listTeamTrainings({
      teamId: req.params.teamId,
      user: req.user!,
      typeFilter: typeof req.query.type === 'string' ? req.query.type : undefined,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendTrainingError(error, res)
  }
}, '查询失败'))

trainingCrudRouter.post('/teams/:teamId/trainings', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await createTeamTraining({
      teamId: req.params.teamId,
      user: req.user!,
      input: req.body,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendTrainingError(error, res)
  }
}, '创建失败'))

trainingCrudRouter.get('/trainings/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await getTrainingDetail(parseTrainingId(req.params.id), req.user!.userId)
    return res.json({ success: true, data })
  } catch (error) {
    return sendTrainingError(error, res)
  }
}, '查询失败'))

trainingCrudRouter.put('/trainings/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await updateTraining(parseTrainingId(req.params.id), req.user!.userId, req.body)
    return res.json({ success: true, data })
  } catch (error) {
    return sendTrainingError(error, res)
  }
}, '更新失败'))

trainingCrudRouter.put('/trainings/:id/end-time', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await updateTrainingEndTime(
      parseTrainingId(req.params.id),
      req.user!.userId,
      req.body.endTime,
    )
    return res.json({ success: true, data })
  } catch (error) {
    return sendTrainingError(error, res)
  }
}, '更新失败'))

trainingCrudRouter.post('/trainings/:id/start', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await startTraining(parseTrainingId(req.params.id), req.user!.userId)
    return res.json({ success: true, data: result.training, message: result.message })
  } catch (error) {
    return sendTrainingError(error, res)
  }
}, '开始比赛失败'))

trainingCrudRouter.post('/trainings/:id/finish', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await finishTraining(parseTrainingId(req.params.id), req.user!.userId)
    return res.json({ success: true, data: result.training, message: result.message })
  } catch (error) {
    return sendTrainingError(error, res)
  }
}, '结束比赛失败'))

trainingCrudRouter.delete('/trainings/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    await deleteTraining(parseTrainingId(req.params.id), req.user!.userId)
    return res.json({ success: true, message: '删除成功' })
  } catch (error) {
    return sendTrainingError(error, res)
  }
}, '删除失败'))

trainingCrudRouter.post('/trainings/:id/create-makeup-homework', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await createMakeupHomework(
      parseTrainingId(req.params.id),
      req.user!.userId,
      req.body,
    )
    return res.json({ success: true, data })
  } catch (error) {
    return sendTrainingError(error, res)
  }
}, '创建补题作业失败'))
