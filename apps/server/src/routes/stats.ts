import { Router, type Response } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { authenticate, type AuthRequest, isAdmin } from '../middleware/auth'
import { getGlobalPlatformStats, getSchoolPlatformStats } from '../modules/dashboard/application/platform-stats.service'

export const statsRouter = Router()

function adminEndpoint(label: string, handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!isAdmin(req.user!.role)) return res.status(403).json({ success: false, message: '权限不足' })
    await handler(req, res)
  }, label)
}

statsRouter.get('/global', authenticate, adminEndpoint('获取全局统计失败', async (_req, res) => {
  res.json({ success: true, data: await getGlobalPlatformStats() })
}))

statsRouter.get('/schools', authenticate, adminEndpoint('获取学校统计失败', async (_req, res) => {
  res.json({ success: true, data: await getSchoolPlatformStats() })
}))
