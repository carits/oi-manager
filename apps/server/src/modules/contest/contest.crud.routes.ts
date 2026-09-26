/**
 * Contest CRUD HTTP adapter.
 */

import { Router } from 'express'
import { ContestContracts } from '@oi-manager/contracts'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import type { AuthRequest } from '../../middleware/auth'
import { parseContestId } from './contest.helpers'
import {
  createMakeupHomework,
  createPlatformContest,
  createTeamContest,
  deleteContest,
  finishContest,
  getContestDetail,
  listPlatformContests,
  listTeamContests,
  startContest,
  ContestCrudError,
  updateContest,
  updateContestEndTime,
} from './application/contest-crud.service'

export const contestCrudRouter = Router()

function sendContestError(error: unknown, res: any) {
  if (sendContractError(error, res)) return
  if (!(error instanceof ContestCrudError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
  })
}

contestCrudRouter.get('/platform-contests', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    return res.json({ success: true, data: await listPlatformContests(req.user!.userId) })
  } catch (error) {
    return sendContestError(error, res)
  }
}, '查询平台比赛失败'))

contestCrudRouter.post('/platform-contests', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await createPlatformContest({ user: req.user!, input: req.body })
    return res.status(201).json({ success: true, data })
  } catch (error) {
    return sendContestError(error, res)
  }
}, '创建平台比赛失败'))

contestCrudRouter.get('/teams/:teamId/contests', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await listTeamContests({
      teamId: req.params.teamId,
      user: req.user!,
      typeFilter: typeof req.query.type === 'string' ? req.query.type : undefined,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendContestError(error, res)
  }
}, '查询失败'))

contestCrudRouter.post('/teams/:teamId/contests', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await createTeamContest({
      teamId: req.params.teamId,
      user: req.user!,
      input: req.body,
    })
    return res.json({ success: true, data })
  } catch (error) {
    return sendContestError(error, res)
  }
}, '创建失败'))

contestCrudRouter.get('/contests/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await getContestDetail(parseContestId(req.params.id), req.user!.userId)
    return res.json({ success: true, data })
  } catch (error) {
    return sendContestError(error, res)
  }
}, '查询失败'))

contestCrudRouter.put('/contests/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await updateContest(parseContestId(req.params.id), req.user!.userId, req.body)
    return res.json({ success: true, data })
  } catch (error) {
    return sendContestError(error, res)
  }
}, '更新失败'))

contestCrudRouter.put('/contests/:id/end-time', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await updateContestEndTime(
      parseContestId(req.params.id),
      req.user!.userId,
      req.body.endTime,
    )
    return res.json({ success: true, data })
  } catch (error) {
    return sendContestError(error, res)
  }
}, '更新失败'))

contestCrudRouter.post('/contests/:id/start', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await startContest(parseContestId(req.params.id), req.user!.userId)
    return res.json({ success: true, data: result.contest, message: result.message })
  } catch (error) {
    return sendContestError(error, res)
  }
}, '开始比赛失败'))

contestCrudRouter.post('/contests/:id/finish', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const result = await finishContest(parseContestId(req.params.id), req.user!.userId)
    return res.json({ success: true, data: result.contest, message: result.message })
  } catch (error) {
    return sendContestError(error, res)
  }
}, '结束比赛失败'))

contestCrudRouter.delete('/contests/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    await deleteContest(parseContestId(req.params.id), req.user!.userId)
    return res.json({ success: true, message: '删除成功' })
  } catch (error) {
    return sendContestError(error, res)
  }
}, '删除失败'))

contestCrudRouter.post('/contests/:id/create-makeup-homework', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(ContestContracts.createMakeupHomework, req.body)
    const data = await createMakeupHomework(
      parseContestId(req.params.id),
      req.user!.userId,
      body,
    )
    return sendContractData(res, ContestContracts.createMakeupHomework, data)
  } catch (error) {
    return sendContestError(error, res)
  }
}, '创建补题作业失败'))
