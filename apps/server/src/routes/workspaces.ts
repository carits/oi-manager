import { Router, type Response } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { authenticate, type AuthRequest } from '../middleware/auth'
import {
  inviteOrganizationMember,
  listWorkspaces,
  respondToOrganizationInvitation,
  WorkspaceActor,
  WorkspaceError,
} from '../modules/workspace/application/workspace.service'
import { OrganizationJoinError } from '../modules/organization-join/organization-join.service'
import { WorkspaceContracts } from '@oi-manager/contracts'
import { sendContractData, sendContractError } from '../lib/api-contract'

export const workspaceRouter = Router()

function actor(req: AuthRequest): WorkspaceActor {
  return { userId: req.user!.userId, accountRole: req.user!.accountRole, organizationId: req.user!.organizationId, organizationMembershipId: req.user!.organizationMembershipId }
}

function endpoint(label: string, handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (sendContractError(error, res)) return
      if (error instanceof WorkspaceError) {
        return res.status(error.statusCode).json({
          success: false,
          ...(error.code ? { code: error.code } : {}),
          message: error.message,
        })
      }
      if (error instanceof OrganizationJoinError) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
      }
      throw error
    }
  }, label)
}

workspaceRouter.get('/', authenticate, endpoint('获取工作区失败', async (req, res) => {
  sendContractData(res, WorkspaceContracts.list, { workspaces: await listWorkspaces(actor(req)) })
}))

workspaceRouter.post('/organizations/:id/invitations', authenticate, endpoint('邀请校园成员失败', async (req, res) => {
  res.json({ success: true, data: await inviteOrganizationMember(actor(req), req.params.id, req.body) })
}))

workspaceRouter.post('/organization-invitations/:id/:action', authenticate, endpoint('处理校园邀请失败', async (req, res) => {
  await respondToOrganizationInvitation(actor(req), req.params.id, req.params.action)
  res.json({ success: true })
}))
