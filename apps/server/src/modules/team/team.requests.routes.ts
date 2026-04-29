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

  if (user.userId) {
    res.json({ success: true, data: result, message: '申请已提交' })
  } else {
    res.json({ success: true, data: result, message: '申请已提交，等待审批' })
  }
}))

teamRequestsRouter.post('/:id/teacher-join-request', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params
  const { message } = req.body
  const user = (req as any).user!

  if (user.role !== 'teacher' && user.role !== 'school_principal') {
    return res.status(403).json({ success: false, message: '只有教师可以申请加入' })
  }

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

  // 学生申请
  const studentRequests = await teamRepository.findJoinRequests(id)

  const studentUserAvatars = await Promise.all(
    studentRequests.map(r =>
      r.Student?.id
        ? teamRepository.findUserAvatar(r.Student.id)
        : Promise.resolve(null)
    )
  )

  // 教师申请
  const teacherRequests = await teamRepository.findMembers(id, { status: 'pending', userType: 'teacher' })
    .then(members => members.filter(m => !m.invitedBy))

  const teacherRequestsWithDetails = await Promise.all(
    teacherRequests.map(async (member) => {
      const teacher = await teamRepository.findTeacher(member.userId)
      const user = teacher ? await teamRepository.findUserAvatar(teacher.id) : null
      return {
        id: member.userId,
        type: 'teacher',
        message: null,
        createdAt: member.joinedAt,
        user: teacher ? { ...teacher, avatar: user?.avatar || teacher.avatar, userType: 'teacher' } : null
      }
    })
  )

  const formattedStudentRequests = studentRequests.map((r, i) => ({
    id: r.userId,
    type: 'student',
    source: 'join-request',
    message: r.message,
    createdAt: r.createdAt,
    user: {
      ...r.Student,
      avatar: studentUserAvatars[i]?.avatar || r.Student?.avatar,
      userType: 'student'
    }
  }))

  const formattedTeacherRequests = teacherRequestsWithDetails.map(r => ({
    id: r.id,
    type: 'teacher',
    source: 'join-request',
    message: r.message,
    createdAt: r.createdAt,
    user: r.user
  }))

  res.json({
    success: true,
    data: [...formattedStudentRequests, ...formattedTeacherRequests].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  })
}))

// ==================== 教师申请审批 ====================

teamRequestsRouter.post('/teacher-join-requests/:memberId/approve', authenticate, asyncHandler(async (req, res) => {
  const { memberId } = req.params
  const user = (req as any).user!

  const member = await teamRepository.findMemberById(memberId)

  if (!member || member.userType !== 'teacher') {
    return res.status(404).json({ success: false, message: '请求不存在' })
  }

  if (member.invitedBy !== null) {
    return res.status(400).json({ success: false, message: '这是邀请记录，应使用邀请接受/拒绝接口' })
  }

  if (member.status !== 'pending') {
    return res.status(400).json({ success: false, message: '该申请已被处理' })
  }

  const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: '无权操作' })
  }

  const count = await teamRepository.updateMemberStatusIfPending(memberId, 'active')
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
    targetType: 'teacher'
  })

  res.json({ success: true, message: '已同意加入请求' })
}))

teamRequestsRouter.post('/teacher-join-requests/:memberId/reject', authenticate, asyncHandler(async (req, res) => {
  const { memberId } = req.params
  const user = (req as any).user!

  const member = await teamRepository.findMemberById(memberId)

  if (!member || member.userType !== 'teacher') {
    return res.status(404).json({ success: false, message: '请求不存在' })
  }

  if (member.invitedBy !== null) {
    return res.status(400).json({ success: false, message: '这是邀请记录，应使用邀请接受/拒绝接口' })
  }

  if (member.status !== 'pending') {
    return res.status(400).json({ success: false, message: '该申请已被处理' })
  }

  const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: '无权操作' })
  }

  const count = await teamRepository.deleteMemberIfPending(memberId)
  if (count === 0) {
    return res.status(400).json({ success: false, message: '该申请已被处理' })
  }

  const callerId = user.userId
  const callerType = user.role === 'student' ? 'student' : 'teacher'
  await teamRepository.logOperation({
    teamId: member.teamId,
    operatorId: callerId,
    operatorType: callerType as MemberType,
    action: 'join_reject',
    targetId: member.userId,
    targetType: 'teacher'
  })

  res.json({ success: true, message: '已拒绝加入请求' })
}))

// ==================== 统一审批 ====================

