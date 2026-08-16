import crypto from 'crypto'
/**
 * Team Invitations Routes
 * 团队邀请处理路由（邀请列表、接受、拒绝）
 */

import { Router } from 'express'
import { authenticate, getMembershipType } from '../../middleware/auth'
import { teamService } from './team.service'
import { teamRepository } from './team.repository'
import { getUserDisplayName } from './team.utils'
import { asyncHandler } from '../../lib/asyncHandler'
import { prisma } from '../../prisma'
import type { MemberType } from './team.types'
import { notificationService } from '../notification/notification.service'

export const teamInvitationsRouter = Router()

// ==================== 邀请列表 ====================

teamInvitationsRouter.get('/invitations', authenticate, asyncHandler(async (req, res) => {
  const user = (req as any).user!
  const userId = user.userId
  const userType = getMembershipType(user)
  const scope = teamService.getScopeForUser(user)

  const invitations = await teamRepository.findUserPendingInvites(userId, userType as MemberType, scope)

  const formattedInvitations = await Promise.all(
    invitations.map(async (invite) => {
      const team = await teamRepository.findById(invite.teamId)
      const ownerMember = await teamRepository.findOwner(invite.teamId)
      const ownerName = ownerMember ? await getUserDisplayName(ownerMember.userId, ownerMember.userType as MemberType, scope, team?.organizationId || undefined) : '未知'

      let invitedByName = '未知'
      if (invite.invitedBy) {
        invitedByName = await getUserDisplayName(invite.invitedBy, scope === 'personal' ? 'user' : 'teacher', scope, team?.organizationId || undefined)
      }

      return {
        id: invite.id,
        teamId: invite.teamId,
        teamName: team?.name || '',
        teamAvatar: team?.avatar,
        schoolName: team?.Organization?.name || '',
        memberCount: team?.TeamMember?.length || 0,
        ownerName,
        invitedBy: invitedByName,
        invitedAt: invite.joinedAt,
        role: invite.role,
        isPublic: team?.isPublic
      }
    })
  )

  res.json({ success: true, data: formattedInvitations })
}))

// ==================== 管理员团队列表 ====================

teamInvitationsRouter.get('/my-admin-teams', authenticate, asyncHandler(async (req, res) => {
  const user = (req as any).user!
  const userId = user.userId
  const userType = getMembershipType(user)
  const scope = teamService.getScopeForUser(user)

  const memberRecords = await teamRepository.findUserAdminTeams(userId, userType as MemberType, scope)

  const teams = await Promise.all(
    memberRecords.map(async (record) => {
      const team = await teamRepository.findById(record.teamId)
      return team ? {
        id: team.id,
        name: team.name,
        avatar: team.avatar,
        description: team.description,
        isPublic: team.isPublic,
        school: team.Organization
      } : null
    })
  )

  res.json({ success: true, data: teams.filter(Boolean) })
}))

// ==================== 成员团队列表 ====================

teamInvitationsRouter.get('/my-member-teams', authenticate, asyncHandler(async (req, res) => {
  const user = (req as any).user!
  if (user.role !== 'teacher' && user.role !== 'school_principal') {
    return res.json({ success: true, data: [] })
  }

  const memberRecords = await teamRepository.findUserMemberTeams(user.userId, 'teacher', 'campus')

  const teams = await Promise.all(
    memberRecords.map(async (record) => {
      const team = await teamRepository.findById(record.teamId)
      return team ? {
        id: team.id,
        name: team.name,
        avatar: team.avatar,
        description: team.description,
        isPublic: team.isPublic,
        school: team.Organization
      } : null
    })
  )

  res.json({ success: true, data: teams.filter(Boolean) })
}))

// ==================== 管理员邀请处理 ====================

teamInvitationsRouter.get('/admin-invitations', authenticate, asyncHandler(async (req, res) => {
  const user = (req as any).user!
  const userId = user.userId
  const userType = getMembershipType(user)
  const scope = teamService.getScopeForUser(user)

  const invitations = await teamRepository.findUserAdminInvites(userId, userType as MemberType, scope)

  const invitationsWithOwner = await Promise.all(
    invitations.map(async (invite) => {
      const team = await teamRepository.findById(invite.teamId)
      const ownerMember = await teamRepository.findOwner(invite.teamId)
      const ownerName = ownerMember ? await getUserDisplayName(ownerMember.userId, ownerMember.userType as MemberType, scope, team?.organizationId || undefined) : '未知'

      return {
        id: invite.id,
        teamId: invite.teamId,
        teamName: team?.name || '',
        schoolName: team?.Organization?.name || '',
        memberCount: team?.TeamMember?.length || 0,
        ownerName,
        invitedAt: invite.joinedAt
      }
    })
  )

  res.json({ success: true, data: invitationsWithOwner })
}))

