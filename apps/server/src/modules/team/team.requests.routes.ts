/**
 * Team Requests Routes
 * 团队申请处理路由（加入申请、审批、拒绝）
 */

import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { teamService } from './team.service'
import { teamRepository } from './team.repository'
import { asyncHandler } from '../../lib/asyncHandler'
import { prisma } from '../../prisma'
import type { MemberType } from './team.types'
import logger from '../../lib/logger'

export const teamRequestsRouter = Router()

// ==================== 加入申请 ====================

teamRequestsRouter.post('/:id/join-request', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const { message } = req.body
  const user = (req as any).user!

  const result = await teamService.joinRequest(id, { message }, user)
  res.json({ success: true, data: result, message: '申请已提交，等待审批' })
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
  const pendingMembers = await prisma.teamMember.findMany({
    where: { teamId: id, status: 'pending', invitedBy: null },
    orderBy: { joinedAt: 'desc' }
  })

  // 批量获取用户详情
  const userIds = pendingMembers.map(m => m.userId)
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, avatar: true, Teacher: { select: { id: true, name: true, schoolId: true } }, Student: { select: { id: true, name: true, schoolId: true } } }
  })
  const userMap = new Map(users.map(u => [u.id, u]))

  const requests = pendingMembers.map(member => {
    const u = userMap.get(member.userId)
    const profile = u?.Teacher || u?.Student
    return {
      id: member.userId,
      message: null,
      createdAt: member.joinedAt,
      user: u ? {
        id: u.id,
        name: team.scope === 'personal' ? u.username : (profile?.name || u.username),
        username: u.username,
        avatar: u.avatar,
        userType: u.Teacher ? 'teacher' : 'student'
      } : null
    }
  })

  res.json({ success: true, data: requests })
}))

// ==================== 审批 ====================

teamRequestsRouter.post('/join-requests/:requestId/approve', authenticate, asyncHandler(async (req, res) => {
  const { requestId } = req.params
  const user = (req as any).user!
  const scope = teamService.getScopeForUser(user)

  // requestId 是 userId，查找 pending 的 TeamMember（invitedBy=null 表示申请）
  const member = await prisma.teamMember.findFirst({
    where: {
      userId: requestId,
      status: 'pending',
      invitedBy: null,
      Team: { scope }
    }
  })

  if (!member) {
    return res.status(404).json({ success: false, message: '申请不存在' })
  }

  const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: '无权操作' })
  }

  const count = await teamRepository.updateMemberStatusIfPending(member.id, 'active')
  if (count === 0) {
    return res.status(400).json({ success: false, message: '该申请已被处理' })
  }

  const callerId = user.userId
  const callerType = user.role === 'student' ? 'student' : 'teacher'
  await teamRepository.logOperation({
    teamId: member.teamId,
    operatorId: callerId,
    operatorType: callerType as MemberType,
    action: 'join_approve',
    targetId: member.userId,
    targetType: member.userType as MemberType
  })

  res.json({ success: true, message: '已同意加入请求' })
}))

teamRequestsRouter.post('/join-requests/:requestId/reject', authenticate, asyncHandler(async (req, res) => {
  const { requestId } = req.params
  const user = (req as any).user!
  const scope = teamService.getScopeForUser(user)

  const member = await prisma.teamMember.findFirst({
    where: {
      userId: requestId,
      status: 'pending',
      invitedBy: null,
      Team: { scope }
    }
  })

  if (!member) {
    return res.status(404).json({ success: false, message: '申请不存在' })
  }

  const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: '无权操作' })
  }

  await prisma.teamMember.delete({ where: { id: member.id } })

  const callerId = user.userId
  const callerType = user.role === 'student' ? 'student' : 'teacher'
  await teamRepository.logOperation({
    teamId: member.teamId,
    operatorId: callerId,
    operatorType: callerType as MemberType,
    action: 'join_reject',
    targetId: member.userId,
    targetType: member.userType as MemberType
  })

  res.json({ success: true, message: '已拒绝申请' })
}))
