/**
 * Team Members Routes
 * 团队成员管理路由（邀请、移除、管理员、可用成员、待处理邀请）
 */

import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { teamService } from './team.service'
import { teamRepository } from './team.repository'
import { getUserName, getMemberDetailsBatch, getUserNames } from './team.utils'
import { asyncHandler } from '../../lib/asyncHandler'
import { validate, validateBody, validateParams } from '../../lib/zodValidate'
import { addMembersSchema, memberIdSchema, setAdminSchema } from './schemas/team.schemas'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import { prisma } from '../../prisma'
import type { MemberType } from './team.types'

export const teamMembersRouter = Router()

// ==================== 可邀请成员 ====================

teamMembersRouter.get('/:id/available-members', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const { keyword, type } = req.query
  const user = (req as any).user!

  const { isAdmin } = await teamService.isTeamAdmin(id, user)
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: '无权查看' })
  }

  const team = await teamRepository.findById(id)
  if (!team) {
    return res.status(404).json({ success: false, message: '团队不存在' })
  }

  const existingMembers = await teamRepository.findMembers(id)
  const existingTeacherIds = existingMembers.filter(m => m.userType === 'teacher').map(m => m.userId)
  const existingStudentIds = existingMembers.filter(m => m.userType === 'student').map(m => m.userId)

  const result = await teamRepository.findAvailableMembers({
    schoolId: team.schoolId,
    excludeTeacherIds: existingTeacherIds,
    excludeStudentIds: existingStudentIds,
    keyword: keyword as string,
    type: type as MemberType
  })

  res.json({ success: true, data: result })
}))

// ==================== 邀请成员 ====================

teamMembersRouter.post('/:id/members', authenticate, validateBody(addMembersSchema), asyncHandler(async (req, res) => {
  const { id } = req.params
  const validated = (req as any).validated?.body
  const { members, usernames, role = 'member' } = validated
  const user = (req as any).user!

  try {
    const result = await teamService.inviteMembers(id, { members, usernames, role }, user)
    res.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ success: false, message: '该成员已被邀请，请勿重复操作' })
    }
    handleError(res, error)
  }
}))

// ==================== 移除成员 ====================

teamMembersRouter.delete('/:id/members/:memberId', authenticate, validateParams(memberIdSchema), asyncHandler(async (req, res) => {
  const validated = (req as any).validated?.params
  const { id, memberId } = validated
  const memberType = req.query.memberType as string | undefined
  const user = (req as any).user!

  const { isAdmin } = await teamService.isTeamAdmin(id, user)
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: '无权操作' })
  }

  let member
  if (memberType && (memberType === 'teacher' || memberType === 'student')) {
    member = await teamRepository.findMember({
      teamId: id,
      userId: memberId,
      userType: memberType
    })
  } else {
    member = await teamRepository.findMemberById(memberId)
  }

  if (!member) {
    return res.status(404).json({ success: false, message: '成员不存在' })
  }

  if (member.teamId !== id) {
    return res.status(400).json({ success: false, message: '该成员不属于当前团队' })
  }

  if (member.role === 'owner') {
    return res.status(403).json({ success: false, message: '不能移除团队所有者' })
  }

  const { isOwner } = await teamService.isTeamAdmin(id, user)
  if (!isOwner && member.role === 'admin') {
    return res.status(403).json({ success: false, message: '只有所有者可以移除管理员' })
  }

  const callerId = user.userId
  if (member.userId === callerId) {
    return res.status(400).json({ success: false, message: '如需退出团队，请使用退出功能' })
  }

  // 使用事务确保成员删除和日志记录原子性
  await prisma.$transaction(async (tx) => {
    await tx.teamMember.delete({ where: { id: member.id } })

    const callerType = user.role === 'student' ? 'student' : 'teacher'
    await tx.teamOperationLog.create({
      data: {
        id: crypto.randomUUID(),
        teamId: id,
        operatorId: callerId || '',
        operatorType: callerType as MemberType,
        action: 'member_remove',
        targetId: member.userId,
        targetType: member.userType as MemberType,
        oldValue: member.role,
        newValue: 'removed'
      }
    })
  })

  res.json({ success: true, message: '移除成功' })
}))

