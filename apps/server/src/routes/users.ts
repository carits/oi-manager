import { Router, type Response } from 'express'
import { IdentityContracts } from '@oi-manager/contracts'
import { authenticate, type AuthRequest, isPersonalContext } from '../middleware/auth'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../lib/api-contract'
import { passwordResetLimiter } from '../middleware/rateLimiter'
import { asyncHandler } from '../lib/asyncHandler'
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
    accountRole: req.user!.accountRole,
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
  const query = parseContractQuery(IdentityContracts.managedUsers, req.query)
  sendContractData(res, IdentityContracts.managedUsers, await listGlobalUsers(actor(req), query, query.page, query.pageSize, (query.page - 1) * query.pageSize))
}))

userRouter.get('/:id', authenticate, endpoint('获取用户详情失败', async (req, res) => {
  sendContractData(res, IdentityContracts.managedUser, await getGlobalUser(actor(req), req.params.id))
}))

userRouter.post('/platform-admin', authenticate, endpoint('创建平台管理员失败', async (req, res) => {
  const body = parseContractBody(IdentityContracts.createPlatformAdmin, req.body)
  sendContractData(res, IdentityContracts.createPlatformAdmin, await createPlatformAdmin(actor(req), body), 201)
}))

userRouter.put('/:id/status', authenticate, endpoint('更新用户状态失败', async (req, res) => {
  const body = parseContractBody(IdentityContracts.updateManagedUserStatus, req.body)
  sendContractData(res, IdentityContracts.updateManagedUserStatus, await updateGlobalUserStatus(actor(req), req.params.id, body))
}))

userRouter.post('/:id/reset-password', authenticate, passwordResetLimiter, endpoint('重置用户密码失败', async (req, res) => {
  const body = parseContractBody(IdentityContracts.resetManagedUserPassword, req.body)
  await resetGlobalUserPassword(actor(req), req.params.id, body.newPassword)
  sendContractData(res, IdentityContracts.resetManagedUserPassword, { reset: true })
}))
