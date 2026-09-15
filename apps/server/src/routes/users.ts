import { Router, type Response } from 'express'
import { IdentityContracts } from '@oi-manager/contracts'
import { authenticate, type AuthRequest, isPersonalContext } from '../middleware/auth'
import { parseContractQuery, sendContractData, sendContractError } from '../lib/api-contract'
import { passwordResetLimiter } from '../middleware/rateLimiter'
import { asyncHandler } from '../lib/asyncHandler'
import { parsePagination } from '../lib/pagination'
import {
  createPlatformAdmin,
  getGlobalUser,
  getUserProfile,
  listGlobalUsers,
  resetGlobalUserPassword,
  updateGlobalUserStatus,
  UserActor,
  UserApplicationError,
} from '../modules/user/application/user.service'

export const userRouter = Router()

function actor(req: AuthRequest): UserActor {
  return {
    userId: req.user!.userId,
    role: req.user!.role,
    organizationId: req.user!.organizationId,
    personalContext: isPersonalContext(req.user),
  }
}

function endpoint(label: string, handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (sendContractError(error, res)) return
      if (error instanceof UserApplicationError) {
        return res.status(error.statusCode).json({
          success: false,
          ...(error.code ? { code: error.code } : {}),
          message: error.message,
        })
      }
      throw error
    }
  }, label)
}

userRouter.get('/:userId/profile', authenticate, endpoint('获取用户资料失败', async (req, res) => {
  const query = parseContractQuery(IdentityContracts.publicProfile, req.query)
  sendContractData(
    res,
    IdentityContracts.publicProfile,
    await getUserProfile(actor(req), req.params.userId, query.userType),
  )
}))

userRouter.get('/', authenticate, endpoint('获取用户列表失败', async (req, res) => {
  const { page, pageSize, skip } = parsePagination(req.query)
  res.json({ success: true, data: await listGlobalUsers(actor(req), req.query, page, pageSize, skip) })
}))

userRouter.get('/:id', authenticate, endpoint('获取用户详情失败', async (req, res) => {
  res.json({ success: true, data: await getGlobalUser(actor(req), req.params.id) })
}))

userRouter.post('/platform-admin', authenticate, endpoint('创建平台管理员失败', async (req, res) => {
  res.status(201).json({ success: true, data: await createPlatformAdmin(actor(req), req.body) })
}))

userRouter.put('/:id/status', authenticate, endpoint('更新用户状态失败', async (req, res) => {
  res.json({ success: true, data: await updateGlobalUserStatus(actor(req), req.params.id, req.body) })
}))

userRouter.post('/:id/reset-password', authenticate, passwordResetLimiter, endpoint('重置用户密码失败', async (req, res) => {
  await resetGlobalUserPassword(actor(req), req.params.id, req.body.newPassword)
  res.json({ success: true, message: '密码已重置' })
}))