// ==================== 待处理邀请 ====================

teamMembersRouter.get('/:id/pending-invites', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const user = (req as any).user!

  const { isAdmin } = await teamService.isTeamAdmin(id, user)
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: '无权查看' })
  }

  const pendingMembers = await teamRepository.findMembers(id, { status: 'pending' })

  const [detailsMap, inviterNames] = await Promise.all([
    getMemberDetailsBatch(pendingMembers.map(m => ({ userId: m.userId, userType: m.userType as MemberType }))),
    getUserNames(pendingMembers.filter(m => m.invitedBy).map(m => m.invitedBy!), 'teacher'),
  ])

  const invites = pendingMembers.map(member => {
    const userDetails = detailsMap.get(`${member.userType}:${member.userId}`)
    if (!userDetails) return null
    return {
      id: member.id,
      type: member.userType,
      role: member.role,
      invitedAt: member.joinedAt,
      invitedByName: member.invitedBy ? (inviterNames.get(member.invitedBy) || '未知') : '未知',
      user: userDetails
    }
  })

  res.json({ success: true, data: invites.filter(Boolean) })
}))

// ==================== 管理员列表 ====================

teamMembersRouter.get('/:id/admins', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params

  const adminMembers = await teamRepository.findAdmins(id)

  const detailsMap = await getMemberDetailsBatch(adminMembers.map(m => ({ userId: m.userId, userType: m.userType as MemberType })))

  const admins = adminMembers.map(m => {
    const details = detailsMap.get(`${m.userType}:${m.userId}`)
    return details ? { ...details, adminType: m.userType } : null
  })

  res.json({ success: true, data: admins.filter(Boolean) })
}))

// ==================== 设置管理员 ====================

teamMembersRouter.post('/:id/admins', authenticate, validateBody(setAdminSchema), asyncHandler(async (req, res) => {
  const { id } = req.params
  const validated = (req as any).validated?.body
  const { memberId, memberType } = validated
  const user = (req as any).user!

  const { isOwner } = await teamService.isTeamAdmin(id, user)
  if (!isOwner) {
    return res.status(403).json({ success: false, message: '只有团队所有者可以添加管理员' })
  }

  let existingMember
  if (memberType && (memberType === 'teacher' || memberType === 'student')) {
    existingMember = await teamRepository.findMember({
      teamId: id,
      userId: memberId,
      userType: memberType
    })
  } else {
    existingMember = await teamRepository.findMemberById(memberId)
  }

  if (!existingMember) {
    return res.status(404).json({ success: false, message: '该成员不存在' })
  }

  if (existingMember.teamId !== id) {
    return res.status(400).json({ success: false, message: '该成员不属于当前团队' })
  }

  if (existingMember.role === 'admin') {
    return res.status(400).json({ success: false, message: '该成员已是管理员' })
  }

  if (existingMember.role === 'owner') {
    return res.status(400).json({ success: false, message: '所有者无需设为管理员' })
  }

  const oldRole = existingMember.role

  // 使用事务确保角色更新和日志记录原子性
  const result = await prisma.$transaction(async (tx) => {
    const admin = await tx.teamMember.update({
      where: { id: existingMember.id },
      data: { role: 'admin' }
    })

    const callerId = user.userId
    const callerType = user.role === 'student' ? 'student' : 'teacher'
    await tx.teamOperationLog.create({
      data: {
        id: crypto.randomUUID(),
        teamId: id,
        operatorId: callerId || '',
        operatorType: callerType as MemberType,
        action: 'role_change',
        targetId: existingMember.userId,
        targetType: existingMember.userType as MemberType,
        oldValue: oldRole,
        newValue: 'admin'
      }
    })

    return admin
  })

  const memberName = await getUserName(existingMember.userId, existingMember.userType as MemberType)

  res.json({ success: true, data: { ...result, memberName }, message: '已设置为管理员' })
}))

