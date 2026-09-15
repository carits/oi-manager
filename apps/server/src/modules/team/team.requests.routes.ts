/**
 * Team Requests Routes
 * 团队申请处理路由（加入申请、审批、拒绝）
 */

import { Router } from 'express'
import { authenticate, getMembershipType } from '../../middleware/auth'
import { teamService } from './team.service'
import { teamRepository } from './team.repository'
import { asyncHandler } from '../../lib/asyncHandler'
import type { MemberType } from './team.types'
import { getMemberDetailsBatch } from './team.utils'
import { notificationService } from '../notification/notification.service'
import { decideJoinRequest, findPendingJoinMember, listPendingJoinMembers } from './application/team-route-operations.service'
import { TeamContracts } from '@oi-manager/contracts'
import { parseContractBody, sendContractData } from '../../lib/api-contract'

export const teamRequestsRouter = Router()

// ==================== 加入申请 ====================

teamRequestsRouter.post('/:id/join-request', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const { message } = parseContractBody(TeamContracts.joinRequest, req.body)
  const user = (req as any).user!

  const result = await teamService.joinRequest(id, { message }, user)
  sendContractData(res, TeamContracts.joinRequest, result)
}))

// ==================== 加入申请列表 ====================

teamRequestsRouter.get('/:id/join-requests', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const user = (req as any).user!

  const { isAdmin } = await teamService.isTeamAdmin(id, user)
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: '无权查看' })
  }
  const team = await teamService.assertTeamScope(id, user)

  // 查询所有待处理的申请（TeamMember status=pending, invitedBy=null）
  const pendingMembers = await listPendingJoinMembers(id)

  const details = await getMemberDetailsBatch(
    pendingMembers.map(member => ({ userId: member.userId, userType: member.userType as MemberType })),
    team.organizationId || undefined,
  )
  const requests = pendingMembers.map(member => {
    const detail = details.get(`${member.userType}:${member.userId}`)
    return {
      id: member.id,
      message: null,
      createdAt: member.joinedAt,
      user: detail ? {
        id: member.userId,
        name: team.scope === 'personal' ? detail.username : detail.name,
        username: detail.username,
        avatar: detail.avatar,
        userType: team.scope === 'personal' ? 'user' : member.userType,
      } : null,
    }
  })

  sendContractData(res, TeamContracts.joinRequests, requests)
}))

// ==================== 审批 ====================

teamRequestsRouter.post('/join-requests/:requestId/approve', authenticate, asyncHandler(async (req, res) => {
  const { requestId } = req.params
  parseContractBody(TeamContracts.decideJoinRequest, req.body || {})
  const user = (req as any).user!
  const scope = teamService.getScopeForUser(user)

  // 铃铛传 TeamMember.id；旧成员页面仍传申请人的 userId，二者都兼容。
  const member = await findPendingJoinMember(requestId, scope)

  if (!member) {
    return res.status(404).json({ success: false, message: '申请不存在' })
  }

  const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: '无权操作' })
  }

  const callerId = user.userId
  const callerType = getMembershipType(user)
  try {
    await decideJoinRequest({ member, accepted: true, operatorId: callerId, operatorType: callerType as MemberType })
  } catch (error) {
    if (error instanceof Error && error.message === 'ALREADY_PROCESSED') {
      return res.status(400).json({ success: false, message: '该申请已被处理' })
    }
    throw error
  }
  const team = await teamRepository.findById(member.teamId)
  if (team) {
    await notificationService.markSourceReadForScope(scope, 'team_join_request', member.id)
    await notificationService.createJoinDecision({ recipientId: member.userId, scope, requestId: member.id, teamId: member.teamId, teamName: team.name, approved: true, organizationId: team.organizationId || undefined })
  }

  sendContractData(res, TeamContracts.decideJoinRequest, { message: '已同意加入请求' })
}))

teamRequestsRouter.post('/join-requests/:requestId/reject', authenticate, asyncHandler(async (req, res) => {
  const { requestId } = req.params
  parseContractBody(TeamContracts.decideJoinRequest, req.body || {})
  const user = (req as any).user!
  const scope = teamService.getScopeForUser(user)

  const member = await findPendingJoinMember(requestId, scope)

  if (!member) {
    return res.status(404).json({ success: false, message: '申请不存在' })
  }

  const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: '无权操作' })
  }

  const callerId = user.userId
  const callerType = getMembershipType(user)
  try {
    await decideJoinRequest({ member, accepted: false, operatorId: callerId, operatorType: callerType as MemberType })
  } catch (error) {
    if (error instanceof Error && error.message === 'ALREADY_PROCESSED') {
      return res.status(400).json({ success: false, message: '该申请已被处理' })
    }
    throw error
  }
  const team = await teamRepository.findById(member.teamId)
  if (team) {
    await notificationService.markSourceReadForScope(scope, 'team_join_request', member.id)
    await notificationService.createJoinDecision({ recipientId: member.userId, scope, requestId: member.id, teamId: member.teamId, teamName: team.name, approved: false, organizationId: team.organizationId || undefined })
  }

  sendContractData(res, TeamContracts.decideJoinRequest, { message: '已拒绝申请' })
}))
