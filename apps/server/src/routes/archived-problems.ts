import { Router, type Response } from 'express'
import { authenticate, type AuthRequest } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { parsePagination } from '../lib/pagination'
import {
  archiveProblem,
  ArchivedProblemError,
  deleteArchivedProblem,
  deleteArchivedProblems,
  getArchivedProblem,
  getArchivedProblemStats,
  listArchivedProblems,
  updateArchivedProblem,
} from '../modules/archived-problem/application/archived-problem.service'

export const archivedProblemsRouter = Router()

function endpoint(label: string, handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (error instanceof ArchivedProblemError) {
        return res.status(error.statusCode).json({ success: false, message: error.message })
      }
      throw error
    }
  }, label)
}

archivedProblemsRouter.get('/', authenticate, endpoint('获取归档列表失败', async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query)
  res.json(await listArchivedProblems(req.user!.userId, req.query, page, pageSize, skip))
}))

// Static route must remain before /:id.
archivedProblemsRouter.get('/stats/summary', authenticate, endpoint('获取归档统计失败', async (req, res) => {
  res.json({ success: true, data: await getArchivedProblemStats(req.user!.userId) })
}))

archivedProblemsRouter.get('/:id', authenticate, endpoint('获取归档详情失败', async (req, res) => {
  res.json({ success: true, data: await getArchivedProblem(req.user!.userId, req.params.id) })
}))

archivedProblemsRouter.post('/', authenticate, endpoint('归档题目失败', async (req, res) => {
  const result = await archiveProblem(req.user!.userId, req.body)
  res.status(result.created ? 201 : 200).json({
    success: true,
    data: result.item,
    message: result.created ? '归档成功' : '归档已更新',
  })
}))

archivedProblemsRouter.put('/:id', authenticate, endpoint('更新归档失败', async (req, res) => {
  res.json({ success: true, data: await updateArchivedProblem(req.user!.userId, req.params.id, req.body) })
}))

archivedProblemsRouter.delete('/:id', authenticate, endpoint('删除归档失败', async (req, res) => {
  await deleteArchivedProblem(req.user!.userId, req.params.id)
  res.json({ success: true, message: '已从归档中移除' })
}))

archivedProblemsRouter.delete('/', authenticate, endpoint('批量删除归档失败', async (req, res) => {
  const count = await deleteArchivedProblems(req.user!.userId, req.body.ids)
  res.json({ success: true, message: `已移除 ${count} 条归档` })
}))