teamInvitationsRouter.post('/admin-invitations/:invitationId/accept', authenticate, asyncHandler(async (req, res) => {
  const { invitationId } = req.params
  const user = (req as any).user!

  const invitation = await teamRepository.findMemberById(invitationId)

  if (!invitation) {
    return res.status(404).json({ success: false, message: '邀请不存在' })
  }

  const isMyInvitation = invitation.userId === user.userId
  if (!isMyInvitation) {
    return res.status(404).json({ success: false, message: '邀请不存在' })
  }

  if (invitation.status !== 'pending') {
    return res.status(400).json({ success: false, message: '邀请已处理' })
  }

  await teamService.assertTeamScope(invitation.teamId, user)
  await teamRepository.updateMemberStatus(invitationId, 'active')
  res.json({ success: true, message: '已加入团队' })
}))

teamInvitationsRouter.post('/admin-invitations/:invitationId/reject', authenticate, asyncHandler(async (req, res) => {
  const { invitationId } = req.params
  const user = (req as any).user!

  const invitation = await teamRepository.findMemberById(invitationId)

  if (!invitation) {
    return res.status(404).json({ success: false, message: '邀请不存在' })
  }

  const isMyInvitation = invitation.userId === user.userId
  if (!isMyInvitation) {
    return res.status(404).json({ success: false, message: '邀请不存在' })
  }

  if (invitation.status !== 'pending') {
    return res.status(400).json({ success: false, message: '邀请已处理' })
  }

  await teamService.assertTeamScope(invitation.teamId, user)
  await teamRepository.deleteMember(invitationId)
  res.json({ success: true, message: '已拒绝邀请' })
}))

// ==================== 成员邀请处理 ====================

teamInvitationsRouter.get('/member-invitations', authenticate, asyncHandler(async (req, res) => {
  const user = (req as any).user!

  if (user.role !== 'teacher' && user.role !== 'school_principal') {
    return res.json({ success: true, data: [] })
  }

  const invitations = await teamRepository.findUserMemberInvites(user.userId, 'teacher', 'campus')

  const invitationsWithOwner = await Promise.all(
    invitations.map(async (invite) => {
      const ownerMember = await teamRepository.findOwner(invite.teamId)
      const ownerName = ownerMember ? await getUserDisplayName(ownerMember.userId, ownerMember.userType as MemberType, 'campus') : '未知'
      const team = await teamRepository.findById(invite.teamId)

      return {
        id: invite.id,
        teamId: invite.teamId,
        teamName: team?.name || '',
        schoolName: team?.Organization?.name || '',
        memberCount: team?.TeamMember?.length || 0,
        ownerName,
        invitedAt: invite.joinedAt,
        type: 'member'
      }
    })
  )

  res.json({ success: true, data: invitationsWithOwner })
}))

teamInvitationsRouter.post('/member-invitations/:invitationId/accept', authenticate, asyncHandler(async (req, res) => {
  const { invitationId } = req.params
  const user = (req as any).user!

  if (user.role !== 'teacher' && user.role !== 'school_principal') {
    return res.status(400).json({ success: false, message: '只有教师可以处理成员邀请' })
  }

  const invitation = await teamRepository.findMemberById(invitationId)

  if (!invitation || invitation.userId !== user.userId) {
    return res.status(404).json({ success: false, message: '邀请不存在' })
  }

  if (invitation.status !== 'pending') {
    return res.status(400).json({ success: false, message: '邀请已处理' })
  }

  await teamService.assertTeamScope(invitation.teamId, user)
  await teamRepository.updateMemberStatus(invitationId, 'active')
  res.json({ success: true, message: '已加入团队' })
}))

teamInvitationsRouter.post('/member-invitations/:invitationId/reject', authenticate, asyncHandler(async (req, res) => {
  const { invitationId } = req.params
  const user = (req as any).user!

  if (user.role !== 'teacher' && user.role !== 'school_principal') {
    return res.status(400).json({ success: false, message: '只有教师可以处理成员邀请' })
  }

  const invitation = await teamRepository.findMemberById(invitationId)

  if (!invitation || invitation.userId !== user.userId) {
    return res.status(404).json({ success: false, message: '邀请不存在' })
  }

  if (invitation.status !== 'pending') {
    return res.status(400).json({ success: false, message: '邀请已处理' })
  }

  await teamService.assertTeamScope(invitation.teamId, user)
  await teamRepository.deleteMember(invitationId)
  res.json({ success: true, message: '已拒绝邀请' })
}))