// ==================== 取消管理员 ====================

teamMembersRouter.delete('/:id/admins/:adminId', authenticate, asyncHandler(async (req, res) => {
  const { id, adminId } = req.params
  const adminType = req.query.adminType as string | undefined
  const user = (req as any).user!

  const { isOwner } = await teamService.isTeamAdmin(id, user)
  if (!isOwner) {
    return res.status(403).json({ success: false, message: '只有团队所有者可以移除管理员' })
  }

  let adminMember
  if (adminType && (adminType === 'teacher' || adminType === 'student')) {
    adminMember = await teamRepository.findMember({
      teamId: id,
      userId: adminId,
      userType: adminType
    })
  } else {
    adminMember = await teamRepository.findMemberById(adminId)
  }

  if (!adminMember || adminMember.role !== 'admin') {
    return res.status(404).json({ success: false, message: '管理员不存在' })
  }

  if (adminMember.teamId !== id) {
    return res.status(400).json({ success: false, message: '该管理员不属于当前团队' })
  }

  const oldRole = adminMember.role

  // 使用事务确保角色更新和日志记录原子性
  await prisma.$transaction(async (tx) => {
    await tx.teamMember.update({
      where: { id: adminMember.id },
      data: { role: 'member' }
    })

    const callerId = user.userId
    const callerType = user.role === 'student' ? 'student' : 'teacher'
    await tx.teamOperationLog.create({
      data: {
        id: crypto.randomUUID(),
        teamId: id,
        operatorId: callerId || '',
        operatorType: callerType as MemberType,
        action: 'role_change',
        targetId: adminMember.userId,
        targetType: adminMember.userType as MemberType,
        oldValue: oldRole,
        newValue: 'member'
      }
    })
  })

  res.json({ success: true, message: '移除成功' })
}))

// ==================== 取消邀请 ====================

teamMembersRouter.delete('/:id/invites/:inviteId', authenticate, asyncHandler(async (req, res) => {
  const { id, inviteId } = req.params
  const user = (req as any).user!

  const { isAdmin } = await teamService.isTeamAdmin(id, user)
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: '无权操作' })
  }

  const invite = await teamRepository.findMemberById(inviteId)

  if (!invite) {
    return res.status(404).json({ success: false, message: '邀请不存在' })
  }

  if (invite.teamId !== id) {
    return res.status(400).json({ success: false, message: '该邀请不属于当前团队' })
  }

  if (invite.status !== 'pending') {
    return res.status(400).json({ success: false, message: '邀请已被处理' })
  }

  const count = await teamRepository.deleteMemberIfPending(inviteId)
  if (count === 0) {
    return res.status(400).json({ success: false, message: '邀请已被处理' })
  }

  res.json({ success: true, message: '已取消邀请' })
}))

// ==================== 错误处理工具（局部） ====================

function handleError(res: any, error: unknown, defaultMessage: string = '服务器错误') {
  if (error instanceof Error) {
    const errorMessages: Record<string, { status: number; message: string }> = {
      'TEAM_NOT_FOUND': { status: 404, message: '团队不存在' },
      'NOT_OWNER': { status: 403, message: '只有团队所有者可以执行此操作' },
      'NOT_ADMIN': { status: 403, message: '只有团队所有者或管理员可以执行此操作' },
      'NOT_MEMBER': { status: 403, message: '您没有权限查看该团队' },
      'MEMBER_NOT_FOUND': { status: 404, message: '成员不存在或无权移除' },
      'NO_PERMISSION': { status: 403, message: '无权操作' },
      'ALREADY_MEMBER': { status: 400, message: '已是团队成员' },
    }
    const errorInfo = errorMessages[error.message]
    if (errorInfo) {
      return res.status(errorInfo.status).json({ success: false, message: errorInfo.message })
    }
  }
  throw error
}