teamRequestsRouter.post('/requests/:requestId/approve', authenticate, asyncHandler(async (req, res) => {
  const { requestId } = req.params
  const { type } = req.query
  const user = (req as any).user!
  const callerId = user.userId

  try {
    if (type === 'teacher') {
      await teamRepository.transaction(async (tx) => {
        const member = await tx.teamMember.findUnique({ where: { id: requestId } })
        if (!member || member.userType !== 'teacher') {
          throw new Error('REQUEST_NOT_FOUND')
        }

        const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
        if (!isAdmin) {
          throw new Error('NO_PERMISSION')
        }

        const result = await tx.teamMember.updateMany({
          where: { id: requestId, status: 'pending' },
          data: { status: 'active', joinedAt: new Date() }
        })
        if (result.count === 0) {
          throw new Error('ALREADY_PROCESSED')
        }

        const callerType = user.role === 'student' ? 'student' : 'teacher'
        await tx.teamOperationLog.create({
          data: {
            teamId: member.teamId,
            operatorId: callerId,
            operatorType: callerType,
            action: 'join_approve',
            targetId: member.userId,
            targetType: 'teacher'
          }
        })

        logger.audit('join_request_approve', {
          userId: user.userId,
          action: 'join_approve',
          target: requestId,
          metadata: { teamId: member.teamId, type: 'teacher', targetId: member.userId }
        })
      })

      res.json({ success: true, message: '已同意加入请求' })
    } else {
      await teamRepository.transaction(async (tx) => {
        const request = await tx.teamJoinRequest.findUnique({ where: { id: requestId } })
        if (!request) {
          throw new Error('REQUEST_NOT_FOUND')
        }

        const { isAdmin } = await teamService.isTeamAdmin(request.teamId, user)
        if (!isAdmin) {
          throw new Error('NO_PERMISSION')
        }

        const result = await tx.teamJoinRequest.updateMany({
          where: { id: requestId, status: 'pending' },
          data: { status: 'approved', processedAt: new Date(), processedBy: callerId }
        })
        if (result.count === 0) {
          throw new Error('ALREADY_PROCESSED')
        }

        await tx.teamMember.upsert({
          where: {
            teamId_userId_userType: {
              teamId: request.teamId,
              userId: request.userId,
              userType: 'student'
            }
          },
          update: { status: 'active', invitedBy: callerId },
          create: {
            teamId: request.teamId,
            userId: request.userId,
            userType: 'student',
            role: 'member',
            status: 'active',
            invitedBy: callerId,
            joinedAt: new Date()
          }
        })

        const callerType = user.role === 'student' ? 'student' : 'teacher'
        await tx.teamOperationLog.create({
          data: {
            teamId: request.teamId,
            operatorId: callerId,
            operatorType: callerType,
            action: 'join_approve',
            targetId: request.userId,
            targetType: 'student'
          }
        })

        logger.audit('join_request_approve', {
          userId: user.userId,
          action: 'join_approve',
          target: requestId,
          metadata: { teamId: request.teamId, type: 'student', targetId: request.id }
        })
      })

      res.json({ success: true, message: '已同意申请' })
    }
  } catch (error) {
    if (error instanceof Error) {
      const errorMessages: Record<string, { status: number; message: string }> = {
        'REQUEST_NOT_FOUND': { status: 404, message: '申请不存在' },
        'NO_PERMISSION': { status: 403, message: '无权操作' },
        'ALREADY_PROCESSED': { status: 400, message: '该申请已处理' }
      }
      const errorInfo = errorMessages[error.message]
      if (errorInfo) {
        return res.status(errorInfo.status).json({ success: false, message: errorInfo.message })
      }
    }
    throw error
  }
}))