// ==================== 统一邀请处理 ====================

teamInvitationsRouter.post('/invitations/:invitationId/accept', authenticate, asyncHandler(async (req, res) => {
  const { invitationId } = req.params
  const user = (req as any).user!

  const userId = user.userId
  const userType = getMembershipType(user)

  const invitation = await teamRepository.findMemberById(invitationId)

  if (!invitation || invitation.userId !== userId) {
    return res.status(404).json({ success: false, message: '邀请不存在' })
  }

  if (invitation.invitedBy === null) {
    return res.status(400).json({ success: false, message: '这是申请记录，应使用申请审批接口' })
  }

  await teamService.assertTeamScope(invitation.teamId, user)
  const team = await teamRepository.findById(invitation.teamId)

  // 使用事务确保状态更新和日志记录原子性
  const callerType = getMembershipType(user)
  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.teamMember.updateMany({
        where: { id: invitationId, status: 'pending' },
        data: { status: 'active', joinedAt: new Date() }
      })
      if (result.count === 0) {
        throw new Error('ALREADY_PROCESSED')
      }

      await tx.teamOperationLog.create({
        data: {
          id: crypto.randomUUID(),
          teamId: invitation.teamId,
          operatorId: userId,
          operatorType: callerType as MemberType,
          action: 'invite_accept',
          targetId: invitation.userId,
          targetType: invitation.userType as MemberType
        }
      })
    })
    await notificationService.markSourceRead(userId, team!.scope as any, 'team_invitation', invitationId)
    if (invitation.invitedBy) {
      await notificationService.createInvitationResponse({
        recipientId: invitation.invitedBy,
        scope: team!.scope as any,
        invitationId,
        teamId: invitation.teamId,
        teamName: team!.name,
        memberId: invitation.userId,
        memberType: invitation.userType as MemberType,
        accepted: true,
        organizationId: team!.organizationId || undefined
      })
    }
    res.json({ success: true, message: '已加入团队' })
  } catch (error) {
    if (error instanceof Error && error.message === 'ALREADY_PROCESSED') {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }
    throw error
  }
}))
teamInvitationsRouter.post('/invitations/:invitationId/reject', authenticate, asyncHandler(async (req, res) => {
  const { invitationId } = req.params
  const user = (req as any).user!

  const userId = user.userId

  const invitation = await teamRepository.findMemberById(invitationId)

  if (!invitation || invitation.userId !== userId) {
    return res.status(404).json({ success: false, message: '邀请不存在' })
  }

  if (invitation.invitedBy === null) {
    return res.status(400).json({ success: false, message: '这是申请记录，应使用申请审批接口' })
  }

  await teamService.assertTeamScope(invitation.teamId, user)
  const team = await teamRepository.findById(invitation.teamId)

  // 使用事务确保删除和日志记录原子性
  const callerType = getMembershipType(user)
  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.teamMember.deleteMany({
        where: { id: invitationId, status: 'pending' }
      })
      if (result.count === 0) {
        throw new Error('ALREADY_PROCESSED')
      }

      await tx.teamOperationLog.create({
        data: {
          id: crypto.randomUUID(),
          teamId: invitation.teamId,
          operatorId: userId,
          operatorType: callerType as MemberType,
          action: 'invite_reject',
          targetId: invitation.userId,
          targetType: invitation.userType as MemberType
        }
      })
    })
    await notificationService.markSourceRead(userId, team!.scope as any, 'team_invitation', invitationId)
    if (invitation.invitedBy) {
      await notificationService.createInvitationResponse({
        recipientId: invitation.invitedBy,
        scope: team!.scope as any,
        invitationId,
        teamId: invitation.teamId,
        teamName: team!.name,
        memberId: invitation.userId,
        memberType: invitation.userType as MemberType,
        accepted: false,
        organizationId: team!.organizationId || undefined
      })
    }
    res.json({ success: true, message: '已拒绝邀请' })
  } catch (error) {
    if (error instanceof Error && error.message === 'ALREADY_PROCESSED') {
      return res.status(400).json({ success: false, message: '邀请已处理' })
    }
    throw error
  }
}))
