import { Router, type Response } from 'express'
import { authenticate, type AuthRequest } from '../middleware/auth'
import { asyncHandler, classifyClientError } from '../lib/asyncHandler'
import {
  addTeamProblemList,
  listTeamProblemLists,
  removeTeamProblemList,
  TeamProblemListError,
} from '../modules/team/application/team-problem-list.service'

export const teamProblemListsRouter = Router()

function endpoint(label: string, handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (error instanceof TeamProblemListError) {
        return res.status(error.statusCode).json({ success: false, message: error.message })
      }
      const clientError = classifyClientError(error)
      if (clientError) {
        return res.status(clientError.status).json({
          success: false,
          message: clientError.message,
          ...(clientError.code ? { code: clientError.code } : {}),
        })
      }
      throw error
    }
  }, label)
}

teamProblemListsRouter.get('/:teamId/problem-lists', authenticate, endpoint('获取团队题单列表失败', async (req, res) => {
  res.json({ success: true, data: await listTeamProblemLists(req.user!, req.params.teamId) })
}))

teamProblemListsRouter.post('/:teamId/problem-lists', authenticate, endpoint('添加团队题单失败', async (req, res) => {
  res.json({ success: true, data: await addTeamProblemList(req.user!, req.params.teamId, req.body.problemListId) })
}))

teamProblemListsRouter.delete('/:teamId/problem-lists/:id', authenticate, endpoint('移除团队题单失败', async (req, res) => {
  await removeTeamProblemList(req.user!, req.params.teamId, req.params.id)
  res.json({ success: true, message: '已移除' })
}))