teamRequestsRouter.post('/requests/:requestId/reject', authenticate, asyncHandler(async (req, res) => {
  const { requestId } = req.params
  const { type } = req.query
  const user = (req as any).user!

  if (type === 'teacher') {
    const member = await teamRepository.findMemberById(requestId)

    if (!member || member.userType !== 'teacher') {
      return res.status(404).json({ success: false, message: '申请不存在' })
    }

    const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    // 使用事务确保删除和日志记录原子性
    const callerId = user.userId
    const callerType = user.role === 'student' ? 'student' : 'teacher'
    try {
      await prisma.$transaction(async (tx) => {
        const result = await tx.teamMember.deleteMany({
          where: { id: requestId, status: 'pending' }
        })
        if (result.count === 0) {
          throw new Error('ALREADY_PROCESSED')
        }

        await tx.teamOperationLog.create({
          data: {
            teamId: member.teamId,
            operatorId: callerId,
            operatorType: callerType as MemberType,
            action: 'join_reject',
            targetId: member.userId,
            targetType: 'teacher'
          }
        })
      })

      logger.audit('join_request_reject', {
        userId: user.userId,
        action: 'join_reject',
        target: requestId,
        metadata: { teamId: member.teamId, type: 'teacher' }
      })

      res.json({ success: true, message: '已拒绝加入请求' })
    } catch (error) {
      if (error instanceof Error && error.message === 'ALREADY_PROCESSED') {
        return res.status(400).json({ success: false, message: '该申请已被处理' })
      }
      throw error
    }
  } else {
    const request = await teamRepository.findJoinRequestById(requestId)

    if (!request) {
      return res.status(404).json({ success: false, message: '申请不存在' })
    }

    const { isAdmin } = await teamService.isTeamAdmin(request.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    const processedBy = user.userId
    const callerType = user.role === 'student' ? 'student' : 'teacher'

    // 使用事务确保状态更新和日志记录原子性
    try {
      await prisma.$transaction(async (tx) => {
        const result = await tx.teamJoinRequest.updateMany({
          where: { id: requestId, status: 'pending' },
          data: { status: 'rejected', processedAt: new Date(), processedBy }
        })
        if (result.count === 0) {
          throw new Error('ALREADY_PROCESSED')
        }

        await tx.teamOperationLog.create({
          data: {
            teamId: request.teamId,
            operatorId: processedBy,
            operatorType: callerType as MemberType,
            action: 'join_reject',
            targetId: request.userId,
            targetType: 'student'
          }
        })
      })

      logger.audit('join_request_reject', {
        userId: user.userId,
        action: 'join_reject',
        target: requestId,
        metadata: { teamId: request.teamId, type: 'student' }
      })

      res.json({ success: true, message: '已拒绝申请' })
    } catch (error) {
      if (error instanceof Error && error.message === 'ALREADY_PROCESSED') {
        return res.status(400).json({ success: false, message: '该申请已被处理' })
      }
      throw error
    }
  }
}))

// ==================== 兼容旧 API ====================

teamRequestsRouter.post('/join-requests/:requestId/approve', authenticate, asyncHandler(async (req, res) => {
  const { requestId } = req.params
  const user = (req as any).user!

  // 先查 TeamJoinRequest（学生申请），再查 TeamMember（教师申请）
  const request = await teamRepository.findJoinRequestById(requestId)
  if (request) {
    // 学生申请处理
    const { isAdmin } = await teamService.isTeamAdmin(request.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    const processedBy = user.userId

    try {
      await teamRepository.transaction(async (tx) => {
        const result = await tx.teamJoinRequest.updateMany({
          where: { id: requestId, status: 'pending' },
          data: { status: 'approved', processedAt: new Date(), processedBy }
        })
        if (result.count === 0) {
          throw new Error('ALREADY_PROCESSED')
        }

        await tx.teamMember.create({
          data: {
            teamId: request.teamId,
            userId: request.userId,
            userType: 'student',
            role: 'member',
            status: 'active',
            invitedBy: processedBy,
            joinedAt: new Date()
          }
        })
      })

      res.json({ success: true, message: '已同意申请' })
    } catch (error) {
      if (error instanceof Error && error.message === 'ALREADY_PROCESSED') {
        return res.status(400).json({ success: false, message: '该申请已被处理' })
      }
      throw error
    }
    return
  }

  // 教师申请处理：requestId 可能是 userId，查找 pending 的教师 TeamMember
  const member = await prisma.teamMember.findFirst({
    where: { userId: requestId, userType: 'teacher', status: 'pending', invitedBy: null }
  })
  if (member) {
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
      targetType: 'teacher'
    })

    res.json({ success: true, message: '已同意加入请求' })
    return
  }

  res.status(404).json({ success: false, message: '申请不存在' })
}))

teamRequestsRouter.post('/join-requests/:requestId/reject', authenticate, asyncHandler(async (req, res) => {
  const { requestId } = req.params
  const user = (req as any).user!

  const request = await teamRepository.findJoinRequestById(requestId)
  if (request) {
    const { isAdmin } = await teamService.isTeamAdmin(request.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    const processedBy = user.userId
    const count = await teamRepository.updateJoinRequestIfPending(requestId, {
      status: 'rejected',
      processedAt: new Date(),
      processedBy
    })
    if (count === 0) {
      return res.status(400).json({ success: false, message: '该申请已被处理' })
    }

    res.json({ success: true, message: '已拒绝申请' })
    return
  }

  // 教师申请：requestId 是 userId，查找 pending 的 TeamMember
  const member = await prisma.teamMember.findFirst({
    where: { userId: requestId, status: 'pending', invitedBy: null }
  })
  if (member) {
    const { isAdmin } = await teamService.isTeamAdmin(member.teamId, user)
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: '无权操作' })
    }

    await prisma.teamMember.delete({ where: { id: member.id } })
    res.json({ success: true, message: '已拒绝申请' })
    return
  }

  res.status(404).json({ success: false, message: '申请不存在' })
}))